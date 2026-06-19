import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Log,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { RelayConfig, DepositEvent } from './types.js';

// Legacy RootChain ABI
const rootChainAbi = [
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'submitBlock',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'accumulatorValue',
        type: 'tuple',
        components: [
          { name: 'x', type: 'bytes32' },
          { name: 'y', type: 'bytes32' },
        ],
      },
      { name: 'transactionCount', type: 'uint256' },
      { name: 'txHashes', type: 'bytes32[]' },
    ],
    outputs: [],
  },
] as const;

/**
 * L1 Monitor
 * Monitors L1 (Sepolia) for Deposit events
 */
export class L1Monitor {
  private readonly config: RelayConfig;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private isMonitoring = false;
  private unwatch?: () => void;

  constructor(config: RelayConfig) {
    this.config = config;

    // Setup account
    this.account = privateKeyToAccount(config.operatorPrivateKey);

    // Prefer WebSocket if available
    const transport = config.sepoliaWssUrl
      ? webSocket(config.sepoliaWssUrl, {
          keepAlive: true,
          reconnect: {
            attempts: 10,
            delay: 5000,
          },
        })
      : http(config.sepoliaRpcUrl);

    // Setup clients
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport,
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport: http(config.sepoliaRpcUrl),
    });

    console.log('[L1 Monitor] Initialized');
    console.log(`[L1 Monitor] Operator: ${this.account.address}`);
    console.log(
      `[L1 Monitor] Transport: ${config.sepoliaWssUrl ? 'WebSocket' : 'HTTP'}`
    );
  }

  /**
   * Start monitoring L1 for Deposit events
   */
  public async startMonitoring(
    fromBlock: bigint,
    onDeposit: (deposit: DepositEvent) => void | Promise<void>
  ): Promise<void> {
    if (this.isMonitoring) {
      console.log('[L1 Monitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    console.log(`[L1 Monitor] Starting from block ${fromBlock}`);

    try {
      // If WebSocket is available, use event watching
      if (this.config.sepoliaWssUrl) {
        await this.watchWithWebSocket(fromBlock, onDeposit);
      } else {
        // Fallback to polling
        await this.pollWithHttp(fromBlock, onDeposit);
      }
    } catch (error: any) {
      console.error('[L1 Monitor] Error in monitoring:', error.message);
      this.isMonitoring = false;
      throw error;
    }
  }

  /**
   * Watch events using WebSocket
   */
  private async watchWithWebSocket(
    fromBlock: bigint,
    onDeposit: (deposit: DepositEvent) => void | Promise<void>
  ): Promise<void> {
    console.log('[L1 Monitor] Using WebSocket event watching');

    // Get historical events first
    const historicalLogs = await this.publicClient.getLogs({
      address: this.config.rootChainAddress,
      event: rootChainAbi[0], // Deposit event
      fromBlock,
      toBlock: 'latest',
    });

    console.log(
      `[L1 Monitor] Found ${historicalLogs.length} historical deposits`
    );

    // Process historical events
    for (const log of historicalLogs) {
      const deposit = this.parseDepositLog(log);
      await onDeposit(deposit);
    }

    // Watch for new events
    this.unwatch = this.publicClient.watchContractEvent({
      address: this.config.rootChainAddress,
      abi: rootChainAbi,
      eventName: 'Deposit',
      onLogs: async (logs) => {
        console.log(`[L1 Monitor] Received ${logs.length} new deposit(s)`);
        for (const log of logs) {
          const deposit = this.parseDepositLog(log);
          await onDeposit(deposit);
        }
      },
      onError: (error) => {
        console.error('[L1 Monitor] WebSocket error:', error.message);
        // Will auto-reconnect due to reconnect config
      },
    });

    console.log('[L1 Monitor] ✅ WebSocket watching active');
  }

  /**
   * Poll events using HTTP
   */
  private async pollWithHttp(
    fromBlock: bigint,
    onDeposit: (deposit: DepositEvent) => void | Promise<void>
  ): Promise<void> {
    console.log('[L1 Monitor] Using HTTP polling (every 30 seconds)');

    let currentBlock = fromBlock;
    const pollInterval = 30000; // 30 seconds

    const poll = async () => {
      if (!this.isMonitoring) return;

      try {
        const latestBlock = await this.publicClient.getBlockNumber();

        if (latestBlock > currentBlock) {
          const logs = await this.publicClient.getLogs({
            address: this.config.rootChainAddress,
            event: rootChainAbi[0], // Deposit event
            fromBlock: currentBlock + 1n,
            toBlock: latestBlock,
          });

          if (logs.length > 0) {
            console.log(
              `[L1 Monitor] Found ${logs.length} new deposit(s) from block ${currentBlock + 1n} to ${latestBlock}`
            );

            for (const log of logs) {
              const deposit = this.parseDepositLog(log);
              await onDeposit(deposit);
            }
          }

          currentBlock = latestBlock;
        }
      } catch (error: any) {
        console.error('[L1 Monitor] Polling error:', error.message);
      }

      // Schedule next poll
      setTimeout(poll, pollInterval);
    };

    // Start polling
    await poll();
    console.log('[L1 Monitor] ✅ HTTP polling active');
  }

  /**
   * Parse Deposit event log
   */
  private parseDepositLog(log: Log): DepositEvent {
    const { args, blockNumber, transactionHash, logIndex } = log as any;

    return {
      user: args.user as Address,
      token: args.token as Address,
      amount: args.amount as bigint,
      blockNumber: blockNumber as bigint,
      transactionHash: transactionHash as Hex,
      logIndex: logIndex as number,
    };
  }

  /**
   * Submit block to L1 RootChain
   */
  public async submitBlock(
    blockNumber: number,
    transactionCount: number,
    txHashes: Hex[],
    accumulatorValue: { x: Hex; y: Hex }
  ): Promise<Hex> {
    console.log(`[L1 Monitor] Submitting block ${blockNumber} to L1`);
    console.log(`  Transactions: ${transactionCount}`);
    console.log(`  Accumulator X: ${accumulatorValue.x.slice(0, 10)}...`);
    console.log(`  Accumulator Y: ${accumulatorValue.y.slice(0, 10)}...`);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.rootChainAddress,
        abi: rootChainAbi,
        functionName: 'submitBlock',
        args: [
          accumulatorValue,
          BigInt(transactionCount),
          txHashes,
        ],
      } as any);

      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`  ✅ L1 submitBlock tx: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error(`  ❌ SubmitBlock failed:`, error.message);
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) return;

    console.log('[L1 Monitor] Stopping monitoring');
    this.isMonitoring = false;

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = undefined;
    }
  }

  /**
   * Get current block number
   */
  public async getCurrentBlock(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
  }

  /**
   * Check if monitoring is active
   */
  public isActive(): boolean {
    return this.isMonitoring;
  }
}

export default L1Monitor;
