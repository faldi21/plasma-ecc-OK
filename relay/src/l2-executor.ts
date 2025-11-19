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

// ABIs
const plasmaChainAbi = [
  {
    type: 'function',
    name: 'updateBalance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getBalance',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
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
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/**
 * L2 Executor
 * Handles execution of transactions on Layer 2
 */
export class L2Executor {
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

    console.log('[L2 Executor] Initialized');
    console.log(`[L2 Executor] Operator: ${this.account.address}`);
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
    // Default: return same address (could be extended for more tokens)
    return l1Token;
  }

  /**
   * Update balance on L2 PlasmaChain
   */
  public async updateBalance(
    user: Address,
    l1Token: Address,
    amount: bigint
  ): Promise<Hex> {
    const l2Token = this.mapL1ToL2Token(l1Token);

    console.log(`[L2 Executor] Updating balance for ${user}`);
    console.log(`  Token L1: ${l1Token}`);
    console.log(`  Token L2: ${l2Token}`);
    console.log(`  Amount:   ${amount.toString()}`);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.l2PlasmaChainAddress,
        abi: plasmaChainAbi,
        functionName: 'updateBalance',
        args: [user, l2Token, amount],
      } as any);

      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`  ✅ L2 updateBalance tx: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error(`  ❌ UpdateBalance failed:`, error.message);
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
    // Check if this is the L2 Plasma Token
    if (
      l2Token.toLowerCase() !==
      this.config.l2PlasmaTokenAddress.toLowerCase()
    ) {
      console.log(`  ℹ️  Skip mint: Not L2 PlasmaToken`);
      return null;
    }

    try {
      console.log(`[L2 Executor] Minting ${amount.toString()} tokens to ${user}`);

      const hash = await this.walletClient.writeContract({
        address: this.config.l2PlasmaTokenAddress,
        abi: tokenAbi,
        functionName: 'mint',
        args: [user, amount],
      } as any);

      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`  ✅ L2 mint tx: ${hash}`);
      return hash;
    } catch (error: any) {
      console.error(`  ❌ Mint failed:`, error.message);
      // Don't throw - minting is optional
      return null;
    }
  }

  /**
   * Relay a deposit: updateBalance + mint
   */
  public async relayDeposit(
    user: Address,
    l1Token: Address,
    amount: bigint
  ): Promise<RelayResult> {
    try {
      const l2Token = this.mapL1ToL2Token(l1Token);

      // Update balance
      const l2TxHash = await this.updateBalance(user, l1Token, amount);

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
   * Get balance on L2
   */
  public async getBalance(user: Address, token: Address): Promise<bigint> {
    try {
      const balance = (await this.publicClient.readContract({
        address: this.config.l2PlasmaChainAddress,
        abi: plasmaChainAbi,
        functionName: 'getBalance',
        args: [user, token],
      })) as bigint;

      return balance;
    } catch (error) {
      console.error('[L2 Executor] Error getting balance:', error);
      return 0n;
    }
  }
}

export default L2Executor;
