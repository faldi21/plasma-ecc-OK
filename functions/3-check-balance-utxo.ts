#!/usr/bin/env tsx

/**
 * UTXO Balance Checker
 *
 * Checks balance in UTXO model by:
 * - Querying backend API for user's UTXOs
 * - Summing unspent UTXO amounts
 * - Also shows L1 token balance for comparison
 */

import {
  createPublicClient,
  http,
  formatEther,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

// Environment variables
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_TOKEN_ADDRESS = process.env.PLASMA_TOKEN_ADDRESS as Address;
const L2_PLASMA_TOKEN_ADDRESS = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// L2 Chain config
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [L2_RPC_URL] },
    public: { http: [L2_RPC_URL] },
  },
} as const;

// Create clients
const l1Client = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

const l2Client = createPublicClient({
  chain: l2Chain,
  transport: http(L2_RPC_URL),
});

// Load ABI
const plasmaTokenAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaToken.json'), 'utf-8')
).abi;

// Types
interface UTXO {
  utxoId: string;
  owner: Address;
  token: Address;
  amount: string;
  spent: boolean;
  createdAt?: number;
}

interface UTXODetail {
  utxoId: string;
  owner: Address;
  token: Address;
  amount: bigint;
  createdInBlock: bigint;
  spent: boolean;
  exited: boolean;
}

interface BalanceInfo {
  address: Address;
  l1: {
    eth: string;
    plasmaToken: string;
  };
  l2: {
    plasmaToken: string;
    utxoCount: number;
    utxos: UTXO[];
  };
}

/**
 * Get L1 token balance
 */
async function getL1TokenBalance(address: Address): Promise<string> {
  try {
    const balance = (await l1Client.readContract({
      address: PLASMA_TOKEN_ADDRESS,
      abi: plasmaTokenAbi,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;
    return formatEther(balance);
  } catch {
    return '0';
  }
}

// Load ABIs for direct contract calls
const rootChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/RootChainUTXO.json'), 'utf-8')
).abi;

const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaChainUTXO.json'), 'utf-8')
).abi;

const ROOT_CHAIN_UTXO_ADDRESS = process.env.ROOT_CHAIN_UTXO_ADDRESS as Address;
const PLASMA_CHAIN_UTXO_ADDRESS = process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address;

/**
 * Get UTXO detail from L2 contract (PlasmaChainUTXO)
 * L2 UTXO struct: { utxoId, owner, token, amount, createdInBlock, spent }
 */
async function getUtxoDetailL2(utxoId: string): Promise<UTXODetail | null> {
  try {
    const result = (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId as `0x${string}`],
    })) as [string, Address, Address, bigint, bigint, boolean];

    // L2 Struct order: utxoId, owner, token, amount, createdInBlock, spent
    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      createdInBlock: result[4],
      spent: result[5],
      exited: false, // L2 doesn't have exited field
    };
  } catch (error: any) {
    console.error(`  [L2 UTXO Error] ${utxoId.slice(0, 20)}...: ${error.message}`);
    return null;
  }
}

/**
 * Get user's UTXOs directly from L2 contract
 */
async function getUtxosFromL2(address: Address): Promise<string[]> {
  try {
    const utxoIds = (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [address],
    })) as string[];
    return utxoIds;
  } catch (error: any) {
    console.error(`  [L2 getUserUtxos Error]: ${error.message}`);
    return [];
  }
}

/**
 * Get UTXO detail from L1 contract (RootChainUTXO)
 * L1 UTXO struct: { utxoId, owner, token, amount, createdInBlock, spent, exited }
 */
async function getUtxoDetail(utxoId: string): Promise<UTXODetail | null> {
  try {
    const result = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId as `0x${string}`],
    })) as [string, Address, Address, bigint, bigint, boolean, boolean];

    // Struct order: utxoId, owner, token, amount, createdInBlock, spent, exited
    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      createdInBlock: result[4],
      spent: result[5],
      exited: result[6],
    };
  } catch (error: any) {
    console.error(`  [UTXO Error] ${utxoId.slice(0, 20)}...: ${error.message}`);
    return null;
  }
}

