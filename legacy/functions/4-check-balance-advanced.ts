#!/usr/bin/env tsx

/**
 * Advanced Layer 2 Balance Checker
 *
 * Features:
 * - Check both L1 (Sepolia) and L2 balances
 * - Support multiple tokens
 * - Show transaction history count
 * - Export to JSON/CSV
 * - Interactive mode
 */

import {
  createPublicClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Force load .env from project root (parent directory of functions/)
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });
console.log(`[dotenv] Loading from: ${envPath}`);

// Custom L2 chain
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

// Environment variables
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const L2_PLASMA_CHAIN_ADDRESS = process.env.L2_PLASMA_CHAIN_ADDRESS as Address;
const L2_PLASMA_TOKEN_ADDRESS = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;
const PLASMA_TOKEN_ADDRESS = process.env.PLASMA_TOKEN_ADDRESS as Address;

// Create clients
const l1Client = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

const l2Client = createPublicClient({
  chain: l2Chain,
  transport: http(L2_RPC_URL),
});

// Load ABIs
const plasmaChainAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaChain.json'), 'utf-8')
).abi;

const plasmaTokenAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaToken.json'), 'utf-8')
).abi;

// Types
interface BalanceInfo {
  address: Address;
  l1: {
    eth: string;
    plasmaToken: string;
  };
  l2: {
    eth: string;
    plasmaToken: string;
  };
  nonce?: number;
  txCount?: number;
}

/**
 * Get L2 token balance from PlasmaChain
 */
async function getL2Balance(address: Address, token: Address): Promise<string> {
  try {
    const balance = (await l2Client.readContract({
      address: L2_PLASMA_CHAIN_ADDRESS,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [address, token],
    })) as bigint;
    return formatEther(balance);
  } catch {
    return '0';
  }
}

/**
 * Get L1 token balance
 */
