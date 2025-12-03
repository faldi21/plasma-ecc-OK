#!/usr/bin/env node
import axios from 'axios';
import { loadConfig, printConfig } from './config.js';
import { StateManager } from './state.js';
import { L1Monitor } from './l1-monitor.js';
import { L2Executor } from './l2-executor.js';
import type { DepositEvent } from './types.js';
import type { Hex } from 'viem';

/**
 * Plasma ECC Relay Service
 * Monitors L1 deposits and relays to L2
 * Notifies Backend for block submission
 */
class RelayService {
  private config = loadConfig();
  private state = new StateManager(this.config.l1FromBlock);
  private l1Monitor = new L1Monitor(this.config);
  private l2Executor = new L2Executor(this.config);
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
    console.log('');

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    // Start monitoring L1
    this.isRunning = true;
    const fromBlock = stats.lastBlock;

    console.log('🚀 Starting relay service...\n');
    console.log('📌 Relay will notify Backend for block submission\n');

    await this.l1Monitor.startMonitoring(fromBlock, async (deposit) => {
      await this.handleDeposit(deposit);
    });

    console.log('✅ Relay service is running!\n');
    console.log('Press Ctrl+C to stop gracefully\n');
  }

  /**
   * Notify Backend about new transaction
   */
  private async notifyBackend(tx: {
    type: 'DEPOSIT' | 'TRANSFER' | 'WITHDRAWAL';
    txHash: Hex;
    from?: string;
    to?: string;
    token?: string;
    amount?: string;
    blockNumber?: string;
  }): Promise<void> {
    try {
      const apiUrl = this.config.l2ApiUrl || 'http://localhost:3001';
      const response = await axios.post(
        `${apiUrl}/api/transactions/notify`,
        tx,
        { timeout: 10000 }
      );

      if (response.data?.success) {
        console.log(`[Relay] ✅ Notified Backend about ${tx.type} transaction`);
        console.log(`[Relay]    Pending in Backend: ${response.data.pendingCount}`);
      } else {
        console.error(`[Relay] ⚠️  Failed to notify Backend: ${response.data?.error}`);
      }
    } catch (error: any) {
      console.error(`[Relay] ⚠️  Error notifying Backend: ${error.message}`);
      // Don't throw - deposit already succeeded on L2
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

      // Notify Backend about deposit transaction
      await this.notifyBackend({
        type: 'DEPOSIT',
        txHash: result.l2TxHash,
        from: deposit.user,
        to: deposit.user,
        token: deposit.token,
        amount: deposit.amount.toString(),
        blockNumber: deposit.blockNumber.toString(),
      });

      // Mark as processed
      this.state.markProcessed(depositKey);
      this.state.updateLastBlock(deposit.blockNumber);
      this.state.incrementRelayedDeposits();

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
  } {
    return {
      isRunning: this.isRunning,
      state: this.state.getStats(),
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
