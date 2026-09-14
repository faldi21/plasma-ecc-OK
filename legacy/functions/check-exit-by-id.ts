#!/usr/bin/env tsx

/**
 * Check Exit By ID (UTXO)
 *
 * Usage:
 *   npx tsx functions/check-exit-by-id.ts <EXIT_ID>
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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const ROOT_CHAIN_UTXO_ADDRESS = process.env.ROOT_CHAIN_UTXO_ADDRESS as Address | undefined;

if (!SEPOLIA_RPC_URL || !ROOT_CHAIN_UTXO_ADDRESS) {
  console.error('Missing SEPOLIA_RPC_URL or ROOT_CHAIN_UTXO_ADDRESS in .env');
  process.exit(1);
}

const rootChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/RootChainUTXO.json'), 'utf-8')
).abi;

const args = process.argv.slice(2);
const exitIdInput = args[0];

if (!exitIdInput || !exitIdInput.startsWith('0x') || exitIdInput.length !== 66) {
  console.log('='.repeat(60));
  console.log('         CHECK EXIT BY ID');
  console.log('='.repeat(60));
  console.log('Usage:');
  console.log('  npx tsx functions/check-exit-by-id.ts <EXIT_ID>');
  console.log('');
  console.log('Example:');
  console.log('  npx tsx functions/check-exit-by-id.ts 0x1234...');
  console.log('='.repeat(60));
  process.exit(1);
}

const exitId = exitIdInput as Hex;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

function formatTimeRemaining(exitTime: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const exitTimeNum = Number(exitTime);
  const remaining = exitTimeNum - now;
  if (remaining <= 0) return 'Ready to finalize';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${hours}h ${minutes}m ${seconds}s remaining`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('         CHECK EXIT BY ID');
  console.log('='.repeat(60));
  console.log(`Exit ID: ${exitId}`);
  console.log(`RootChainUTXO: ${ROOT_CHAIN_UTXO_ADDRESS}`);
  console.log('='.repeat(60));

  try {
    const result = (await publicClient.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'exits',
      args: [exitId],
    })) as [Address, Hex, Address, bigint, bigint, bigint, boolean, boolean];

    const [owner, utxoId, token, amount, blockNumber, exitTime, processed, challenged] = result;

    if (owner.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      console.log('❌ Exit not found');
      return;
    }

    console.log('Exit Data:');
    console.log(`  Owner:      ${owner}`);
    console.log(`  UTXO ID:    ${utxoId}`);
    console.log(`  Token:      ${token}`);
    console.log(`  Amount:     ${formatEther(amount)} PLASMA`);
    console.log(`  Block:      ${blockNumber.toString()}`);
    console.log(`  Exit Time:  ${new Date(Number(exitTime) * 1000).toISOString()}`);
    console.log(`  Processed:  ${processed}`);
    console.log(`  Challenged: ${challenged}`);
    console.log('');

    if (challenged) {
      console.log('Status: Challenged (cannot finalize)');
    } else if (processed) {
      console.log('Status: Finalized');
    } else {
      console.log(`Status: ${formatTimeRemaining(exitTime)}`);
    }
  } catch (error: any) {
    console.error('Error reading exit data:', error.message || error);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
