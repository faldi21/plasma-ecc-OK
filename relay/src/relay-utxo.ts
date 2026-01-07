#!/usr/bin/env node
import axios from 'axios';
import { loadConfig, printConfig } from './config.js';
import { StateManager } from './state.js';
import { L1MonitorUTXO } from './l1-monitor-utxo.js';
import { L2ExecutorUTXO } from './l2-executor-utxo.js';
import type { UTXODepositEvent } from './types.js';
import type { Hex } from 'viem';

/**
 * Plasma ECC UTXO Relay Service
 * Monitors L1 DepositCreated events and relays to L2 (UTXO model)
 */
class RelayServiceUTXO {
  private config = loadConfig();
  private state = new StateManager(this.config.l1FromBlock);
  private l1Monitor = new L1MonitorUTXO(this.config);
  private l2Executor = new L2ExecutorUTXO(this.config);
  private isRunning = false;

  /**
   * Start the relay service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Relay service is already running');
      return;
    }

    // Print configuration
    printConfig(this.config);

    // Print current state
    const stats = this.state.getStats();
    console.log('Current State:');
    console.log(`  Last L1 block:       ${stats.lastBlock}`);
    console.log(`  Processed tx count:  ${stats.processedCount}`);
    console.log(`  Relayed deposits:    ${stats.relayedDeposits}`);

    // Warning if starting from block 0 (might replay all historical deposits)
    if (stats.lastBlock === 0n) {
      console.log('\n⚠️  WARNING: Starting from block 0!');
      console.log('   This will scan ALL historical deposits.');
      console.log('   To avoid this, set L1_FROM_BLOCK to contract deployment block.');
      console.log('   Or delete relay-state.json and restart to resume from last position.\n');
    } else {
      console.log('');
    }

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    // Start monitoring L1
    this.isRunning = true;
    // Start from the next block after last processed (to avoid re-scanning last block)
    const fromBlock = stats.lastBlock > 0n ? stats.lastBlock : 0n;

    console.log('Starting UTXO relay service...\n');
    console.log(`Monitoring from block: ${fromBlock}\n`);
    console.log('Listening for DepositCreated events on RootChainUTXO\n');

    await this.l1Monitor.startMonitoring(fromBlock, async (deposit) => {
      await this.handleUtxoDeposit(deposit);
    });

    console.log('UTXO Relay service is running!\n');
    console.log('Press Ctrl+C to stop gracefully\n');
  }

  /**
   * Notify Backend about new UTXO transaction
   */
  private async notifyBackend(tx: {
    type: 'UTXO_DEPOSIT' | 'UTXO_TRANSFER' | 'UTXO_WITHDRAWAL';
    utxoId: Hex;
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
        console.log(`[Relay UTXO] Notified Backend about ${tx.type}`);
        console.log(`[Relay UTXO]    UTXO ID: ${tx.utxoId.slice(0, 20)}...`);
      } else {
        console.error(`[Relay UTXO] Failed to notify Backend: ${response.data?.error}`);
      }
    } catch (error: any) {
      console.error(`[Relay UTXO] Error notifying Backend: ${error.message}`);
    }
  }

  /**
   * Handle a UTXO deposit event from L1
   */
  private async handleUtxoDeposit(deposit: UTXODepositEvent): Promise<void> {
    // Create unique key for this deposit (txHash:logIndex ensures uniqueness)
    const depositKey = `${deposit.transactionHash}:${deposit.logIndex}`;

    // Check if already processed - critical to prevent duplicate relays
    if (this.state.isProcessed(depositKey)) {
      console.log(`[Relay UTXO] ⊘ Skipping (already processed): ${depositKey}`);
      return;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('New UTXO Deposit Event Detected');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`UTXO ID:      ${deposit.utxoId}`);
    console.log(`User:         ${deposit.user}`);
    console.log(`Token:        ${deposit.token}`);
    console.log(`Amount:       ${deposit.amount.toString()}`);
    console.log(`Nonce:        ${deposit.depositNonce.toString()}`);
    console.log(`Block:        ${deposit.blockNumber}`);
    console.log(`Tx Hash:      ${deposit.transactionHash}`);
    console.log('───────────────────────────────────────────────────────');

    try {
      // Relay to L2 - Create deposit UTXO
      console.log('[Relay UTXO] Creating deposit UTXO on L2...');
      const result = await this.l2Executor.relayUtxoDeposit(
        deposit.utxoId,
        deposit.user,
        deposit.token,
        deposit.amount
      );

      if (!result.success) {
        console.error(`[Relay UTXO] Failed to relay: ${result.error}`);
        return;
      }

      console.log('[Relay UTXO] Successfully created UTXO on L2');
      console.log(`  createDepositUtxo tx: ${result.l2TxHash}`);
      if (result.mintTxHash) {
        console.log(`  mint tx:              ${result.mintTxHash}`);
      }

      // Notify Backend about UTXO deposit
      await this.notifyBackend({
        type: 'UTXO_DEPOSIT',
        utxoId: deposit.utxoId,
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
      console.error(`[Relay UTXO] Error processing deposit:`, error.message);
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

    console.log('\nStopping UTXO relay service...');

    this.isRunning = false;

    // Stop monitoring
    this.l1Monitor.stopMonitoring();

    console.log('UTXO Relay service stopped\n');
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
      console.error('\nUncaught Exception:', error);
      this.stop().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('\nUnhandled Rejection at:', promise, 'reason:', reason);
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
  const relay = new RelayServiceUTXO();
  relay.start().catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}

export default RelayServiceUTXO;
