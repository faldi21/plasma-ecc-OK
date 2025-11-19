#!/usr/bin/env node
import axios from 'axios';
import { loadConfig, printConfig } from './config.js';
import { StateManager } from './state.js';
import { L1Monitor } from './l1-monitor.js';
import { L2Executor } from './l2-executor.js';
import { BlockSubmitter } from './block-submitter.js';
import type { DepositEvent } from './types.js';
import type { Hex } from 'viem';

/**
 * Plasma ECC Relay Service
 * Monitors L1 deposits, relays to L2, and submits blocks back to L1
 */
class RelayService {
  private config = loadConfig();
  private state = new StateManager(this.config.l1FromBlock);
  private l1Monitor = new L1Monitor(this.config);
  private l2Executor = new L2Executor(this.config);
  private blockSubmitter = new BlockSubmitter(this.config, this.l1Monitor);
  private isRunning = false;

  /**
   * Start the relay service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Relay service is already running');
      return;
    }

    // Print configuration
    printConfig(this.config);

    // Print current state
    const stats = this.state.getStats();
    console.log('📊 Current State:');
    console.log(`  Last L1 block:       ${stats.lastBlock}`);
    console.log(`  Processed tx count:  ${stats.processedCount}`);
    console.log(`  Relayed deposits:    ${stats.relayedDeposits}`);
    if (stats.lastSubmittedBlock) {
      console.log(`  Last submitted block: ${stats.lastSubmittedBlock}`);
      this.blockSubmitter.setCurrentBlockNumber(stats.lastSubmittedBlock + 1);
    }
    console.log('');

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    // Start block submitter
    this.blockSubmitter.start();

    // Start monitoring L1
    this.isRunning = true;
    const fromBlock = stats.lastBlock;

    console.log('🚀 Starting relay service...\n');

    await this.l1Monitor.startMonitoring(fromBlock, async (deposit) => {
      await this.handleDeposit(deposit);
    });

    console.log('✅ Relay service is running!\n');
    console.log('Press Ctrl+C to stop gracefully\n');
  }

  /**
   * Add transaction hash to backend accumulator
   */
  private async addToBackendAccumulator(txHash: Hex): Promise<void> {
    try {
      const apiUrl = this.config.l2ApiUrl || 'http://localhost:3001';
      const response = await axios.post(
        `${apiUrl}/api/accumulator/add`,
        { txHash },
        { timeout: 10000 }
      );

      if (response.data?.success) {
        console.log(`[Relay] ✅ Added to accumulator (size: ${response.data.size})`);
      } else {
        console.error(`[Relay] ⚠️  Failed to add to accumulator: ${response.data?.error}`);
      }
    } catch (error: any) {
      console.error(`[Relay] ⚠️  Error adding to accumulator: ${error.message}`);
      // Don't throw - this is not critical for relay flow
    }
  }

  /**
   * Handle a deposit event from L1
   */
  private async handleDeposit(deposit: DepositEvent): Promise<void> {
    // Create unique key for this deposit
    const depositKey = `${deposit.transactionHash}:${deposit.logIndex}`;

    // Check if already processed
    if (this.state.isProcessed(depositKey)) {
      console.log(`[Relay] ⏭️  Already processed: ${depositKey}`);
      return;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔔 New Deposit Event Detected');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`User:         ${deposit.user}`);
    console.log(`Token:        ${deposit.token}`);
    console.log(`Amount:       ${deposit.amount.toString()}`);
    console.log(`Block:        ${deposit.blockNumber}`);
    console.log(`Tx Hash:      ${deposit.transactionHash}`);
    console.log(`Log Index:    ${deposit.logIndex}`);
    console.log('───────────────────────────────────────────────────────');

    try {
      // Relay to L2
      console.log('[Relay] 🔄 Relaying to L2...');
      const result = await this.l2Executor.relayDeposit(
        deposit.user,
        deposit.token,
        deposit.amount
      );

      if (!result.success) {
        console.error(`[Relay] ❌ Failed to relay: ${result.error}`);
        return;
      }

      console.log('[Relay] ✅ Successfully relayed to L2');
      console.log(`  updateBalance tx: ${result.l2TxHash}`);
      if (result.mintTxHash) {
        console.log(`  mint tx:          ${result.mintTxHash}`);
      }

      // Add to backend accumulator
      await this.addToBackendAccumulator(result.l2TxHash);

      // Mark as processed
      this.state.markProcessed(depositKey);
      this.state.updateLastBlock(deposit.blockNumber);
      this.state.incrementRelayedDeposits();

      // Add to block submitter
      await this.blockSubmitter.addTransaction(result.l2TxHash);

      // Update state with last submitted block if changed
      const submitterStats = this.blockSubmitter.getStats();
      if (submitterStats.currentBlock > 1) {
        this.state.updateLastSubmittedBlock(submitterStats.currentBlock - 1);
      }

      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    } catch (error: any) {
      console.error(`[Relay] ❌ Error processing deposit:`, error.message);
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    }
  }

  /**
   * Stop the relay service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('\n🛑 Stopping relay service...');

    this.isRunning = false;

    // Stop monitoring
    this.l1Monitor.stopMonitoring();

    // Stop block submitter
    this.blockSubmitter.stop();

    // Force submit any pending transactions
    const stats = this.blockSubmitter.getStats();
    if (stats.pendingTxCount > 0) {
      console.log(
        `\n📤 Submitting ${stats.pendingTxCount} pending transaction(s)...`
      );
      await this.blockSubmitter.forceSubmit();
    }

    console.log('✅ Relay service stopped\n');
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n\n${signal} received`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('\n❌ Uncaught Exception:', error);
      this.stop().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('\n❌ Unhandled Rejection at:', promise, 'reason:', reason);
      this.stop().then(() => process.exit(1));
    });
  }

  /**
   * Get current status
   */
  public getStatus(): {
    isRunning: boolean;
    state: ReturnType<StateManager['getStats']>;
    submitter: ReturnType<BlockSubmitter['getStats']>;
  } {
    return {
      isRunning: this.isRunning,
      state: this.state.getStats(),
      submitter: this.blockSubmitter.getStats(),
    };
  }
}

// Start relay service if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const relay = new RelayService();
  relay.start().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export default RelayService;