/**
 * Get user's unspent UTXOs from L2 contract directly
 * This is more accurate than backend API for L2 state
 */
async function getUnspentUtxos(address: Address): Promise<UTXO[]> {
  try {
    // Get UTXO IDs directly from L2 contract
    const utxoIds = await getUtxosFromL2(address);

    if (utxoIds.length === 0) {
      return [];
    }

    // Fetch details for each UTXO from L2 contract
    const utxos: UTXO[] = [];

    for (const utxoId of utxoIds) {
      const detail = await getUtxoDetailL2(utxoId);
      if (detail && !detail.spent) {
        utxos.push({
          utxoId,
          owner: detail.owner,
          token: detail.token,
          amount: detail.amount.toString(),
          spent: detail.spent,
        });
      }
    }

    return utxos;
  } catch (error: any) {
    console.error(`  [L2 Error] ${error.message}`);
    return [];
  }
}

/**
 * Get user's all UTXOs from backend API
 */
async function getAllUtxos(address: Address): Promise<UTXO[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/utxos/${address}`);
    const data = await response.json();

    if (!data.success || !data.utxos || data.utxos.length === 0) {
      return [];
    }

    // Fetch details for each UTXO from L1 contract
    const utxoIds = data.utxos as string[];
    const utxos: UTXO[] = [];

    for (const utxoId of utxoIds) {
      const detail = await getUtxoDetail(utxoId);
      if (detail) {
        utxos.push({
          utxoId,
          owner: detail.owner,
          token: detail.token,
          amount: detail.amount.toString(),
          spent: detail.spent,
        });
      }
    }

    return utxos;
  } catch (error: any) {
    console.error(`  [API Error] ${error.message}`);
    return [];
  }
}

/**
 * Calculate total balance from UTXOs (sum all unspent regardless of token)
 */
function calculateUtxoBalance(utxos: UTXO[]): bigint {
  return utxos
    .filter((utxo) => !utxo.spent)
    .reduce((sum, utxo) => sum + BigInt(utxo.amount || '0'), 0n);
}

/**
 * Get comprehensive balance info for an address
 */
async function getBalanceInfo(address: Address): Promise<BalanceInfo> {
  const [l1Eth, l1Token, utxos] = await Promise.all([
    l1Client.getBalance({ address }).then(formatEther).catch(() => '0'),
    getL1TokenBalance(address),
    getUnspentUtxos(address),
  ]);

  // Calculate L2 balance from unspent UTXOs (sum all tokens)
  const l2TokenBalance = calculateUtxoBalance(utxos);

  return {
    address,
    l1: {
      eth: l1Eth,
      plasmaToken: l1Token,
    },
    l2: {
      plasmaToken: formatEther(l2TokenBalance),
      utxoCount: utxos.filter((u) => !u.spent).length,
      utxos: utxos,
    },
  };
}

/**
 * Format balance info for display
 */
function formatBalanceDisplay(info: BalanceInfo): void {
  console.log('\n' + '─'.repeat(70));
  console.log(`Address: ${info.address}`);
  console.log('─'.repeat(70));

  // L1 Balances
  console.log('\n[L1 Sepolia]');
  console.log(`  ETH:          ${parseFloat(info.l1.eth).toFixed(4)} ETH`);
  console.log(`  PLASMA Token: ${parseFloat(info.l1.plasmaToken).toFixed(2)} PLASMA`);

  // L2 Balances (UTXO)
  console.log('\n[L2 Plasma - UTXO Model]');
  console.log(`  PLASMA Token: ${parseFloat(info.l2.plasmaToken).toFixed(2)} PLASMA`);
  console.log(`  Unspent UTXOs: ${info.l2.utxoCount}`);

  // Show UTXOs if any
  if (info.l2.utxos.length > 0) {
    console.log('\n  UTXOs:');
    info.l2.utxos.forEach((utxo, i) => {
      const status = utxo.spent ? '[SPENT]' : '[UNSPENT]';
      const amount = formatEther(BigInt(utxo.amount));
      console.log(`    ${i + 1}. ${utxo.utxoId.slice(0, 20)}... ${amount} PLASMA ${status}`);
    });
  }

  // Summary
  const l1Total = parseFloat(info.l1.plasmaToken);
  const l2Total = parseFloat(info.l2.plasmaToken);
  console.log('\n[Summary]');
  console.log(`  L1 PLASMA: ${l1Total.toFixed(2)}`);
  console.log(`  L2 PLASMA: ${l2Total.toFixed(2)}`);
  console.log(`  Total:     ${(l1Total + l2Total).toFixed(2)} PLASMA`);
}

/**
 * Format for table display
 */
function formatTableRow(info: BalanceInfo): string {
  const shortAddr = `${info.address.slice(0, 6)}...${info.address.slice(-4)}`;
  return [
    shortAddr.padEnd(15),
    parseFloat(info.l1.eth).toFixed(4).padEnd(12),
    parseFloat(info.l1.plasmaToken).toFixed(2).padEnd(12),
    parseFloat(info.l2.plasmaToken).toFixed(2).padEnd(12),
    info.l2.utxoCount.toString().padEnd(8),
  ].join('');
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith('--'));
  const addresses = args.filter((arg) => !arg.startsWith('--') && arg.startsWith('0x')) as Address[];

  // Default test addresses if none provided
  if (addresses.length === 0) {
    addresses.push(
      '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address, // User A
      '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address, // User B
      '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab' as Address, // User C
    );
  }

  // Display mode
  const detailedMode = flags.includes('--detailed') || flags.includes('-d');

  console.log('='.repeat(60));
  console.log('         UTXO BALANCE CHECKER');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  L1 Network:     Sepolia`);
  console.log(`  L2 Model:       UTXO (Plasma Cash)`);
  console.log(`  Backend API:    ${BACKEND_URL}`);
  console.log(`  L1 Token:       ${PLASMA_TOKEN_ADDRESS}`);
  console.log(`  L2 Token:       ${L2_PLASMA_TOKEN_ADDRESS}`);
  console.log('');

  // Check if backend is running
  try {
    const healthResponse = await fetch(`${BACKEND_URL}/health`);
    const healthData = await healthResponse.json();
    if (healthData.mode === 'UTXO') {
      console.log('Backend Status: Online (UTXO Mode)');
    } else {
      console.log('Backend Status: Online (Legacy Mode - UTXOs may not be available)');
    }
  } catch {
    console.log('Backend Status: Offline (will only show L1 balances)');
  }

  console.log('');
  console.log('Fetching balances...\n');

  const balanceInfos: BalanceInfo[] = [];

  for (const address of addresses) {
    try {
      const info = await getBalanceInfo(address);
      balanceInfos.push(info);

      if (detailedMode) {
        formatBalanceDisplay(info);
      }
    } catch (error: any) {
      console.error(`Error checking ${address}:`, error.message);
    }
  }

  // Table view if not detailed
  if (!detailedMode) {
    console.log('─'.repeat(60));
    console.log(
      'Address'.padEnd(15) +
        'L1 ETH'.padEnd(12) +
        'L1 PLASMA'.padEnd(12) +
        'L2 PLASMA'.padEnd(12) +
        'UTXOs'
    );
    console.log('─'.repeat(60));

    balanceInfos.forEach((info) => {
      console.log(formatTableRow(info));
    });

    console.log('─'.repeat(60));
  }

  // Show totals
  const totalL1 = balanceInfos.reduce((sum, info) => sum + parseFloat(info.l1.plasmaToken), 0);
  const totalL2 = balanceInfos.reduce((sum, info) => sum + parseFloat(info.l2.plasmaToken), 0);
  const totalUtxos = balanceInfos.reduce((sum, info) => sum + info.l2.utxoCount, 0);

  console.log('\nTotals:');
  console.log(`  L1 PLASMA: ${totalL1.toFixed(2)}`);
  console.log(`  L2 PLASMA: ${totalL2.toFixed(2)}`);
  console.log(`  Total UTXOs: ${totalUtxos}`);

  console.log('\n' + '='.repeat(60));
  console.log('Usage:');
  console.log('  npx tsx functions/3-check-balance-utxo.ts [addresses...] [flags]');
  console.log('');
  console.log('Flags:');
  console.log('  --detailed, -d    Show detailed view with UTXO list');
  console.log('='.repeat(60));
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
