#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import {
  createPublicClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { PlasmaChainABI } from '../backend/abi/PlasmaChain.ts';

// Get current file directory and load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

console.log(`[dotenv] Loading from: ${envPath}\n`);

// L2 Chain config (Anvil)
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
    public: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
  },
} as const;

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';

// Extract TransactionExecuted event from PlasmaChain ABI
const transactionExecutedEvent = PlasmaChainABI[0].abi.find(
  (item: any) => item.type === 'event' && item.name === 'TransactionExecuted'
);

// API Response Types
interface PendingTransaction {
  txHash: Hex;
  from: Address;
  to: Address;
  token?: Address;
  amount: string;
  timestamp: number;
  nonce?: string;
}

interface PendingTransactionsResponse {
  success: boolean;
  count: number;
  transactions: PendingTransaction[];
  error?: string;
}

interface TransferEvent {
  txHash: Hex;
  from: Address;
  to: Address;
  blockNumber: bigint;
  transactionHash?: Hex;
}

/**
 * Check if API is available
 */
async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${API_BASE_URL}/health`, {
      timeout: 5000,
    });
    return response.data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get pending transactions from API
 */
async function getPendingTransactions(): Promise<PendingTransaction[]> {
  try {
    const response = await axios.get<PendingTransactionsResponse>(
      `${API_BASE_URL}/api/pending-transactions`,
      { timeout: 10000 }
    );

    if (response.data.success) {
      return response.data.transactions;
    }

    return [];
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to API at ${API_BASE_URL}`);
      console.error(`   Make sure backend is running: cd backend && npm run dev`);
    } else {
      console.error(`Error getting pending transactions: ${error.message}`);
    }
    return [];
  }
}

/**
 * Get recent confirmed transfers from L2 chain
 */
async function getRecentTransfers(
  publicClient: any,
  plasmaChainAddress: Address,
  fromBlock: bigint = 0n
): Promise<TransferEvent[]> {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    // Ensure searchFromBlock is not negative
    const searchFromBlock = fromBlock > 0n
      ? fromBlock
      : currentBlock > 100n
        ? currentBlock - 100n
        : 0n; // Last 100 blocks or from genesis

    if (!transactionExecutedEvent) {
      console.error('TransactionExecuted event not found in ABI');
      return [];
    }

    const logs = await publicClient.getLogs({
      address: plasmaChainAddress,
      event: transactionExecutedEvent,
      fromBlock: searchFromBlock,
      toBlock: currentBlock,
    });

    return logs.map((log: any) => ({
      txHash: log.args.txHash,
      from: log.args.from,
      to: log.args.to,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    }));
  } catch (error: any) {
    console.error(`Error getting recent transfers: ${error.message}`);
    return [];
  }
}

/**
 * Check specific transaction hash status
 */
