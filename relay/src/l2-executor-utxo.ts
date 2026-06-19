import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { RelayConfig, RelayResult } from './types.js';

// L2 Chain config (Anvil)
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
    public: { http: ['http://localhost:8545'] },
  },
} as const;

// PlasmaChainUTXO ABI
const plasmaChainUtxoAbi = [
  {
    type: 'function',
    name: 'createDepositUtxo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'depositUtxoId', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getUtxo',
    stateMutability: 'view',
    inputs: [{ name: 'utxoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'utxoId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'createdInBlock', type: 'uint256' },
          { name: 'spent', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getUserUtxos',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
] as const;

const tokenAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/**
 * L2 Executor UTXO
 * Handles execution of UTXO transactions on Layer 2
 */
export class L2ExecutorUTXO {
  private readonly config: RelayConfig;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(config: RelayConfig) {
    this.config = config;

    // Setup account
    this.account = privateKeyToAccount(config.l2OperatorPrivateKey);

    // Update chain config with actual L2 RPC URL
    const chainWithRpc = {
      ...l2Chain,
      rpcUrls: {
        default: { http: [config.l2RpcUrl] },
        public: { http: [config.l2RpcUrl] },
      },
    };

    // Setup clients
    this.publicClient = createPublicClient({
      chain: chainWithRpc,
      transport: http(config.l2RpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: chainWithRpc,
      transport: http(config.l2RpcUrl),
    });

    console.log('[L2 Executor UTXO] Initialized');
    console.log(`[L2 Executor UTXO] PlasmaChainUTXO: ${config.l2PlasmaChainAddress}`);
    console.log(`[L2 Executor UTXO] Operator: ${this.account.address}`);
  }

  /**
   * Map L1 token address to L2 token address
   */
  private mapL1ToL2Token(l1Token: Address): Address {
    if (
      l1Token.toLowerCase() === this.config.plasmaTokenAddress.toLowerCase()
    ) {
      return this.config.l2PlasmaTokenAddress;
    }
    return l1Token;
  }

  /**
   * Create deposit UTXO on L2
   */
  public async createDepositUtxo(
    utxoId: Hex,
    user: Address,
    l1Token: Address,
    amount: bigint
  ): Promise<Hex> {
    const l2Token = this.mapL1ToL2Token(l1Token);

    console.log(`[L2 Executor UTXO] Creating deposit UTXO`);
    console.log(`  UTXO ID: ${utxoId}`);
    console.log(`  User:    ${user}`);
    console.log(`  Token:   ${l2Token}`);
    console.log(`  Amount:  ${amount.toString()}`);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.l2PlasmaChainAddress,
        abi: plasmaChainUtxoAbi,
        functionName: 'createDepositUtxo',
        args: [utxoId, user, l2Token, amount],
      } as any);

      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`  L2 createDepositUtxo tx: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error(`  createDepositUtxo failed:`, error.message);
      throw error;
    }
  }

  /**
   * Mint tokens on L2 (if token owner)
   */
  public async mintTokens(
    user: Address,
    l2Token: Address,
    amount: bigint
  ): Promise<Hex | null> {
    if (
      l2Token.toLowerCase() !==
      this.config.l2PlasmaTokenAddress.toLowerCase()
    ) {
      console.log(`  Skip mint: Not L2 PlasmaToken`);
      return null;
    }

    try {
      console.log(`[L2 Executor UTXO] Minting ${amount.toString()} tokens to ${user}`);

      const hash = await this.walletClient.writeContract({
        address: this.config.l2PlasmaTokenAddress,
        abi: tokenAbi,
        functionName: 'mint',
        args: [user, amount],
      } as any);

      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`  L2 mint tx: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error(`  Mint failed:`, error.message);
      return null;
    }
  }

  /**
   * Relay a UTXO deposit: createDepositUtxo + mint
   */
  public async relayUtxoDeposit(
    utxoId: Hex,
    user: Address,
    l1Token: Address,
    amount: bigint
  ): Promise<RelayResult> {
    try {
      const l2Token = this.mapL1ToL2Token(l1Token);

      // Create deposit UTXO
      const l2TxHash = await this.createDepositUtxo(utxoId, user, l1Token, amount);

      // Mint tokens (optional)
      const mintTxHash = await this.mintTokens(user, l2Token, amount);

      return {
        success: true,
        l2TxHash,
        mintTxHash: mintTxHash || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        l2TxHash: '0x0' as Hex,
        error: error.message,
      };
    }
  }

  /**
   * Get UTXO info
   */
  public async getUtxo(utxoId: Hex): Promise<any> {
    try {
      const utxo = await this.publicClient.readContract({
        address: this.config.l2PlasmaChainAddress,
        abi: plasmaChainUtxoAbi,
        functionName: 'getUtxo',
        args: [utxoId],
      });

      return utxo;
    } catch (error) {
      console.error('[L2 Executor UTXO] Error getting UTXO:', error);
      return null;
    }
  }

  /**
   * Get user's UTXOs
   */
  public async getUserUtxos(user: Address): Promise<Hex[]> {
    try {
      const utxos = await this.publicClient.readContract({
        address: this.config.l2PlasmaChainAddress,
        abi: plasmaChainUtxoAbi,
        functionName: 'getUserUtxos',
        args: [user],
      }) as Hex[];

      return utxos;
    } catch (error) {
      console.error('[L2 Executor UTXO] Error getting user UTXOs:', error);
      return [];
    }
  }
}

export default L2ExecutorUTXO;
