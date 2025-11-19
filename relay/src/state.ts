import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { RelayState } from './types.js';

const STATE_FILE = resolve(process.cwd(), '.relay_state.json');
const MAX_PROCESSED_KEYS = 2000; // Keep last 2000 processed transactions

/**
 * State Manager
 * Manages persistent state for relay service
 */
export class StateManager {
  private state: RelayState;
  private processedSet: Set<string>;

  constructor(defaultFromBlock: bigint = 0n) {
    this.state = this.loadState(defaultFromBlock);
    this.processedSet = new Set(this.state.processed || []);
  }

  /**
   * Load state from file or create new
   */
  private loadState(defaultFromBlock: bigint): RelayState {
    try {
      if (!existsSync(STATE_FILE)) {
        console.log('[State] No existing state file, creating new...');
        return {
          lastBlock: defaultFromBlock,
          processed: [],
          relayedDeposits: 0,
        };
      }

      const data = readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(data);

      return {
        lastBlock: BigInt(parsed.lastBlock || defaultFromBlock),
        processed: parsed.processed || [],
        relayedDeposits: parsed.relayedDeposits || 0,
        lastSubmittedBlock: parsed.lastSubmittedBlock,
      };
    } catch (error) {
      console.error('[State] Error loading state:', error);
      return {
        lastBlock: defaultFromBlock,
        processed: [],
        relayedDeposits: 0,
      };
    }
  }

  /**
   * Save state to file atomically
   */
  public saveState(): void {
    try {
      // Update state with current processed set (keep last N)
      this.state.processed = Array.from(this.processedSet).slice(-MAX_PROCESSED_KEYS);

      // Convert BigInt to string for JSON
      const stateToSave = {
        ...this.state,
        lastBlock: this.state.lastBlock.toString(),
      };

      // Atomic write: write to temp file first, then rename
      const tmpFile = STATE_FILE + '.tmp';
      writeFileSync(tmpFile, JSON.stringify(stateToSave, null, 2));
      renameSync(tmpFile, STATE_FILE);
    } catch (error) {
      console.error('[State] Error saving state:', error);
    }
  }

  /**
   * Check if transaction was already processed
   */
  public isProcessed(key: string): boolean {
    return this.processedSet.has(key);
  }

  /**
   * Mark transaction as processed
   */
  public markProcessed(key: string): void {
    this.processedSet.add(key);
    this.saveState();
  }

  /**
   * Update last processed block
   */
  public updateLastBlock(blockNumber: bigint): void {
    if (blockNumber > this.state.lastBlock) {
      this.state.lastBlock = blockNumber;
      this.saveState();
    }
  }

  /**
   * Increment relayed deposits counter
   */
  public incrementRelayedDeposits(): void {
    this.state.relayedDeposits++;
    this.saveState();
  }

  /**
   * Update last submitted block
   */
  public updateLastSubmittedBlock(blockNumber: number): void {
    this.state.lastSubmittedBlock = blockNumber;
    this.saveState();
  }

  /**
   * Get current state
   */
  public getState(): RelayState {
    return { ...this.state };
  }

  /**
   * Get last processed block
   */
  public getLastBlock(): bigint {
    return this.state.lastBlock;
  }

  /**
   * Get number of relayed deposits
   */
  public getRelayedDeposits(): number {
    return this.state.relayedDeposits;
  }

  /**
   * Get statistics
   */
  public getStats(): {
    lastBlock: bigint;
    processedCount: number;
    relayedDeposits: number;
    lastSubmittedBlock?: number;
  } {
    return {
      lastBlock: this.state.lastBlock,
      processedCount: this.processedSet.size,
      relayedDeposits: this.state.relayedDeposits,
      lastSubmittedBlock: this.state.lastSubmittedBlock,
    };
  }
}

export default StateManager;