async function checkTransactionStatus(
  publicClient: any,
  txHash: Hex
): Promise<{ found: boolean; blockNumber?: bigint; status?: string }> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

    if (receipt) {
      return {
        found: true,
        blockNumber: receipt.blockNumber,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
      };
    }

    return { found: false };
  } catch (error: any) {
    // Transaction not found or other error
    return { found: false };
  }
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Plasma L2 Transfer Status Checker');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nUsage:');
    console.log('  npx tsx 7-check-transfer.ts [txHash]');
    console.log('\nArguments:');
    console.log('  txHash  - Optional: Check specific transaction hash (0x...)');
    console.log('\nExamples:');
    console.log('  # Check all pending and recent transfers');
    console.log('  npx tsx 7-check-transfer.ts');
    console.log('');
    console.log('  # Check specific transaction');
    console.log('  npx tsx 7-check-transfer.ts 0x1234...abcd');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  }

  const specificTxHash = args.length > 0 ? (args[0] as Hex) : null;

  // Environment validation
  const l2PlasmaChainAddress = process.env.L2_PLASMA_CHAIN_ADDRESS as Address;
  const l2PlasmaTokenAddress = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;

  if (!l2PlasmaChainAddress || !l2PlasmaTokenAddress) {
    console.error('❌ Error: L2_PLASMA_CHAIN_ADDRESS or L2_PLASMA_TOKEN_ADDRESS not found in .env');
    process.exit(1);
  }

  // Setup L2 client
  const publicClient = createPublicClient({
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Plasma L2 Transfer Status Checker');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nConfiguration:');
  console.log(`  L2 RPC:       ${L2_RPC_URL}`);
  console.log(`  Backend API:  ${API_BASE_URL}`);
  console.log(`  PlasmaChain:  ${l2PlasmaChainAddress}`);
  console.log(`  PlasmaToken:  ${l2PlasmaTokenAddress}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Check if specific transaction hash provided
    if (specificTxHash) {
      console.log(`🔎 Checking transaction: ${specificTxHash}\n`);

      const status = await checkTransactionStatus(publicClient, specificTxHash);

      if (status.found) {
        console.log('✅ Transaction Found:');
        console.log(`  Status:       ${status.status}`);
        console.log(`  Block Number: ${status.blockNumber}`);
      } else {
        console.log('⚠️  Transaction not found on L2 chain');
        console.log('   It may be pending or not yet submitted');
      }

      // Check if it's in pending transactions
      const apiAvailable = await checkApiHealth();
      if (apiAvailable) {
        const pending = await getPendingTransactions();
        const isPending = pending.find((tx) => tx.txHash === specificTxHash);

        if (isPending) {
          console.log('\n📋 Found in Pending Transactions:');
          console.log(`  From:      ${isPending.from}`);
          console.log(`  To:        ${isPending.to}`);
          console.log(`  Amount:    ${formatEther(BigInt(isPending.amount))} PLASMA`);
          console.log(`  Timestamp: ${new Date(isPending.timestamp).toISOString()}`);
        }
      }

      console.log('');
      process.exit(0);
    }

    // Otherwise, show all pending and recent transfers
    console.log('📊 Checking transfer status...\n');

    // 1. Check API health
    const apiAvailable = await checkApiHealth();
    console.log(`Backend API: ${apiAvailable ? '✅ Available' : '❌ Unavailable'}`);

    // 2. Get pending transactions from API
    let pending: PendingTransaction[] = [];
    if (apiAvailable) {
      pending = await getPendingTransactions();
      console.log(`Pending txs: ${pending.length}\n`);
    } else {
      console.log('⚠️  Cannot fetch pending transactions (backend not available)\n');
    }

    // 3. Get recent confirmed transfers from L2 chain
    console.log('🔍 Fetching recent confirmed transfers...\n');
    const recentTransfers = await getRecentTransfers(publicClient, l2PlasmaChainAddress);
    console.log(`Recent confirmed transfers: ${recentTransfers.length}\n`);

    // Display results
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 PENDING TRANSACTIONS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (pending.length === 0) {
      console.log('  No pending transactions\n');
    } else {
      pending.forEach((tx, index) => {
        console.log(`${index + 1}. Transaction Hash: ${tx.txHash}`);
        console.log(`   From:      ${tx.from}`);
        console.log(`   To:        ${tx.to}`);
        console.log(`   Amount:    ${formatEther(BigInt(tx.amount))} PLASMA`);
        console.log(`   Timestamp: ${new Date(tx.timestamp).toISOString()}`);
        console.log('');
      });
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RECENT CONFIRMED TRANSFERS (Last 100 blocks)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (recentTransfers.length === 0) {
      console.log('  No recent confirmed transfers\n');
    } else {
      recentTransfers.slice(0, 10).forEach((transfer, index) => {
        console.log(`${index + 1}. Plasma TxHash: ${transfer.txHash}`);
        console.log(`   From:         ${transfer.from}`);
        console.log(`   To:           ${transfer.to}`);
        console.log(`   Block:        ${transfer.blockNumber}`);
        if (transfer.transactionHash) {
          console.log(`   L2 Tx Hash:   ${transfer.transactionHash}`);
        }
        console.log('');
      });

      if (recentTransfers.length > 10) {
        console.log(`   ... and ${recentTransfers.length - 10} more transfers\n`);
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Pending:   ${pending.length}`);
    console.log(`  Confirmed: ${recentTransfers.length}`);
    console.log(`  Total:     ${pending.length + recentTransfers.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ Error checking transfer status!');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('\nError:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Make sure services are running:');
      console.error('   1. L2 (Anvil): anvil');
      console.error('   2. Backend: cd backend && npm run dev');
    } else if (error.message.includes('execution reverted')) {
      console.error('\n💡 Tip: Check if:');
      console.error('   - PlasmaChain contract is deployed');
      console.error('   - Contract addresses in .env are correct');
    }
    console.error('');
    process.exit(1);
  }
}

main();
