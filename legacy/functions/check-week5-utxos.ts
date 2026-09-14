#!/usr/bin/env tsx

/**
 * Check UTXO status for all 10 Week 5 addresses
 * Verifies that setup was successful
 */

import { createPublicClient, http, type Address } from 'viem';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: resolve(process.cwd(), '.env') });

const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_CHAIN_UTXO_ADDRESS = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as Address;
const WEEK5_ADDRESSES = (process.env.WEEK5_ADDRESSES || '').split(',').map(a => a.trim()).filter(a => a);

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║              WEEK 5: Check UTXO Status (All 10)               ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

if (WEEK5_ADDRESSES.length === 0) {
  console.error('❌ Error: WEEK5_ADDRESSES not found in .env');
  console.error('Run: npx tsx functions/generate-week5-keys.ts');
  process.exit(1);
}

const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(process.cwd(), 'backend/abi/PlasmaChainUTXO.json'), 'utf-8')
).abi;

const publicClient = createPublicClient({ transport: http(L2_RPC_URL) });

async function checkUtxos() {
  let totalAddresses = 0;
  let addressesWithUtxos = 0;
  let totalUtxos = 0;
  let totalUnspent = 0;

  for (let i = 0; i < WEEK5_ADDRESSES.length; i++) {
    const address = WEEK5_ADDRESSES[i] as Address;
    totalAddresses++;

    try {
      const utxoIds = (await publicClient.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS,
        abi: plasmaChainUtxoAbi,
        functionName: 'getUserUtxos',
        args: [address],
      })) as `0x${string}`[];

      console.log(`[${i + 1}/10] ${address.slice(0, 12)}...`);

      if (utxoIds.length === 0) {
        console.log(`        ❌ No UTXOs\n`);
        continue;
      }

      addressesWithUtxos++;
      let unspentCount = 0;
      let totalBalance = 0n;

      for (const utxoId of utxoIds) {
        const utxoData = (await publicClient.readContract({
          address: PLASMA_CHAIN_UTXO_ADDRESS,
          abi: plasmaChainUtxoAbi,
          functionName: 'utxos',
          args: [utxoId],
        })) as any;

        const amount = utxoData[3] as bigint;
        const spent = utxoData[5] as boolean;

        totalUtxos++;
        if (!spent) {
          unspentCount++;
          totalBalance += amount;
        }
      }

      console.log(`        ✓ Total: ${utxoIds.length} UTXO(s)`);
      console.log(`        ✓ Unspent: ${unspentCount}`);
      console.log(`        ✓ Balance: ${Number(totalBalance) / 1e18} tokens\n`);

      totalUnspent += unspentCount;
    } catch (error) {
      console.log(`        ❌ Error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`);
    }
  }

  // Summary
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total Addresses: ${totalAddresses}`);
  console.log(`Addresses with UTXOs: ${addressesWithUtxos}/${totalAddresses}`);
  console.log(`Total UTXOs: ${totalUtxos}`);
  console.log(`Total Unspent: ${totalUnspent}\n`);

  if (addressesWithUtxos === totalAddresses && totalUnspent >= totalAddresses) {
    console.log('✅ All 10 addresses are ready for Week 5 testing!\n');
  } else if (addressesWithUtxos < totalAddresses) {
    console.log(`⚠️  ${totalAddresses - addressesWithUtxos} address(es) missing UTXOs`);
    console.log('Run: npx tsx functions/week5-deposit-plasma.ts\n');
  }
}

checkUtxos().catch(console.error);
