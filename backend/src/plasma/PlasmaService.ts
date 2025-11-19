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
export class PlasmaService {
  // Clients
  private readonly l1PublicClient: PublicClient;
  private readonly l2PublicClient: PublicClient;
  private readonly l1WalletClient: WalletClient;
  private readonly l2WalletClient: WalletClient;

  // Accounts
  private readonly operatorAccount: ReturnType<typeof privateKeyToAccount>;
  private readonly l2OperatorAccount: ReturnType<typeof privateKeyToAccount>;

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
      });

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
  public async processTransfer(
    from: Address,
    to: Address,
    tokenAddress: Address,
    amount: string,
    signature: Hex,
    nonce: string,
    timestamp?: number
  ): Promise<TransferResult> {
    try {
      console.log('Processing transfer:', { from, to, tokenAddress, amount, nonce, timestamp });

      // Verify nonce matches
      const currentNonce = (await this.l2PublicClient.readContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'nonces',
        args: [from],
      })) as bigint;

      console.log('Current nonce for', from, ':', currentNonce.toString(), 'Provided nonce:', nonce);

      if (currentNonce.toString() !== nonce) {
        throw new Error(`Nonce mismatch. Current: ${currentNonce}, Provided: ${nonce}`);
      }

      // Execute transaction on L2
      const amountWei = parseEther(amount);

      const hash = await this.l2WalletClient.writeContract({
        address: envConfig.L2_PLASMA_CHAIN_ADDRESS,
        abi: plasmaChainAbi,
        functionName: 'executeTransaction',
        args: [from, to, tokenAddress, amountWei, BigInt(nonce), signature],
      });

      const receipt = await this.l2PublicClient.waitForTransactionReceipt({ hash });

      console.log('Transfer transaction executed:', hash);

      // Get transaction hash from event
      let txHash: Hex | undefined;
      for (const log of receipt.logs) {
        try {
          // Find TransactionExecuted event
          if (log.topics[0] === keccak256(encodeAbiParameters(parseAbiParameters('string'), ['TransactionExecuted(bytes32,address,address,address,uint256,uint256)']))) {
            txHash = log.topics[1] as Hex; // txHash is the first indexed parameter
            break;
          }
        } catch {}
      }

      if (!txHash) {
        throw new Error('Transaction hash not found in events');
      }

      console.log('Transaction hash from event:', txHash);

      // Add to pending transactions
      this.pendingTransactions.push({
        txHash,
        from,
        to,
        tokenAddress,
        amount: amountWei,
        timestamp: Date.now(),
        l2TxHash: hash,
      });

      console.log(`🔍 [DEBUG] Transaction added to pending pool. Total pending: ${this.pendingTransactions.length}`);

      // Add to accumulator
      await this.accumulator.add(txHash);

      console.log(`Transaction added to pending pool. Total pending: ${this.pendingTransactions.length}`);

      return {
        success: true,
        txHash,
        l2TxHash: hash,
        from,
        to,
        amount,
      };
    } catch (error: any) {
      console.error('Process transfer error:', error.message);
      throw error;
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

        // Submit with explicit gas limit
        submitTxHash = await this.l1WalletClient.writeContract({
          address: envConfig.ROOT_CHAIN_ADDRESS,
          abi: rootChainAbi,
          functionName: 'submitBlock',
          args: [accumulatorArray, BigInt(txHashes.length), txHashes],
          gas: (gasEstimate * 12n) / 10n, // Add 20% buffer
        });

        const submitReceipt = await this.l1PublicClient.waitForTransactionReceipt({ hash: submitTxHash });

        console.log(`✅ Block submitted to L1: ${submitTxHash} (gas used: ${submitReceipt.gasUsed.toString()})`);
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

      console.log('✅ L2 event listeners set up');
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
      if (this.pendingTransactions.length > 0 && !this.isCreatingBlock) {
        console.log(`⏰ [Scheduled Block] Creating block with ${this.pendingTransactions.length} pending transactions`);
        await this.createBlock();
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
}

// Export singleton instance
export default new PlasmaService();
