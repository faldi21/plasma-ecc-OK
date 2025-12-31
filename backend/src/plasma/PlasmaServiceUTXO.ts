import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  parseEther,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { AccumulatorService } from '../accumulator/AccumulatorService.js';
import { envConfig } from '../config/env.js';
import { rootChainUtxoAbi, plasmaChainUtxoAbi } from '../config/abis.js';
import type {
  UTXO,
  UTXODepositEvent,
  UTXOTransferResult,
  UTXOExitResult,
  BlockCreationResult,
} from '../types/contracts.js';

// Define custom chain for L2
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [envConfig.L2_RPC_URL] },
    public: { http: [envConfig.L2_RPC_URL] },
  },
} as const;

// Block submission configuration for high throughput
const BLOCK_CONFIG = {
  // Submit block when this many transactions are pending
  THRESHOLD: parseInt(process.env.BLOCK_THRESHOLD || '50', 10),
  // Submit block after this many milliseconds if any pending (even if below threshold)
  TIMEOUT_MS: parseInt(process.env.BLOCK_TIMEOUT_MS || '30000', 10), // 30 seconds default
  // Minimum interval between block submissions (rate limiting for L1)
  MIN_INTERVAL_MS: parseInt(process.env.BLOCK_MIN_INTERVAL_MS || '12000', 10), // 12 seconds (1 L1 block)
  // Maximum transactions per block (for gas optimization)
  MAX_PER_BLOCK: parseInt(process.env.BLOCK_MAX_TX || '500', 10),
};

interface PendingTransaction {
  utxoId: Hex;
  type: 'DEPOSIT' | 'TRANSFER' | 'SPEND';
  timestamp: number;
  user?: Address;
  amount?: bigint;
}

/**
 * Plasma Service UTXO
 * Service for managing UTXO-based Plasma operations
 */
export class PlasmaServiceUTXO {
  // Clients (using any to avoid viem type issues)
  private readonly l1PublicClient: any;
  private readonly l2PublicClient: any;
  private readonly l1WalletClient: any;
  private readonly l2WalletClient: any;

  // Accounts
  private readonly operatorAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly l2OperatorAccount: ReturnType<typeof privateKeyToAccount>;

  // Accumulator
  private readonly accumulator: AccumulatorService;

  // UTXO tracking
  private pendingUtxos: Map<Hex, UTXO> = new Map();
  private processedUtxoIds: Set<Hex> = new Set();

  // Block creation & auto-submission
  private isCreatingBlock = false;
  private blockCreationTimer: NodeJS.Timeout | null = null;
  private lastBlockSubmitTime = 0;

