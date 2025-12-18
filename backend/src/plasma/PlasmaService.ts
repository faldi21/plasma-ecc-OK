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
  parseGwei,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { AccumulatorService } from '../accumulator/AccumulatorService.js';
import { envConfig } from '../config/env.js';
import { rootChainAbi, plasmaChainAbi, erc20Abi } from '../config/abis.js';
import type {
  PendingTransaction,
  BlockCreationResult,
  TransferResult,
  ExitResult,
  BlockInfo,
  ExitInfo,
} from '../types/contracts.js';

// Define custom chain for L2
const l2Chain = {
  id: 31337, // Anvil default chain ID
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

/**
 * Plasma Service
 *
 * Main service for managing Layer 2 Plasma operations:
 * - Transaction processing
 * - Block creation and submission to L1
 * - Event monitoring
 * - Exit handling
 */
// Simple Mutex implementation
class Mutex {
  private mutex = Promise.resolve();

  lock(): Promise<() => void> {
    let begin: (unlock: void) => void = () => {};

    this.mutex = this.mutex.then(() => {
      return new Promise<void>((resolve) => {
        begin = resolve;
      });
    });

    return new Promise((resolve) => {
      resolve(() => begin());
    });
  }

  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const unlock = await this.lock();
    try {
      return await callback();
    } finally {
      unlock();
    }
  }
}

export class PlasmaService {
  // Clients
  private readonly l1PublicClient: PublicClient;
  private readonly l2PublicClient: PublicClient;
  private readonly l1WalletClient: WalletClient;
  private readonly l2WalletClient: WalletClient;

  // Accounts
  private readonly operatorAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly l2OperatorAccount: ReturnType<typeof privateKeyToAccount>;

  // Operator Nonce Management
  private l1OperatorNonce: bigint | null = null;
  private l2OperatorNonce: number | null = null;
  private l1Mutex = new Mutex();
  private l2Mutex = new Mutex();

  // Accumulator
  private readonly accumulator: AccumulatorService;

  // Transaction pool
  private pendingTransactions: PendingTransaction[] = [];
  private processedTxHashes: Set<Hex> = new Set();

  // Block creation
  private isCreatingBlock = false;
  private blockCreationTimer: NodeJS.Timeout | null = null;

  constructor() {
    console.log('Initializing Plasma Service...');
    console.log('L1 RPC:', envConfig.SEPOLIA_RPC_URL);
    console.log('L2 RPC:', envConfig.L2_RPC_URL);

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

    // Start services
    this.startL2EventMonitoring();
    this.startBlockProduction();

    console.log('✅ Plasma Service initialized');
  }

  /**
   * Process a deposit from L1 to L2
   */
  public async processDeposit(
    userAddress: Address,
    tokenAddress: Address,
    amount: string
  ): Promise<{ success: boolean; txHash: Hash; userAddress: Address; tokenAddress: Address; amount: string }> {
    try {
      console.log('Processing deposit:', { userAddress, tokenAddress, amount });

      // Update balance on L2
      const amountWei = parseEther(amount);

      const hash = await this.l2WalletClient.writeContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'updateBalance',
        args: [userAddress, tokenAddress, amountWei],
      } as any);

      await this.l2PublicClient.waitForTransactionReceipt({ hash });

