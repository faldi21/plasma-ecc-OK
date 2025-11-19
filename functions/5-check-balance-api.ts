#!/usr/bin/env tsx

/**
 * Check Balance via Backend API
 *
 * Query balances melalui backend REST API
 * Lebih mudah dan tidak perlu setup client
 */

import axios from 'axios';
import type { Address } from 'viem';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Force load .env from project root
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

interface BalanceResponse {
  success: boolean;
  balance?: string;
  error?: string;
}

interface PendingTransaction {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  timestamp: string;
}

interface PendingTransactionsResponse {
  success: boolean;
  count: number;
  transactions: PendingTransaction[];
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
 * Get balance from API
 */
async function getBalance(address: Address, token: Address): Promise<string> {
  try {
    const response = await axios.get<BalanceResponse>(
      `${API_BASE_URL}/api/balance/${address}/${token}`
    );

    if (response.data.success && response.data.balance) {
      return response.data.balance;
    }

    return '0';
  } catch (error: any) {
    console.error(`Error getting balance: ${error.message}`);
    return '0';
  }
}

/**
 * Get pending transactions
 */
async function getPendingTransactions(): Promise<PendingTransaction[]> {
  try {
    const response = await axios.get<PendingTransactionsResponse>(
      `${API_BASE_URL}/api/pending-transactions`
    );

    if (response.data.success) {
      return response.data.transactions;
    }

    return [];
  } catch (error: any) {
    console.error(`Error getting pending transactions: ${error.message}`);
    return [];
  }
}

/**
 * Format balance display
 */
function displayBalance(address: Address, token: Address, balance: string): void {
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const shortToken = `${token.slice(0, 6)}...${token.slice(-4)}`;

  console.log(`  ${shortAddr}  ${balance.padStart(15)} PLASMA  (Token: ${shortToken})`);
}

/**
 * Display pending transactions
 */
function displayPendingTransactions(transactions: PendingTransaction[]): void {
  console.log('\n📋 Pending Transactions:\n');

  if (transactions.length === 0) {
    console.log('  No pending transactions');
    return;
  }

  console.log('━'.repeat(100));
  console.log('From'.padEnd(15) + 'To'.padEnd(15) + 'Amount'.padEnd(20) + 'Hash'.padEnd(20) + 'Time');
  console.log('━'.repeat(100));

  transactions.forEach((tx) => {
    const from = `${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`;
    const to = `${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`;
    const hash = `${tx.txHash.slice(0, 6)}...${tx.txHash.slice(-4)}`;
    const time = new Date(tx.timestamp).toLocaleTimeString();

    console.log(from.padEnd(15) + to.padEnd(15) + tx.amount.padEnd(20) + hash.padEnd(20) + time);
  });

  console.log('━'.repeat(100));
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Check Balance via Backend API\n');

  // Check API health
  console.log('⏳ Checking API connection...');
  const isHealthy = await checkApiHealth();

  if (!isHealthy) {
    console.error('❌ Backend API is not available!');
    console.error(`   Make sure backend is running at ${API_BASE_URL}`);
    console.error('   Start backend: cd backend && npm run dev');
    process.exit(1);
  }

  console.log(`✅ API is available at ${API_BASE_URL}\n`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const showPending = args.includes('--pending') || args.includes('-p');

  // Get addresses and token from command line or use defaults
  let addresses: Address[] = [];
  let token: Address | undefined;

  for (const arg of args) {
    if (arg.startsWith('0x') && arg.length === 42) {
      if (!token) {
        // First address is token
        token = arg as Address;
      } else {
        // Rest are user addresses
        addresses.push(arg as Address);
      }
    }
  }

  // Use defaults if not provided
  if (!token) {
    token = (process.env.L2_PLASMA_TOKEN_ADDRESS ||
      '0x558785b76e29e5b9f8Bf428936480B49d71F3d76') as Address;
  }

  if (addresses.length === 0) {
    addresses = [
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x62dc14Fe819A241e176ee6A813f51045d04A0cda',
    ] as Address[];
  }

  console.log('Configuration:');
  console.log(`  API URL:  ${API_BASE_URL}`);
  console.log(`  Token:    ${token}`);
  console.log(`  Checking: ${addresses.length} addresses\n`);

  // Get balances
  console.log('💰 Balances:\n');
  console.log('━'.repeat(80));
  console.log('  Address'.padEnd(15) + 'Balance'.padStart(20));
  console.log('━'.repeat(80));

  for (const address of addresses) {
    const balance = await getBalance(address, token);
    displayBalance(address, token, balance);
  }

  console.log('━'.repeat(80));

  // Show pending transactions if requested
  if (showPending) {
    const pending = await getPendingTransactions();
    displayPendingTransactions(pending);
  }

  console.log('\n✅ Balance check complete!');
  console.log('\nUsage:');
  console.log('  tsx functions/5-check-balance-api.ts [token] [address1] [address2] [...] [flags]');
  console.log('\nExamples:');
  console.log('  # Check default addresses');
  console.log('  tsx functions/5-check-balance-api.ts');
  console.log('');
  console.log('  # Check specific address');
  console.log('  tsx functions/5-check-balance-api.ts 0xTokenAddress 0xUserAddress');
  console.log('');
  console.log('  # Show pending transactions');
  console.log('  tsx functions/5-check-balance-api.ts --pending');
  console.log('');
  console.log('Flags:');
  console.log('  --pending, -p    Show pending transactions');
}

// Run
main().catch((error) => {
  console.error('🚨 Fatal error:', error.message);
  process.exit(1);
});
