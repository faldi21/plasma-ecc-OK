import {
  createPublicClient,
  http,
  webSocket,
  type Address,
  type Hex,
  type PublicClient,
  type Log,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { RelayConfig, UTXODepositEvent } from './types.js';

// UTXO RootChain ABI
const rootChainUtxoAbi = [
  {
    type: 'event',
    name: 'DepositCreated',
    inputs: [
      { name: 'utxoId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'depositNonce', type: 'uint256', indexed: false },
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
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' },
        ],
      },
      { name: 'transactionCount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/**
 * L1 Monitor UTXO
 * Monitors L1 (Sepolia) for DepositCreated events (UTXO model)
 */
export class L1MonitorUTXO {
  private readonly config: RelayConfig;
  private readonly publicClient: PublicClient;
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

    console.log('[L1 Monitor UTXO] Initialized');
    console.log(`[L1 Monitor UTXO] RootChainUTXO: ${config.rootChainAddress}`);
    console.log(`[L1 Monitor UTXO] Operator: ${this.account.address}`);
    console.log(
      `[L1 Monitor UTXO] Transport: ${config.sepoliaWssUrl ? 'WebSocket' : 'HTTP'}`
    );
  }

  /**
   * Start monitoring L1 for DepositCreated events
   */
  public async startMonitoring(
    fromBlock: bigint,
    onDeposit: (deposit: UTXODepositEvent) => void | Promise<void>
  ): Promise<void> {
    if (this.isMonitoring) {
      console.log('[L1 Monitor UTXO] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    console.log(`[L1 Monitor UTXO] Starting from block ${fromBlock}`);

    try {
      // If WebSocket is available, use event watching
      if (this.config.sepoliaWssUrl) {
        await this.watchWithWebSocket(fromBlock, onDeposit);
      } else {
        // Fallback to polling
        await this.pollWithHttp(fromBlock, onDeposit);
      }
    } catch (error: any) {
      console.error('[L1 Monitor UTXO] Error in monitoring:', error.message);
      this.isMonitoring = false;
      throw error;
    }
  }

  /**
   * Watch events using WebSocket
   */
  private async watchWithWebSocket(
    fromBlock: bigint,
    onDeposit: (deposit: UTXODepositEvent) => void | Promise<void>
  ): Promise<void> {
    console.log('[L1 Monitor UTXO] Using WebSocket event watching');

    // Get historical events first
    const historicalLogs = await this.publicClient.getLogs({
      address: this.config.rootChainAddress,
      event: rootChainUtxoAbi[0], // DepositCreated event
      fromBlock,
      toBlock: 'latest',
    });

    console.log(
      `[L1 Monitor UTXO] Found ${historicalLogs.length} historical UTXO deposits`
    );

    // Process historical events
    for (const log of historicalLogs) {
      const deposit = this.parseDepositCreatedLog(log);
      await onDeposit(deposit);
    }

    // Watch for new events
    this.unwatch = this.publicClient.watchContractEvent({
      address: this.config.rootChainAddress,
      abi: rootChainUtxoAbi,
      eventName: 'DepositCreated',
      onLogs: async (logs) => {
        console.log(`[L1 Monitor UTXO] Received ${logs.length} new UTXO deposit(s)`);
        for (const log of logs) {
          const deposit = this.parseDepositCreatedLog(log);
          await onDeposit(deposit);
        }
      },
      onError: (error) => {
        console.error('[L1 Monitor UTXO] WebSocket error:', error.message);
      },
    });

    console.log('[L1 Monitor UTXO] WebSocket watching active');
  }

  /**
   * Poll events using HTTP
   */
  private async pollWithHttp(
    fromBlock: bigint,
    onDeposit: (deposit: UTXODepositEvent) => void | Promise<void>
  ): Promise<void> {
    console.log('[L1 Monitor UTXO] Using HTTP polling (every 30 seconds)');

    let currentBlock = fromBlock;
    const pollInterval = 30000; // 30 seconds

    const poll = async () => {
      if (!this.isMonitoring) return;

      try {
        const latestBlock = await this.publicClient.getBlockNumber();

        if (latestBlock > currentBlock) {
          const logs = await this.publicClient.getLogs({
            address: this.config.rootChainAddress,
            event: rootChainUtxoAbi[0], // DepositCreated event
            fromBlock: currentBlock + 1n,
            toBlock: latestBlock,
          });

          if (logs.length > 0) {
            console.log(
              `[L1 Monitor UTXO] Found ${logs.length} new UTXO deposit(s) from block ${currentBlock + 1n} to ${latestBlock}`
            );

            for (const log of logs) {
              const deposit = this.parseDepositCreatedLog(log);
              await onDeposit(deposit);
            }
          }

          currentBlock = latestBlock;
        }
      } catch (error: any) {
        console.error('[L1 Monitor UTXO] Polling error:', error.message);
      }

      // Schedule next poll
      setTimeout(poll, pollInterval);
    };

    // Start polling
    await poll();
    console.log('[L1 Monitor UTXO] HTTP polling active');
  }

  /**
   * Parse DepositCreated event log
   */
  private parseDepositCreatedLog(log: Log): UTXODepositEvent {
    const { args, blockNumber, transactionHash, logIndex } = log as any;

    return {
      utxoId: args.utxoId as Hex,
      user: args.user as Address,
      token: args.token as Address,
      amount: args.amount as bigint,
      depositNonce: args.depositNonce as bigint,
      blockNumber: blockNumber as bigint,
      transactionHash: transactionHash as Hex,
      logIndex: logIndex as number,
    };
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) return;

    console.log('[L1 Monitor UTXO] Stopping monitoring');
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

export default L1MonitorUTXO;