  // Pending transactions for block submission
  private pendingTransactions: PendingTransaction[] = [];
  private autoSubmitTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalTransactions: 0,
    totalBlocks: 0,
    lastBlockTxCount: 0,
    avgTxPerBlock: 0,
  };

  constructor() {
    console.log('Initializing Plasma Service UTXO...');

    if (!envConfig.ROOT_CHAIN_UTXO_ADDRESS || !envConfig.PLASMA_CHAIN_UTXO_ADDRESS) {
      throw new Error('UTXO contract addresses not configured. Set ROOT_CHAIN_UTXO_ADDRESS and PLASMA_CHAIN_UTXO_ADDRESS in .env');
    }

    console.log('L1 RootChainUTXO:', envConfig.ROOT_CHAIN_UTXO_ADDRESS);
    console.log('L2 PlasmaChainUTXO:', envConfig.PLASMA_CHAIN_UTXO_ADDRESS);

    // Setup accounts
    this.operatorAccount = privateKeyToAccount(envConfig.OPERATOR_PRIVATE_KEY);
    this.l2OperatorAccount = privateKeyToAccount(envConfig.L2_OPERATOR_PRIVATE_KEY);

    // Setup L1 clients (Sepolia)
    this.l1PublicClient = createPublicClient({
      chain: sepolia,
      transport: http(envConfig.SEPOLIA_RPC_URL),
    });

    this.l1WalletClient = createWalletClient({
      account: this.operatorAccount,
      chain: sepolia,
      transport: http(envConfig.SEPOLIA_RPC_URL),
    });

    // Setup L2 clients (Local Anvil)
    this.l2PublicClient = createPublicClient({
      chain: l2Chain,
      transport: http(envConfig.L2_RPC_URL),
    });

    this.l2WalletClient = createWalletClient({
      account: this.l2OperatorAccount,
      chain: l2Chain,
      transport: http(envConfig.L2_RPC_URL),
    });

    // Initialize accumulator
    this.accumulator = new AccumulatorService();

    // Start L1 event monitoring
    this.startL1EventMonitoring();

    // Start auto block submission timer
    this.startAutoBlockSubmission();

    console.log('Plasma Service UTXO initialized');
    console.log(`Block Config: threshold=${BLOCK_CONFIG.THRESHOLD}, timeout=${BLOCK_CONFIG.TIMEOUT_MS}ms, minInterval=${BLOCK_CONFIG.MIN_INTERVAL_MS}ms`);
  }

  /**
   * Start monitoring L1 for DepositCreated events
   */
  private async startL1EventMonitoring(): Promise<void> {
    console.log('Starting L1 UTXO event monitoring...');

    try {
      this.l1PublicClient.watchContractEvent({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        eventName: 'DepositCreated',
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { utxoId, user, token, amount, depositNonce } = log.args as any;
              console.log(`[L1] DepositCreated: ${utxoId}`);
              console.log(`  User: ${user}, Amount: ${formatEther(amount)}`);

              // Create UTXO on L2
              await this.createL2DepositUtxo(utxoId, user, token, amount);
            } catch (error: any) {
              console.error('Error processing DepositCreated:', error.message);
            }
          }
        },
      });

      console.log('L1 UTXO event monitoring started');
    } catch (error: any) {
      console.error('Error starting L1 monitoring:', error.message);
    }
  }

  /**
   * Start auto block submission system
   * Checks periodically if block should be submitted based on threshold or timeout
   */
  private startAutoBlockSubmission(): void {
    console.log('Starting auto block submission...');

    // Check every 1 second for optimal responsiveness
    const checkInterval = 1000;

    this.autoSubmitTimer = setInterval(async () => {
      await this.checkAndSubmitBlock();
    }, checkInterval);

    console.log('Auto block submission started');
  }

  /**
   * Check if block should be submitted and submit if conditions are met
   */
  private async checkAndSubmitBlock(): Promise<void> {
    // Skip if already creating block
    if (this.isCreatingBlock) return;

    const pendingCount = this.pendingTransactions.length;
    if (pendingCount === 0) return;

    const now = Date.now();
    const timeSinceLastBlock = now - this.lastBlockSubmitTime;

    // Check minimum interval (rate limiting)
    if (timeSinceLastBlock < BLOCK_CONFIG.MIN_INTERVAL_MS) return;

    // Get oldest transaction timestamp
    const oldestTx = this.pendingTransactions[0];
    const oldestAge = oldestTx ? now - oldestTx.timestamp : 0;

    // Determine if we should submit
    const thresholdReached = pendingCount >= BLOCK_CONFIG.THRESHOLD;
    const timeoutReached = oldestAge >= BLOCK_CONFIG.TIMEOUT_MS;

    if (thresholdReached || timeoutReached) {
      const reason = thresholdReached ? 'threshold' : 'timeout';
      console.log(`[Auto Block] Triggering submission (${reason}): ${pendingCount} pending, oldest=${oldestAge}ms`);

      try {
        await this.submitBlockAuto();
      } catch (error: any) {
        console.error('[Auto Block] Submission failed:', error.message);
      }
    }
  }

  /**
   * Add transaction to pending pool (called by relay notification)
   * Also adds UTXO to accumulator for witness generation
   */
  public async addPendingTransaction(tx: {
    utxoId: Hex;
    type: 'DEPOSIT' | 'TRANSFER' | 'SPEND';
    user?: Address;
    amount?: bigint;
  }): Promise<void> {
    this.pendingTransactions.push({
      ...tx,
      timestamp: Date.now(),
    });

    this.stats.totalTransactions++;

    // Add UTXO to accumulator for witness generation
    try {
      await this.accumulator.add(tx.utxoId);
      console.log(`[Pending] Added ${tx.type}: ${tx.utxoId.slice(0, 20)}... to accumulator`);
    } catch (error: any) {
      console.error(`[Pending] Failed to add to accumulator: ${error.message}`);
    }

    console.log(`[Pending] Total pending: ${this.pendingTransactions.length}`);

    // Check if threshold reached immediately
    if (this.pendingTransactions.length >= BLOCK_CONFIG.THRESHOLD) {
      console.log(`[Pending] Threshold reached (${BLOCK_CONFIG.THRESHOLD}), will submit block soon`);
    }
  }

  /**
   * Get pending transactions count
   */
  public getPendingCount(): number {
    return this.pendingTransactions.length;
  }

  /**
   * Get pending transactions
   */
  public getPendingTransactions(): PendingTransaction[] {
    return [...this.pendingTransactions];
  }

  /**
   * Submit block automatically (internal)
   */
  private async submitBlockAuto(): Promise<BlockCreationResult | null> {
    if (this.isCreatingBlock) {
      console.log('[Auto Block] Already creating block, skipping');
      return null;
    }

    if (this.pendingTransactions.length === 0) {
      console.log('[Auto Block] No pending transactions');
      return null;
    }

    try {
      this.isCreatingBlock = true;

      // Take up to MAX_PER_BLOCK transactions
      const txCount = Math.min(this.pendingTransactions.length, BLOCK_CONFIG.MAX_PER_BLOCK);
      const txsToSubmit = this.pendingTransactions.splice(0, txCount);

      console.log(`[Auto Block] Submitting block with ${txCount} transactions...`);

      const accumulatorValue = this.accumulator.getValue();

      const hash = await this.l1WalletClient.writeContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'submitBlock',
        args: [
          { x: BigInt(accumulatorValue.x), y: BigInt(accumulatorValue.y) },
          BigInt(txCount),
        ],
      } as any);

      // Wait for receipt with timeout
      const receipt = await this.l1PublicClient.waitForTransactionReceipt({
        hash,
        timeout: 60000, // 60 second timeout
      });

      // Get current block number
      const blockNumber = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'currentPlasmaBlock',
      } as any)) as bigint;

      // Update stats
      this.lastBlockSubmitTime = Date.now();
      this.stats.totalBlocks++;
      this.stats.lastBlockTxCount = txCount;
      this.stats.avgTxPerBlock = this.stats.totalTransactions / this.stats.totalBlocks;

      console.log(`[Auto Block] Block ${blockNumber} submitted successfully!`);
      console.log(`  TX Hash: ${hash}`);
      console.log(`  Transactions: ${txCount}`);
      console.log(`  Remaining pending: ${this.pendingTransactions.length}`);
      console.log(`  Total blocks: ${this.stats.totalBlocks}, Avg TX/block: ${this.stats.avgTxPerBlock.toFixed(1)}`);

      return {
        blockNumber: blockNumber.toString(),
        transactionCount: txCount,
        remainingPending: this.pendingTransactions.length,
        l1TxHash: hash,
        l2TxHash: hash,
      };
    } catch (error: any) {
      console.error('[Auto Block] Submit error:', error.message);
      throw error;
    } finally {
      this.isCreatingBlock = false;
    }
  }

  /**
   * Get block submission statistics
   */
  public getStats(): typeof this.stats & { pendingCount: number; config: typeof BLOCK_CONFIG } {
    return {
      ...this.stats,
      pendingCount: this.pendingTransactions.length,
      config: BLOCK_CONFIG,
    };
  }

  /**
   * Stop auto block submission (for graceful shutdown)
   */
  public stopAutoBlockSubmission(): void {
    if (this.autoSubmitTimer) {
      clearInterval(this.autoSubmitTimer);
      this.autoSubmitTimer = null;
      console.log('Auto block submission stopped');
    }
  }

  /**
   * Create deposit UTXO on L2 (called when deposit detected on L1)
   */
  public async createL2DepositUtxo(
    utxoId: Hex,
    user: Address,
    token: Address,
    amount: bigint
  ): Promise<{ success: boolean; txHash: Hash; utxoId: Hex }> {
    try {
      console.log(`Creating L2 deposit UTXO: ${utxoId}`);

      // Map L1 token to L2 token
      const l2Token = this.mapL1ToL2Token(token);

      const hash = await this.l2WalletClient.writeContract({
        address: envConfig.PLASMA_CHAIN_UTXO_ADDRESS!,
        abi: plasmaChainUtxoAbi,
        functionName: 'createDepositUtxo',
        args: [utxoId, user, l2Token, amount],
      } as any);

      await this.l2PublicClient.waitForTransactionReceipt({ hash });

      console.log(`L2 deposit UTXO created: ${hash}`);

      // Add to accumulator
      await this.accumulator.add(utxoId);

      return {
        success: true,
        txHash: hash,
        utxoId,
      };
    } catch (error: any) {
      console.error('Create L2 deposit UTXO error:', error.message);
      throw error;
    }
  }

  /**
   * Map L1 token to L2 token
   */
  private mapL1ToL2Token(l1Token: Address): Address {
    if (l1Token.toLowerCase() === envConfig.PLASMA_TOKEN_ADDRESS.toLowerCase()) {
      return envConfig.L2_PLASMA_TOKEN_ADDRESS;
    }
    return l1Token;
  }

  /**
   * Get UTXO from L1 contract
   */
  public async getUtxo(utxoId: Hex): Promise<UTXO | null> {
    try {
      const utxo = await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'getUtxo',
        args: [utxoId],
      }) as any;

      if (utxo.utxoId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        return null;
      }

      return {
        utxoId: utxo.utxoId,
        owner: utxo.owner,
        token: utxo.token,
        amount: utxo.amount,
        createdInBlock: utxo.createdInBlock,
        spent: utxo.spent,
        exited: utxo.exited,
      };
    } catch (error) {
      console.error('Get UTXO error:', error);
      return null;
    }
  }

  /**
   * Get user's UTXOs from L1
   */
  public async getUserUtxos(user: Address): Promise<Hex[]> {
    try {
      const utxos = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'getUserUtxos',
        args: [user],
      } as any)) as Hex[];

      return utxos;
    } catch (error) {
      console.error('Get user UTXOs error:', error);
      return [];
    }
  }

  /**
   * Get user's unspent UTXOs from L1
   */
  public async getUnspentUtxos(user: Address): Promise<Hex[]> {
    try {
      const utxos = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'getUnspentUtxos',
        args: [user],
      } as any)) as Hex[];

      return utxos;
    } catch (error) {
      console.error('Get unspent UTXOs error:', error);
      return [];
    }
  }

  /**
   * Get user's total UTXO balance
   */
  public async getUserBalance(user: Address, token: Address): Promise<string> {
    try {
      const balance = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'getUserBalance',
        args: [user, token],
      } as any)) as bigint;

      return formatEther(balance);
    } catch (error) {
      console.error('Get user balance error:', error);
      return '0';
    }
  }

  /**
   * Check if UTXO can be exited
   */
  public async canExit(utxoId: Hex): Promise<{ canExit: boolean; reason: string }> {
    try {
      const [canExit, reason] = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'canExit',
        args: [utxoId],
      } as any)) as [boolean, string];

      return { canExit, reason };
    } catch (error) {
      console.error('Can exit check error:', error);
      return { canExit: false, reason: 'Error checking exit status' };
    }
  }

  /**
   * Sync UTXO spent status to L1
   */
  public async syncUtxoSpent(utxoId: Hex, spendingTxHash: Hex): Promise<Hash> {
    try {
      console.log(`Syncing UTXO spent: ${utxoId}`);

      const hash = await this.l1WalletClient.writeContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'syncUtxoSpent',
        args: [utxoId, spendingTxHash],
      } as any);

      await this.l1PublicClient.waitForTransactionReceipt({ hash });

      console.log(`UTXO spent synced: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error('Sync UTXO spent error:', error.message);
      throw error;
    }
  }

  /**
   * Submit block to L1
   */
  public async submitBlock(transactionCount: number): Promise<BlockCreationResult | null> {
    if (this.isCreatingBlock) {
      console.log('Block creation already in progress');
      return null;
    }

    try {
      this.isCreatingBlock = true;

      const accumulatorValue = this.accumulator.getValue();
      console.log('Submitting block to L1...');
      console.log(`  Transaction count: ${transactionCount}`);
      console.log(`  Accumulator X: ${accumulatorValue.x.slice(0, 20)}...`);

      const hash = await this.l1WalletClient.writeContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'submitBlock',
        args: [
          { x: BigInt(accumulatorValue.x), y: BigInt(accumulatorValue.y) },
          BigInt(transactionCount),
        ],
      } as any);

      const receipt = await this.l1PublicClient.waitForTransactionReceipt({ hash });

      // Get current block number
      const blockNumber = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'currentPlasmaBlock',
      } as any)) as bigint;

      console.log(`Block ${blockNumber} submitted: ${hash}`);

      return {
        blockNumber: blockNumber.toString(),
        transactionCount,
        remainingPending: 0,
        l1TxHash: hash,
        l2TxHash: hash,
      };
    } catch (error: any) {
      console.error('Submit block error:', error.message);
      throw error;
    } finally {
      this.isCreatingBlock = false;
    }
  }

  /**
   * Get current plasma block number
   */
  public async getCurrentBlock(): Promise<bigint> {
    try {
      const blockNumber = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_UTXO_ADDRESS!,
        abi: rootChainUtxoAbi,
        functionName: 'currentPlasmaBlock',
      } as any)) as bigint;

      return blockNumber;
    } catch (error) {
      console.error('Get current block error:', error);
      return 0n;
    }
  }

  /**
   * Get accumulator value
   */
  public getAccumulatorValue(): { x: Hex; y: Hex } {
    return this.accumulator.getValue();
  }

  /**
   * Get accumulator size
   */
  public getAccumulatorSize(): number {
    return this.accumulator.size();
  }

  /**
   * Generate witness for UTXO
   */
  public async generateWitness(utxoId: Hex): Promise<any> {
    return await this.accumulator.generateWitness(utxoId);
  }

  /**
   * Add to accumulator
   */
  public async addToAccumulator(element: Hex): Promise<boolean> {
    return await this.accumulator.add(element);
  }

  /**
   * Get all elements in accumulator
   */
  public getAccumulatorElements(): Hex[] {
    return this.accumulator.getElements();
  }
}

// Export singleton instance
let plasmaServiceUtxoInstance: PlasmaServiceUTXO | null = null;

export function getPlasmaServiceUTXO(): PlasmaServiceUTXO {
  if (!plasmaServiceUtxoInstance) {
    plasmaServiceUtxoInstance = new PlasmaServiceUTXO();
  }
  return plasmaServiceUtxoInstance;
}

export default PlasmaServiceUTXO;