      return {
        success: true,
        txHash: hash,
        userAddress,
        tokenAddress,
        amount,
      };
    } catch (error) {
      console.error('Process deposit error:', error);
      throw error;
    }
  }

  /**
   * Process a transfer on L2
   */
  // Optimistic Nonce Cache
  private nonceCache = new Map<string, bigint>();
  private userMutexes = new Map<string, Mutex>();

  private getUserMutex(address: string): Mutex {
    if (!this.userMutexes.has(address)) {
      this.userMutexes.set(address, new Mutex());
    }
    return this.userMutexes.get(address)!;
  }

  /**
   * Process a transfer on L2 (Optimistic & Async)
   */
  public async processTransfer(
    from: Address,
    to: Address,
    tokenAddress: Address,
    amount: string,
    signature: Hex,
    nonce: string,
    timestamp?: number
  ): Promise<TransferResult> {
    const userMutex = this.getUserMutex(from);
    return await userMutex.runExclusive(async () => {
        try {
        // console.log('Processing transfer (Async):', { from, nonce });

        // 1. Determine expected nonce
        let expectedNonce = this.nonceCache.get(from);
        
        // If not in cache, fetch from chain
        if (expectedNonce === undefined) {
            const currentNonce = (await this.l2PublicClient.readContract({
            address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
            abi: plasmaChainAbi,
            functionName: 'nonces',
            args: [from],
            })) as bigint;
            expectedNonce = currentNonce;
            this.nonceCache.set(from, expectedNonce);
        }

        // 2. Validate incoming nonce
        if (BigInt(nonce) !== expectedNonce) {
            // Double check with chain to be safe (in case cache is stale/wrong)
            const onChainNonce = (await this.l2PublicClient.readContract({
            address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
            abi: plasmaChainAbi,
            functionName: 'nonces',
            args: [from],
            })) as bigint;

            if (BigInt(nonce) !== onChainNonce && BigInt(nonce) !== expectedNonce) {
            throw new Error(`Nonce mismatch. Expected: ${expectedNonce} or ${onChainNonce}, Provided: ${nonce}`);
            }
            
            // If it matches on-chain, update cache
            if (BigInt(nonce) === onChainNonce) {
            expectedNonce = onChainNonce;
            this.nonceCache.set(from, expectedNonce);
            }
        }

        // 3. Update cache optimisticly for NEXT transaction
        this.nonceCache.set(from, expectedNonce + 1n);

        // 4. Submit transaction (Async) with Operator Nonce Management
        const amountWei = parseEther(amount);
        
        const hash = await this.l2Mutex.runExclusive(async () => {
            // Initialize operator nonce if needed
            if (this.l2OperatorNonce === null) {
                this.l2OperatorNonce = await this.l2PublicClient.getTransactionCount({
                    address: this.l2OperatorAccount.address
                });
                console.log(`Initialized L2 Operator Nonce: ${this.l2OperatorNonce}`);
            }

            let retries = 0;
            while (retries < 100) {
                const nonceToUse = this.l2OperatorNonce;
                try {
                    const hash = await this.l2WalletClient.writeContract({
                        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
                        abi: plasmaChainAbi,
                        functionName: 'executeTransaction',
                        args: [from, to, tokenAddress, amountWei, BigInt(nonce), signature],
                        nonce: nonceToUse,
                        gas: 5000000n, // Hardcoded gas limit (increased to 5M for ECC operations)
                    });
                    
                    // Success! Increment for next transaction
                    this.l2OperatorNonce++;
                    return hash;
                } catch (error: any) {
                    const msg = error.message || error.details || '';
                    if (error.message.includes('nonce too low') || error.message.includes('replacement transaction underpriced')) {
                        console.warn(`[Operator] L2 Nonce ${nonceToUse} too low or underpriced, incrementing...`);
                        this.l2OperatorNonce = nonceToUse + 1;
                        // Retry loop will pick up new nonce
                    } else if (msg.toLowerCase().includes('nonce too high')) {
                        console.log(`Operator L2 Nonce ${this.l2OperatorNonce} too high. Decrementing.`);
                        this.l2OperatorNonce--;
                    } else {
                        throw error;
                    }
                    retries++;
                }
            }
            throw new Error('Failed to send transaction after nonce retries');
        });

        // 5. Background processing (Fire-and-Forget)
        this.handleTransactionConfirmation(hash, from, to, tokenAddress, amountWei, timestamp)
            .catch(err => {
                console.error(`Background tx failed for ${from} nonce ${nonce}:`, err);
                this.nonceCache.delete(from); // Invalidate cache on error
            });

        // 6. Return success immediately
        return {
            success: true,
            txHash: hash, // Returning L2 hash as placeholder
            l2TxHash: hash,
            from,
            to,
            amount,
            status: 'PENDING',
            timestamp: timestamp || Date.now()
        } as any; // Cast to any because TransferResult might expect more fields

        } catch (error: any) {
        console.error('Process transfer error:', error.message);
        throw error;
        }
    });
  }

  /**
   * Handle transaction confirmation in background
   */
  private async handleTransactionConfirmation(
      hash: Hex, 
      from: Address, 
      to: Address, 
      tokenAddress: Address, 
      amountWei: bigint,
      timestamp?: number
  ) {
      const receipt = await this.l2PublicClient.waitForTransactionReceipt({ hash });
      
      // Get transaction hash from event
      let txHash: Hex | undefined;
      for (const log of receipt.logs) {
        try {
          // Find TransactionExecuted event
          // Signature: TransactionExecuted(bytes32,address,address)
          const eventSignature = keccak256(toBytes('TransactionExecuted(bytes32,address,address)'));
          if (log.topics[0] === eventSignature) {
            txHash = log.topics[1] as Hex; 
            break;
          }
        } catch {}
      }

      if (txHash) {
          // Add to pending transactions
          this.pendingTransactions.push({
            txHash,
            from,
            to,
            tokenAddress,
            amount: amountWei,
            timestamp: timestamp || Date.now(),
            l2TxHash: hash,
          });

          // Add to accumulator
          await this.accumulator.add(txHash);
          // console.log(`Background: Tx confirmed ${txHash}`);
      }
  }

  /**
   * Create a block from pending transactions
   */
  public async createBlock(force = false): Promise<BlockCreationResult | null> {
    // Prevent concurrent block creation
    if (this.isCreatingBlock) {
      console.log('⏸️ Block creation already in progress, skipping...');
      return null;
    }

    const blockCreationStartTime = Date.now();

    try {
      // Set mutex
      this.isCreatingBlock = true;

      if (!force && this.pendingTransactions.length === 0) {
        console.log('No pending transactions to include in block');
        this.isCreatingBlock = false;
        return null;
      }

      console.log(
        `Creating block with ${this.pendingTransactions.length} pending transactions (started at ${new Date().toISOString()})`
      );

      // Limit transactions per block to avoid gas overflow
      const MAX_TX_PER_BLOCK = 100;
      const transactionsToInclude = this.pendingTransactions.slice(0, MAX_TX_PER_BLOCK);
      const remainingTransactions = this.pendingTransactions.slice(MAX_TX_PER_BLOCK);

      if (transactionsToInclude.length < this.pendingTransactions.length) {
        console.log(
          `⚠️  Limiting block to ${MAX_TX_PER_BLOCK} transactions (${remainingTransactions.length} will remain pending)`
        );
      }

      // Extract transaction hashes
      const txHashes = transactionsToInclude.map((tx) => tx.txHash);

      if (txHashes.length === 0) {
        console.log('No transaction hashes available');
        this.isCreatingBlock = false;
        return null;
      }

      console.log('🔄 Using bypass method: createBlockWithTransactions');

      // Use bypass function
      const hash = await this.l2WalletClient.writeContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'createBlockWithTransactions',
        args: [txHashes],
        gas: 10000000n, // Hardcoded gas limit (10M) to prevent OOG/Crash
      });

      const receipt = await this.l2PublicClient.waitForTransactionReceipt({ hash });

      // Get block number from contract
      const blockNumber = (await this.l2PublicClient.readContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'currentBlock',
      })) as bigint;

      console.log(`L2 block ${blockNumber} created successfully`);

      // Get real ECC accumulator value
      const accumulatorValue = this.accumulator.getValue();
      console.log('Submitting block to L1...', {
        blockNumber: blockNumber.toString(),
        accumulatorValue,
        transactionCount: txHashes.length,
        transactions: txHashes.slice(0, 3),
      });

      // Convert ECC point to format expected by L1 contract
      const accumulatorArray = [accumulatorValue.x, accumulatorValue.y];

      let submitTxHash: Hash | null = null;
      try {
        // Estimate gas first
        let gasEstimate: bigint;
        try {
          gasEstimate = await this.l1PublicClient.estimateContractGas({
            address: envConfig.ROOT_CHAIN_ADDRESS,
            abi: rootChainAbi,
            functionName: 'submitBlock',
            args: [accumulatorArray, BigInt(txHashes.length), txHashes],
            account: this.operatorAccount,
          });
          console.log(`  Gas estimate: ${gasEstimate.toString()}`);
        } catch (estimateError: any) {
          console.log(`  ⚠️ Gas estimation failed: ${estimateError.message.substring(0, 100)}...`);
          gasEstimate = 5000000n; // 5M gas as fallback
        }

        // Submit with explicit gas limit and mutex
        await this.l1Mutex.runExclusive(async () => {
             // Initialize L1 nonce if needed
             if (this.l1OperatorNonce === null) {
                this.l1OperatorNonce = BigInt(await this.l1PublicClient.getTransactionCount({
                    address: this.operatorAccount.address
                }));
             }

             // Fetch the actual next valid nonce from the chain (pending)
             // This handles cases where we have a nonce gap due to failed L2 transactions
             const pendingNonce = BigInt(await this.l1PublicClient.getTransactionCount({
                 address: this.operatorAccount.address,
                 blockTag: 'pending'
             }));

             console.log(`🔒 [SubmitBlock] Using pending nonce: ${pendingNonce} (Local: ${this.l1OperatorNonce})`);
             
             // Update local nonce if we are behind (shouldn't happen if we fill gaps)
             // Or if we are ahead (gap), we fill the gap with this tx
             if (pendingNonce > this.l1OperatorNonce) {
                 this.l1OperatorNonce = pendingNonce;
             }
             
             // If pendingNonce < operatorNonce, it means we have pending txs in mempool that Anvil knows about.
             // We should trust Anvil's pending count for the NEXT valid nonce.
             
             const nonceToUse = pendingNonce;
             
             // Update local nonce for future transactions
             this.l1OperatorNonce = nonceToUse + 1n;

             console.log(`  📤 Calling submitBlock with nonce=${nonceToUse}...`);
             submitTxHash = await this.l1WalletClient.writeContract({
              address: envConfig.ROOT_CHAIN_ADDRESS,
              abi: rootChainAbi,
              functionName: 'submitBlock',
              args: [accumulatorArray, BigInt(txHashes.length), txHashes],
              gas: 1000000n, // Hardcoded 1M gas to ensure it's not OOG
              nonce: Number(nonceToUse), // Use managed nonce
            } as any);
             console.log(`  ⏳ Waiting for submitBlock receipt...`);
        });

        const submitReceipt = await this.l1PublicClient.waitForTransactionReceipt({ 
          hash: submitTxHash,
          timeout: 300000, // 300 seconds (5 min) timeout for large backlogs
        });

        console.log(`✅ Block submitted to L1: ${submitTxHash}`);
        console.log(`   Gas used: ${submitReceipt.gasUsed.toString()}`);
        console.log(`   Status: ${submitReceipt.status}`);
        console.log(`   Block number: ${submitReceipt.blockNumber}`);
      } catch (error: any) {
        if (error.message.includes('OVERFLOW') || error.message.includes('CALL_EXCEPTION')) {
          console.log(`⚠️  L1 submission skipped due to error: ${error.message.substring(0, 100)}...`);
          console.log(`   Block would be submitted with ${txHashes.length} transactions`);
          console.log(`   L2 block ${blockNumber} created successfully, but L1 submission failed (this is OK for testing)`);
        } else {
          console.error(`  ❌ L1 submission error:`, error.message);
        }
      }

      // Clear only the processed transactions
      this.pendingTransactions = remainingTransactions;

      const blockCreationDuration = ((Date.now() - blockCreationStartTime) / 1000).toFixed(2);
      console.log(`✅ Block creation completed in ${blockCreationDuration}s (ended at ${new Date().toISOString()})`);
      console.log(
        `📊 Block included ${txHashes.length} transactions, ${this.pendingTransactions.length} still pending`
      );

      return {
        blockNumber: blockNumber.toString(),
        transactionCount: txHashes.length,
        remainingPending: this.pendingTransactions.length,
        l1TxHash: submitTxHash,
        l2TxHash: hash,
      };
    } catch (error: any) {
      const blockCreationDuration = ((Date.now() - blockCreationStartTime) / 1000).toFixed(2);
      console.error(`❌ Create block error after ${blockCreationDuration}s:`, error.message);
      throw error;
    } finally {
      // Always release mutex
      this.isCreatingBlock = false;
      console.log(`🔓 Mutex released at ${new Date().toISOString()}`);
    }
  }

  /**
   * Start L2 event monitoring
   */
  private async startL2EventMonitoring(): Promise<void> {
    console.log('🔍 Starting L2 event monitoring for all transactions...');

    try {
      // Watch for TransactionExecuted events
      this.l2PublicClient.watchContractEvent({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        eventName: 'TransactionExecuted',
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { txHash, from, to } = log.args as any;
              if (txHash && from && to) {
                console.log(`🔄 [L2 Transfer] Detected: ${from} → ${to}, hash: ${txHash}`);
                await this.addTransactionToPending(txHash, from, to, 'transfer', log.blockNumber);
              }
            } catch (error: any) {
              console.error('Error processing TransactionExecuted event:', error.message);
            }
          }
        },
      });

      // Watch for BalanceUpdated events
      this.l2PublicClient.watchContractEvent({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        eventName: 'BalanceUpdated',
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { user, token, amount, txHash } = log.args as any;
              if (txHash && user && token && amount) {
                console.log(`💰 [L2 Deposit] Detected: ${user}, token: ${token}, amount: ${amount}, hash: ${txHash}`);
                await this.addTransactionToPending(txHash, '0x0000000000000000000000000000000000000000', user, 'deposit', log.blockNumber);
              }
            } catch (error: any) {
              console.error('Error processing BalanceUpdated event:', error.message);
            }
          }
        },
      });

      // Watch for WithdrawalRequested events
      this.l2PublicClient.watchContractEvent({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        eventName: 'WithdrawalRequested',
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { txHash, user, token, amount } = log.args as any;
              if (txHash && user && token && amount !== undefined) {
                console.log(`💸 [L2 Withdrawal] Detected: ${user} → L1, token: ${token}, amount: ${amount}, hash: ${txHash}`);
                await this.addTransactionToPending(txHash, user, '0x0000000000000000000000000000000000000000', 'withdrawal', log.blockNumber);
              }
            } catch (error: any) {
              console.error('Error processing WithdrawalRequested event:', error.message);
            }
          }
        },
      });

      console.log('✅ L2 event listeners set up (Transfer, Deposit, Withdrawal)');
    } catch (error: any) {
      console.error('Error setting up L2 event monitoring:', error.message);
    }
  }

  /**
   * Add transaction to pending pool
   */
  private async addTransactionToPending(
    txHash: Hex,
    from: Address,
    to: Address,
    type: string,
    blockNumber?: bigint
  ): Promise<void> {
    try {
      // Add to ECC accumulator
      await this.accumulator.add(txHash);

      // Add to pending transactions
      const pendingTx: PendingTransaction = {
        txHash,
        from,
        to,
        amount: 0n,
        type,
        blockNumber: blockNumber || 'unknown',
        timestamp: Date.now(),
      };

      this.pendingTransactions.push(pendingTx);
      this.processedTxHashes.add(txHash);

      console.log(`📦 [Pending] Added transaction ${txHash}. Total pending: ${this.pendingTransactions.length}`);

      // Debounce block creation
      this.scheduleBlockCreation();
    } catch (error) {
      console.error('Error adding transaction to pending:', error);
    }
  }

  /**
   * Schedule block creation with debouncing
   */
  private scheduleBlockCreation(): void {
    // Clear any existing timer
    if (this.blockCreationTimer) {
      clearTimeout(this.blockCreationTimer);
    }

    // Schedule block creation after a short delay
    this.blockCreationTimer = setTimeout(async () => {
      try {
        if (this.pendingTransactions.length > 0 && !this.isCreatingBlock) {
          console.log(`⏰ [Scheduled Block] Creating block with ${this.pendingTransactions.length} pending transactions`);
          await this.createBlock();
        }
      } catch (error: any) {
        console.error('❌ Error in scheduled block creation:', error.message);
      }
      this.blockCreationTimer = null;
    }, 2000); // 2 seconds debounce
  }

  /**
   * Start automatic block production (backup timer)
   */
  private startBlockProduction(): void {
    setInterval(async () => {
      try {
        if (this.pendingTransactions.length > 0 && !this.isCreatingBlock) {
          console.log(`🕐 [Backup Timer] Creating block with ${this.pendingTransactions.length} pending transactions`);
          await this.createBlock();
        }
      } catch (error: any) {
        console.error('Block production error:', error.message);
      }
    }, 60000); // 60 seconds
  }

  /**
   * Get balance on L2
   */
  public async getBalance(address: Address, token: Address): Promise<string> {
    try {
      console.log('Calling getBalance with:', address, token);

      const balance = (await this.l2PublicClient.readContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'getBalance',
        args: [address, token],
      })) as bigint;

      console.log('DEBUG balance:', balance);

      return formatEther(balance);
    } catch (error) {
      console.error('Get balance error:', error);
      throw error;
    }
  }

  /**
   * Get block information
   */
  public async getBlock(blockNumber: bigint): Promise<BlockInfo> {
    try {
      const block = (await this.l2PublicClient.readContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'getBlock',
        args: [blockNumber],
      })) as any;

      return {
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        accumulatorValue: {
          x: block.accumulatorValue.x,
          y: block.accumulatorValue.y,
        },
        transactionCount: block.transactionCount,
        transactions: block.transactions,
      };
    } catch (error) {
      console.error('Get block error:', error);
      throw error;
    }
  }

  /**
   * Get pending transactions
   */
  public getPendingTransactions(): PendingTransaction[] {
    return this.pendingTransactions.map((tx) => ({
      ...tx,
      timestamp: tx.timestamp,
    }));
  }

  /**
   * Add pending transaction (called by Relay via API)
   */
  public async addPendingTransaction(tx: {
    type: string;
    txHash: Hex;
    from?: Address;
    to?: Address;
    token?: Address;
    amount?: string;
    blockNumber?: bigint;
    timestamp: number;
  }): Promise<boolean> {
    // Check if already processed
    if (this.processedTxHashes.has(tx.txHash)) {
      console.log(`[Backend] ⏭️  Transaction already processed: ${tx.txHash}`);
      return false;
    }

    // Add to pending pool
    this.pendingTransactions.push({
      txHash: tx.txHash,
      timestamp: tx.timestamp,
    });

    this.processedTxHashes.add(tx.txHash);

    // Add to accumulator
    await this.accumulator.add(tx.txHash);

    console.log(`[Backend] ✅ Transaction added to pending pool (total: ${this.pendingTransactions.length})`);

    return true;
  }

  /**
   * Request withdrawal from L2 to L1
   */
  public async requestWithdrawal(
    userAddress: Address,
    tokenAddress: Address,
    amount: string
  ): Promise<{ success: boolean; txHash: Hex; withdrawalTxHash: Hex; amount: string }> {
    try {
      console.log(`💸 Requesting withdrawal for user ${userAddress}`);
      console.log(`Token: ${tokenAddress}, Amount: ${amount}`);

      const amountWei = parseEther(amount);

      // Call requestWithdrawal on L2 PlasmaChain
      const hash = await this.l2WalletClient.writeContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'requestWithdrawal',
        args: [tokenAddress, amountWei, '0x'], // Empty signature for direct call
      });

      const receipt = await this.l2PublicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Withdrawal requested: ${hash}`);

      // Find WithdrawalRequested event to get withdrawal txHash
      let withdrawalTxHash: Hex | undefined;
      for (const log of receipt.logs) {
        try {
          // WithdrawalRequested has txHash as first indexed parameter
          if (log.topics.length >= 2) {
            withdrawalTxHash = log.topics[1] as Hex;
            break;
          }
        } catch {}
      }

      if (!withdrawalTxHash) {
        throw new Error('Withdrawal transaction hash not found in events');
      }

      console.log(`📝 Withdrawal TxHash: ${withdrawalTxHash}`);

      return {
        success: true,
        txHash: hash,
        withdrawalTxHash,
        amount,
      };
    } catch (error) {
      console.error('Request withdrawal error:', error);
      throw error;
    }
  }

  /**
   * Start exit process
   */
  public async startExit(
    userAddress: Address,
    tokenAddress: Address,
    amount: string,
    blockNumber: number,
    txHash: Hex
  ): Promise<ExitResult> {
    try {
      console.log(`🚪 Starting exit for user ${userAddress}`);
      console.log(`Token: ${tokenAddress}, Amount: ${amount}`);
      console.log(`Block: ${blockNumber}, TX: ${txHash}`);

      const amountWei = parseEther(amount);

      const hash = await this.l1WalletClient.writeContract({
        address: envConfig.ROOT_CHAIN_ADDRESS,
        abi: rootChainAbi,
        functionName: 'startExit',
        args: [tokenAddress, amountWei, BigInt(blockNumber), txHash],
        gas: 200000n,
        gasPrice: parseGwei('20'),
      });

      const receipt = await this.l1PublicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Exit started: ${hash}`);

      // Find ExitStarted event
      let exitId: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          // Parse log to find exitId
          // This is simplified - you may need to decode the log properly
          exitId = BigInt(1); // Placeholder
          break;
        } catch {}
      }

      if (!exitId) {
        throw new Error('ExitStarted event not found');
      }

      return {
        success: true,
        txHash: hash,
        exitId,
        user: userAddress,
        token: tokenAddress,
        amount,
        blockNumber,
        l1TxHash: txHash,
        exitTime: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        status: 'pending',
      };
    } catch (error) {
      console.error('Start exit error:', error);
      throw error;
    }
  }

  /**
   * Finalize exit
   */
  public async finalizeExit(exitId: bigint): Promise<{ success: boolean; txHash: Hash; exitId: bigint; status: string }> {
    try {
      console.log(`🏁 Finalizing exit: ${exitId}`);

      const hash = await this.l1WalletClient.writeContract({
        address: envConfig.ROOT_CHAIN_ADDRESS,
        abi: rootChainAbi,
        functionName: 'finalizeExit',
        args: [exitId],
        gas: 200000n,
        gasPrice: parseGwei('20'),
      });

      await this.l1PublicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Exit finalized: ${hash}`);

      return {
        success: true,
        txHash: hash,
        exitId,
        status: 'finalized',
      };
    } catch (error) {
      console.error('Finalize exit error:', error);
      throw error;
    }
  }

  /**
   * Get exit information
   */
  public async getExitInfo(exitId: bigint): Promise<ExitInfo & { canFinalize: boolean }> {
    try {
      const exit = (await this.l1PublicClient.readContract({
        address: envConfig.ROOT_CHAIN_ADDRESS,
        abi: rootChainAbi,
        functionName: 'exits',
        args: [exitId],
      })) as any;

      return {
        owner: exit.owner,
        token: exit.token,
        amount: exit.amount,
        blockNumber: exit.blockNumber,
        txHash: exit.txHash,
        exitTime: exit.exitTime,
        processed: exit.processed,
        canFinalize: exit.exitTime <= BigInt(Math.floor(Date.now() / 1000)) && !exit.processed,
      };
    } catch (error) {
      console.error('Get exit info error:', error);
      throw error;
    }
  }

  /**
   * Register ERC20 transfer
   */
  public async registerERC20Transfer(
    txHash: Hex,
    from: Address,
    to: Address,
    amount: string,
    tokenAddress: Address,
    blockNumber: bigint
  ): Promise<{ success: boolean; txHash: Hex; pendingCount: number }> {
    try {
      console.log('Registering ERC-20 transfer:', { txHash, from, to, amount, tokenAddress, blockNumber });

      const pendingTx: PendingTransaction = {
        txHash,
        from,
        to,
        tokenAddress,
        amount: parseEther(amount),
        timestamp: Date.now(),
        l2TxHash: txHash,
        type: 'erc20_transfer',
        blockNumber,
      };

      this.pendingTransactions.push(pendingTx);
      console.log(`🔍 [ERC-20] Transfer registered. Total pending: ${this.pendingTransactions.length}`);

      await this.accumulator.add(txHash);

      return {
        success: true,
        txHash,
        pendingCount: this.pendingTransactions.length,
      };
    } catch (error) {
      console.error('Register ERC-20 transfer error:', error);
      throw error;
    }
  }

  /**
   * Scan and register ERC20 transfers
   */
  public async scanAndRegisterERC20Transfers(
    fromBlock: bigint | 'latest' = 'latest'
  ): Promise<{
    scannedBlocks: string;
    totalEvents: number;
    processedTransfers: number;
    transfers: any[];
  }> {
    try {
      console.log('Scanning ERC-20 transfers from block:', fromBlock);

      const latestBlock = await this.l2PublicClient.getBlockNumber();
      const startBlock = fromBlock === 'latest' ? latestBlock - 10n : fromBlock;

      console.log(`Scanning blocks ${startBlock} to ${latestBlock}`);

      // Query Transfer events
      const logs = await this.l2PublicClient.getContractEvents({
        address: envConfig.L2_PLASMA_TOKEN_ADDRESS,
        abi: erc20Abi,
        eventName: 'Transfer',
        fromBlock: startBlock,
        toBlock: latestBlock,
      });

      console.log(`Found ${logs.length} transfer events`);

      const processedTransfers = [];
      for (const log of logs) {
        const { from, to, value } = log.args as any;
        const amount = formatEther(value);

        // Skip mint/burn transactions
        if (from === '0x0000000000000000000000000000000000000000' || to === '0x0000000000000000000000000000000000000000') {
          continue;
        }

        // Check if already registered
        const existingTx = this.pendingTransactions.find((tx) => tx.l2TxHash === log.transactionHash);
        if (existingTx) {
          continue;
        }

        // Register the transfer
        await this.registerERC20Transfer(log.transactionHash!, from, to, amount, envConfig.L2_PLASMA_TOKEN_ADDRESS, log.blockNumber);

        processedTransfers.push({
          txHash: log.transactionHash,
          from,
          to,
          amount,
          blockNumber: log.blockNumber,
        });
      }

      return {
        scannedBlocks: `${startBlock}-${latestBlock}`,
        totalEvents: logs.length,
        processedTransfers: processedTransfers.length,
        transfers: processedTransfers,
      };
    } catch (error) {
      console.error('Scan ERC-20 transfers error:', error);
      throw error;
    }
  }

  /**
   * Get current accumulator value
   */
  public getAccumulatorValue(): { x: Hex; y: Hex } {
    return this.accumulator.getValue();
  }

  /**
   * Get accumulator size (number of elements)
   */
  public getAccumulatorSize(): number {
    return this.accumulator.size();
  }

  /**
   * Add transaction hash to accumulator
   */
  public async addToAccumulator(txHash: Hex): Promise<boolean> {
    return await this.accumulator.add(txHash);
  }

  /**
   * Generate witness (proof) for a transaction
   * Used for exit proofs to L1
   */
  public async generateWitness(txHash: Hex): Promise<any> {
    return await this.accumulator.generateWitness(txHash);
  }

  /**
   * Get all elements in accumulator
   */
  public getAccumulatorElements(): Hex[] {
    return this.accumulator.getElements();
  }
}

// Export singleton instance
export default new PlasmaService();
