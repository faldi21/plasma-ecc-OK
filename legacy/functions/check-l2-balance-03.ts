#!/usr/bin/env tsx

/**
 * Check Layer 2 Balance
 *
 * Script untuk mengecek balance token di Layer 2 (PlasmaChain)
 * Menggunakan TypeScript + Viem
 */

import { createPublicClient, http, formatEther, type Address } from 'viem';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Force load .env from project root (parent directory of functions/)
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });
console.log(`[dotenv] Loading from: ${envPath}`);

// Custom L2 chain configuration (Anvil local)
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
    public: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
  },
} as const;

// Load environment variables
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const L2_PLASMA_CHAIN_ADDRESS = process.env.L2_PLASMA_CHAIN_ADDRESS as Address;
const L2_PLASMA_TOKEN_ADDRESS = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;

// Validate required variables
if (!L2_PLASMA_CHAIN_ADDRESS) {
  console.error('❌ L2_PLASMA_CHAIN_ADDRESS not found in .env');
  process.exit(1);
}

if (!L2_PLASMA_TOKEN_ADDRESS) {
  console.error('❌ L2_PLASMA_TOKEN_ADDRESS not found in .env');
  process.exit(1);
}

// Load PlasmaChain ABI
const plasmaChainAbiPath = resolve(__dirname, '../backend/abi/PlasmaChain.json');
const plasmaChainAbi = JSON.parse(readFileSync(plasmaChainAbiPath, 'utf-8')).abi;

// Create public client for L2
const l2Client = createPublicClient({
  chain: l2Chain,
  transport: http(L2_RPC_URL),
});

/**
 * Get balance of a specific address and token on L2
 */
async function getBalance(address: Address, token: Address): Promise<string> {
  try {
    const balance = await l2Client.readContract({
      address: L2_PLASMA_CHAIN_ADDRESS,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [address, token],
    }) as bigint;

    return formatEther(balance);
  } catch (error: any) {
    console.error(`Error getting balance for ${address}:`, error.message);
    return '0';
  }
}

/**
 * Get native ETH balance on L2
 */
async function getEthBalance(address: Address): Promise<string> {
  try {
    const balance = await l2Client.getBalance({ address });
    return formatEther(balance);
  } catch (error: any) {
    console.error(`Error getting ETH balance for ${address}:`, error.message);
    return '0';
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Checking Layer 2 Balances...\n');
  console.log('Configuration:');
  console.log(`  L2 RPC URL: ${L2_RPC_URL}`);
  console.log(`  PlasmaChain: ${L2_PLASMA_CHAIN_ADDRESS}`);
  console.log(`  PlasmaToken: ${L2_PLASMA_TOKEN_ADDRESS}`);
  console.log('');

  // Get addresses from command line or use default test addresses
  const addresses: Address[] = process.argv.slice(2) as Address[];

  if (addresses.length === 0) {
    console.log('ℹ️  No addresses provided. Using default test addresses...\n');
    addresses.push(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address, // Anvil account 0
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address, // Anvil account 1
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address, // Anvil account 2
      '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address,
      '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address,
      '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab' as Address,
    );
  }

  // Check balances
  console.log('📊 Balances:\n');
  const tableWidth = 90;
  console.log('━'.repeat(tableWidth));
  console.log('Address'.padEnd(20) + 'ETH Balance'.padEnd(35) + 'PLASMA Balance');
  console.log('━'.repeat(tableWidth));

  for (const address of addresses) {
    try {
      // Get ETH balance
      const ethBalance = await getEthBalance(address);

      // Get PlasmaToken balance
      const tokenBalance = await getBalance(address, L2_PLASMA_TOKEN_ADDRESS);

      // Format values: truncate to 6 decimals, right-aligned
      const ethFormatted = parseFloat(ethBalance).toFixed(4);
      const tokenFormatted = parseFloat(tokenBalance).toFixed(4);

      // Print results
      const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
      const fmtEth = parseFloat(ethBalance).toFixed(4);
      const fmtToken = parseFloat(tokenBalance).toFixed(4);
      console.log(
        shortAddr.padEnd(20) +
        ethFormatted.padStart(30).padEnd(35) +
        tokenFormatted.padStart(13)
      );
    } catch (error: any) {
      console.error(`❌ Error checking ${address}:`, error.message);
    }
  }

  console.log('━'.repeat(tableWidth));
  console.log('\n✅ Balance check complete!');
}

// Run main function
main().catch((error) => {
  console.error('🚨 Fatal error:', error.message);
  process.exit(1);
});
