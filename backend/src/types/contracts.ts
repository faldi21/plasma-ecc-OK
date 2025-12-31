import type { Address, Hex } from 'viem';

// ECC Accumulator Point
export interface AccumulatorPoint {
  x: Hex;
  y: Hex;
}

// ECC Accumulator Witness
export interface AccumulatorWitness {
  x: Hex;
  y: Hex;
}

// Block Info
export interface BlockInfo {
  blockNumber: bigint;
  timestamp: bigint;
  accumulatorValue: AccumulatorPoint;
  transactionCount: bigint;
  transactions: readonly Hex[];
}

// Exit Info
export interface ExitInfo {
  owner: Address;
  token: Address;
  amount: bigint;
  blockNumber: bigint;
  txHash: Hex;
  exitTime: bigint;
  processed: boolean;
}

// Deposit Event
export interface DepositEvent {
  user: Address;
  token: Address;
  amount: bigint;
}

// Transaction Executed Event
export interface TransactionExecutedEvent {
  txHash: Hex;
  from: Address;
  to: Address;
  token: Address;
  amount: bigint;
  nonce: bigint;
}

// Balance Updated Event
export interface BalanceUpdatedEvent {
  user: Address;
  token: Address;
  amount: bigint;
  txHash: Hex;
}

// Block Created Event
export interface BlockCreatedEvent {
  blockNumber: bigint;
  transactionCount: bigint;
  accumulatorValue: AccumulatorPoint;
  timestamp: bigint;
}

// Exit Started Event
export interface ExitStartedEvent {
  exitId: bigint;
  user: Address;
  token: Address;
  amount: bigint;
  blockNumber: bigint;
}

// Exit Finalized Event
export interface ExitFinalizedEvent {
  exitId: bigint;
  user: Address;
  amount: bigint;
}

// Block Submitted Event
export interface BlockSubmittedEvent {
  blockNumber: bigint;
  accumulatorValue: Hex;
  transactionCount: bigint;
}

// Pending Transaction
export interface PendingTransaction {
  txHash: Hex;
  from: Address;
  to: Address;
  tokenAddress?: Address;
  amount: bigint;
  timestamp: number;
  l2TxHash?: Hex;
  type?: string;
  blockNumber?: bigint | string;
  nonce?: bigint;
}

// Transfer Request
export interface TransferRequest {
  from: Address;
  to: Address;
  token: Address;
  amount: string;
  privateKey: Hex;
}

// Deposit Request
export interface DepositRequest {
  user: Address;
  token: Address;
  amount: string;
}

// Exit Request
export interface ExitRequest {
  user: Address;
  token: Address;
  amount: string;
  blockNumber: number;
  txHash: Hex;
}

// Block Creation Result
export interface BlockCreationResult {
  blockNumber: string;
  transactionCount: number;
  remainingPending: number;
  l1TxHash: Hex | null;
  l2TxHash: Hex;
}

// Transfer Result
export interface TransferResult {
  success: boolean;
  txHash: Hex;
  l2TxHash: Hex;
  from: Address;
  to: Address;
  amount: string;
}

// Exit Result
export interface ExitResult {
  success: boolean;
  txHash: Hex;
  exitId: bigint;
  user: Address;
  token: Address;
  amount: string;
  blockNumber: number;
  l1TxHash: Hex;
  exitTime: number;
  status: string;
}

// Contract Config
export interface ContractConfig {
  address: Address;
  abi: any;
}

// Environment Variables
export interface EnvConfig {
  SEPOLIA_RPC_URL: string;
  SEPOLIA_WSS_URL?: string;
  L2_RPC_URL: string;
  OPERATOR_PRIVATE_KEY: Hex;
  L2_OPERATOR_PRIVATE_KEY: Hex;
  ROOT_CHAIN_ADDRESS: Address;
  PLASMA_CHAIN_ADDRESS?: Address;
  PLASMA_TOKEN_ADDRESS: Address;
  L2_PLASMA_CHAIN_ADDRESS: Address;
  L2_PLASMA_TOKEN_ADDRESS: Address;
  PORT?: string;
  // UTXO Contract Addresses
  ROOT_CHAIN_UTXO_ADDRESS?: Address;
  PLASMA_CHAIN_UTXO_ADDRESS?: Address;
}

// UTXO Types
export interface UTXO {
  utxoId: Hex;
  owner: Address;
  token: Address;
  amount: bigint;
  createdInBlock: bigint;
  spent: boolean;
  exited: boolean;
}

export interface UTXODepositEvent {
  utxoId: Hex;
  user: Address;
  token: Address;
  amount: bigint;
  depositNonce: bigint;
}

export interface UTXOTransferResult {
  success: boolean;
  txHash: Hex;
  inputUtxoIds: Hex[];
  outputUtxoIds: Hex[];
}

export interface UTXOExitResult {
  success: boolean;
  exitId: Hex;
  utxoId: Hex;
  amount: bigint;
  exitTime: bigint;
}
