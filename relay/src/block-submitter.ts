import axios from 'axios';
import type { Hex } from 'viem';
import type { RelayConfig } from './types.js';
import type { L1Monitor } from './l1-monitor.js';

/**
 * Block Submitter
 * Manages batching of L2 transactions and submitting to L1
 */
export class BlockSubmitter {
  private readonly config: RelayConfig;
  private readonly l1Monitor: L1Monitor;
  private pendingTxHashes: Hex[] = [];
  private currentBlockNumber: number = 1;
  private submissionTimer?: NodeJS.Timeout;

  constructor(config: RelayConfig, l1Monitor: L1Monitor) {
    this.config = config;
    this.l1Monitor = l1Monitor;
  }

  /**
   * Start automatic block submission
   */
  public start(): void {
    console.log('[Block Submitter] Starting automatic submission');
    console.log(
      `  Trigger: ${this.config.relayTransactionsPerBlock} transactions`
    );
    console.log(`  Timeout: ${this.config.relayBlockTimeout / 1000} seconds`);

    // Start timeout timer
    this.resetTimer();
  }

  /**
   * Add transaction hash to pending batch
   */
  public async addTransaction(txHash: Hex): Promise<void> {
    this.pendingTxHashes.push(txHash);
    console.log(
      `[Block Submitter] Added tx ${txHash.slice(0, 10)}... (${this.pendingTxHashes.length}/${this.config.relayTransactionsPerBlock})`
    );

    // Check if we should submit
    if (
      this.pendingTxHashes.length >= this.config.relayTransactionsPerBlock
    ) {
      await this.submitBlock();
    } else {
      // Reset timer
      this.resetTimer();
    }
  }

  /**
   * Submit current batch to L1
   */
  public async submitBlock(): Promise<boolean> {
    if (this.pendingTxHashes.length === 0) {
      console.log('[Block Submitter] No transactions to submit');
      return false;
    }

    console.log(
      `[Block Submitter] Submitting block ${this.currentBlockNumber} with ${this.pendingTxHashes.length} transactions`
    );

    try {
      // Clear timeout
      this.clearTimer();

      // Get accumulator value from backend
      const accumulatorValue = await this.getAccumulatorValue();

      if (!accumulatorValue) {
        console.error('[Block Submitter] Failed to get accumulator value');
        // Reset timer and keep pending transactions
        this.resetTimer();
        return false;
      }

      // Submit to L1
      const l1TxHash = await this.l1Monitor.submitBlock(
        this.currentBlockNumber,
        this.pendingTxHashes.length,
        this.pendingTxHashes,
        accumulatorValue
      );

      console.log(`[Block Submitter] ✅ Block ${this.currentBlockNumber} submitted: ${l1TxHash}`);

      // Clear pending transactions
      this.pendingTxHashes = [];
      this.currentBlockNumber++;

      // Restart timer for next batch
      this.resetTimer();

      return true;
    } catch (error: any) {
      console.error('[Block Submitter] Error submitting block:', error.message);

      // Don't clear pending transactions - retry later
      this.resetTimer();
      return false;
    }
  }

  /**
   * Get accumulator value from backend API
   */
  private async getAccumulatorValue(): Promise<{ x: Hex; y: Hex } | null> {
    try {
      const apiUrl = this.config.l2ApiUrl || 'http://localhost:3001';
      const response = await axios.get(`${apiUrl}/api/accumulator/value`, {
        timeout: 10000,
      });

      if (response.data && response.data.success) {
        return {
          x: response.data.accumulator.x as Hex,
          y: response.data.accumulator.y as Hex,
        };
      }

      console.error(
        '[Block Submitter] Invalid accumulator response:',
        response.data
      );
      return null;
    } catch (error: any) {
      console.error(
        '[Block Submitter] Error fetching accumulator:',
        error.message
      );
      return null;
    }
  }

  /**
   * Get pending transactions from backend API
   */
  public async getPendingTransactions(): Promise<Hex[]> {
    try {
      const apiUrl = this.config.l2ApiUrl || 'http://localhost:3001';
      const response = await axios.get(`${apiUrl}/api/pending`, {
        timeout: 10000,
      });

      if (response.data && response.data.success) {
        return response.data.transactions.map((tx: any) => tx.txHash as Hex);
      }

      return [];
    } catch (error: any) {
      console.error(
        '[Block Submitter] Error fetching pending transactions:',
        error.message
      );
      return [];
    }
  }

  /**
   * Force submit current batch (even if not full)
   */
  public async forceSubmit(): Promise<boolean> {
    console.log('[Block Submitter] Force submitting current batch');
    return await this.submitBlock();
  }

  /**
   * Reset submission timer
   */
  private resetTimer(): void {
    this.clearTimer();

    this.submissionTimer = setTimeout(async () => {
      console.log(
        `[Block Submitter] Timeout reached (${this.config.relayBlockTimeout / 1000}s)`
      );
      await this.submitBlock();
    }, this.config.relayBlockTimeout);
  }

  /**
   * Clear submission timer
   */
  private clearTimer(): void {
    if (this.submissionTimer) {
      clearTimeout(this.submissionTimer);
      this.submissionTimer = undefined;
    }
  }

  /**
   * Stop block submitter
   */
  public stop(): void {
    console.log('[Block Submitter] Stopping');
    this.clearTimer();
  }

  /**
   * Get current stats
   */
  public getStats(): {
    currentBlock: number;
    pendingTxCount: number;
    pendingTxHashes: Hex[];
  } {
    return {
      currentBlock: this.currentBlockNumber,
      pendingTxCount: this.pendingTxHashes.length,
      pendingTxHashes: [...this.pendingTxHashes],
    };
  }

  /**
   * Set current block number (for resuming)
   */
  public setCurrentBlockNumber(blockNumber: number): void {
    this.currentBlockNumber = blockNumber;
    console.log(`[Block Submitter] Resumed at block ${blockNumber}`);
  }
}

export default BlockSubmitter;