async function getL1TokenBalance(address: Address, token: Address): Promise<string> {
  try {
    const balance = (await l1Client.readContract({
      address: token,
      abi: plasmaTokenAbi,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;
    return formatEther(balance);
  } catch {
    return '0';
  }
}

/**
 * Get nonce for an address on L2
 */
async function getL2Nonce(address: Address): Promise<number> {
  try {
    const nonce = (await l2Client.readContract({
      address: L2_PLASMA_CHAIN_ADDRESS,
      abi: plasmaChainAbi,
      functionName: 'nonces',
      args: [address],
    })) as bigint;
    return Number(nonce);
  } catch {
    return 0;
  }
}

/**
 * Get transaction count for an address
 */
async function getTransactionCount(address: Address): Promise<number> {
  try {
    const count = await l2Client.getTransactionCount({ address });
    return count;
  } catch {
    return 0;
  }
}

/**
 * Get comprehensive balance info for an address
 */
async function getBalanceInfo(address: Address): Promise<BalanceInfo> {
  const [l1Eth, l1Token, l2Eth, l2Token, nonce, txCount] = await Promise.all([
    l1Client.getBalance({ address }).then(formatEther).catch(() => '0'),
    getL1TokenBalance(address, PLASMA_TOKEN_ADDRESS),
    l2Client.getBalance({ address }).then(formatEther).catch(() => '0'),
    getL2Balance(address, L2_PLASMA_TOKEN_ADDRESS),
    getL2Nonce(address),
    getTransactionCount(address),
  ]);

  return {
    address,
    l1: {
      eth: l1Eth,
      plasmaToken: l1Token,
    },
    l2: {
      eth: l2Eth,
      plasmaToken: l2Token,
    },
    nonce,
    txCount,
  };
}

/**
 * Format balance info for display
 */
function formatBalanceDisplay(info: BalanceInfo): void {
  const shortAddr = `${info.address.slice(0, 6)}...${info.address.slice(-4)}`;

  console.log('\n' + '─'.repeat(70));
  console.log(`📍 Address: ${info.address}`);
  console.log('─'.repeat(70));

  // L1 Balances
  console.log('\n🔷 Layer 1 (Sepolia):');
  console.log(`  ETH:          ${parseFloat(info.l1.eth).toFixed(4)} ETH`);
  console.log(`  PLASMA Token: ${parseFloat(info.l1.plasmaToken).toFixed(2)} PLASMA`);

  // L2 Balances
  console.log('\n🔶 Layer 2 (Local):');
  console.log(`  ETH:          ${parseFloat(info.l2.eth).toFixed(4)} ETH`);
  console.log(`  PLASMA Token: ${parseFloat(info.l2.plasmaToken).toFixed(2)} PLASMA`);

  // Stats
  console.log('\n📊 Statistics:');
  console.log(`  Nonce:        ${info.nonce}`);
  console.log(`  TX Count:     ${info.txCount}`);

  // Summary
  const totalL1 = parseFloat(info.l1.eth) + parseFloat(info.l1.plasmaToken);
  const totalL2 = parseFloat(info.l2.eth) + parseFloat(info.l2.plasmaToken);
  console.log('\n💰 Summary:');
  console.log(`  Total L1 Value: ~${totalL1.toFixed(2)}`);
  console.log(`  Total L2 Value: ~${totalL2.toFixed(2)}`);
}

/**
 * Format for table display
 */
function formatTableRow(info: BalanceInfo): string {
  const shortAddr = `${info.address.slice(0, 6)}...${info.address.slice(-4)}`;
  return [
    shortAddr.padEnd(15),
    info.l1.eth.slice(0, 8).padEnd(10),
    info.l1.plasmaToken.slice(0, 8).padEnd(10),
    info.l2.eth.slice(0, 8).padEnd(10),
    info.l2.plasmaToken.slice(0, 8).padEnd(10),
    info.nonce?.toString().padEnd(8) || '0',
  ].join('');
}

/**
 * Export to JSON
 */
function exportToJson(data: BalanceInfo[], filename: string): void {
  const output = {
    timestamp: new Date().toISOString(),
    l1Network: 'Sepolia',
    l2Network: 'Plasma L2',
    balances: data,
  };

  writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n✅ Exported to ${filename}`);
}

/**
 * Export to CSV
 */
function exportToCsv(data: BalanceInfo[], filename: string): void {
  const headers = [
    'Address',
    'L1 ETH',
    'L1 PLASMA',
    'L2 ETH',
    'L2 PLASMA',
    'Nonce',
    'TX Count',
  ].join(',');

  const rows = data.map((info) =>
    [
      info.address,
      info.l1.eth,
      info.l1.plasmaToken,
      info.l2.eth,
      info.l2.plasmaToken,
      info.nonce || 0,
      info.txCount || 0,
    ].join(',')
  );

  const csv = [headers, ...rows].join('\n');
  writeFileSync(filename, csv);
  console.log(`\n✅ Exported to ${filename}`);
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith('--'));
  const addresses = args.filter((arg) => !arg.startsWith('--')) as Address[];

  // Default test addresses if none provided
  if (addresses.length === 0) {
    addresses.push(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
      '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address,    
      '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address, 
      '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab' as Address, 
    );
  }

  // Display mode
  const detailedMode = flags.includes('--detailed') || flags.includes('-d');
  const jsonExport = flags.includes('--json');
  const csvExport = flags.includes('--csv');

  console.log('🔍 Advanced Layer 2 Balance Checker\n');
  console.log('Configuration:');
  console.log(`  L1 Network:   Sepolia`);
  console.log(`  L2 Network:   Plasma L2 (Local)`);
  console.log(`  L1 RPC:       ${SEPOLIA_RPC_URL.slice(0, 50)}...`);
  console.log(`  L2 RPC:       ${L2_RPC_URL}`);
  console.log('');

  // Fetch all balance info
  console.log('⏳ Fetching balances...\n');
  const balanceInfos: BalanceInfo[] = [];

  for (const address of addresses) {
    try {
      const info = await getBalanceInfo(address);
      balanceInfos.push(info);

      if (detailedMode) {
        formatBalanceDisplay(info);
      }
    } catch (error: any) {
      console.error(`❌ Error checking ${address}:`, error.message);
    }
  }

  // Table view if not detailed
  if (!detailedMode) {
    console.log('━'.repeat(80));
    console.log(
      'Address'.padEnd(15) +
        'L1 ETH'.padEnd(10) +
        'L1 PLASMA'.padEnd(10) +
        'L2 ETH'.padEnd(10) +
        'L2 PLASMA'.padEnd(10) +
        'Nonce'
    );
    console.log('━'.repeat(80));

    balanceInfos.forEach((info) => {
      console.log(formatTableRow(info));
    });

    console.log('━'.repeat(80));
  }

  // Export options
  if (jsonExport) {
    exportToJson(balanceInfos, `balances-${Date.now()}.json`);
  }

  if (csvExport) {
    exportToCsv(balanceInfos, `balances-${Date.now()}.csv`);
  }

  console.log('\n✅ Balance check complete!');
  console.log('\nUsage:');
  console.log('  tsx functions/4-check-balance-advanced.ts [addresses...] [flags]');
  console.log('\nFlags:');
  console.log('  --detailed, -d    Show detailed view');
  console.log('  --json            Export to JSON');
  console.log('  --csv             Export to CSV');
}

// Run
main().catch((error) => {
  console.error('🚨 Fatal error:', error.message);
  process.exit(1);
});
