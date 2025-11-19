import type { Address, Hex } from 'viem';

/**
 * Relay State
 * Saved to .relay_state.json for persistence
 */
export interface RelayState {
  lastBlock: bigint;
  processed: string[]; // Array of "txHash:logIndex" keys
  relayedDeposits: number;
  lastSubmittedBlock?: number;
}

/**
 * Deposit Event from L1
 */
export interface DepositEvent {
  user: Address;
  token: Address;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

/**
 * Relay Transaction Result
 */
export interface RelayResult {
  success: boolean;
  l2TxHash: Hex;
  mintTxHash?: Hex;
  error?: string;
}

/**
 * Block Submission Data
 */
export interface BlockSubmissionData {
  blockNumber: number;
  transactionCount: number;
  txHashes: Hex[];
  accumulatorValue: {
    x: Hex;
    y: Hex;
  };
}

/**
 * Environment Configuration
 */
export interface RelayConfig {
  // L1 (Sepolia)
  sepoliaRpcUrl: string;
  sepoliaWssUrl?: string;
  rootChainAddress: Address;
  plasmaTokenAddress: Address;
  operatorPrivateKey: Hex;

  // L2 (Local)
  l2RpcUrl: string;
  l2PlasmaChainAddress: Address;
  l2PlasmaTokenAddress: Address;
  l2OperatorPrivateKey: Hex;

  // Relay settings
  l1FromBlock: bigint;
  relayTransactionsPerBlock: number;
  relayBlockTimeout: number;

  // Optional
  l2ApiUrl?: string;
}

/**
 * Pending Transactions from Backend API
 */
export interface PendingTransactionsResponse {
  success: boolean;
  count: number;
  transactions: Array<{
    txHash: Hex;
    from: Address;
    to: Address;
    amount: string;
    timestamp: string;
  }>;
}
