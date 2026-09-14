#!/usr/bin/env tsx

import { createPublicClient, http } from 'viem';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env') });

const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_CHAIN_UTXO_ADDRESS = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as `0x${string}`;

const users = [
  { name: 'A', address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as `0x${string}` },
  { name: 'B', address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as `0x${string}` },
  { name: 'C', address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab' as `0x${string}` },
];

async function checkUTXOs() {
  const publicClient = createPublicClient({ transport: http(L2_RPC_URL) });
  const plasmaChainUtxoAbi = JSON.parse(
    readFileSync(resolve(process.cwd(), 'backend/abi/PlasmaChainUTXO.json'), 'utf-8')
  ).abi;

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       WEEK 4: DETAILED UTXO CHECK (ALL UTXOS)                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  for (const user of users) {
    try {
      const utxoIds = (await publicClient.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS,
        abi: plasmaChainUtxoAbi,
        functionName: 'getUserUtxos',
        args: [user.address],
      })) as `0x${string}`[];

      console.log(`\n📌 User ${user.name}: ${user.address}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Total UTXOs in contract: ${utxoIds.length}`);

      let unspentCount = 0;
      let totalUnspentBalance = 0n;
      let spentCount = 0;

      for (let i = 0; i < utxoIds.length; i++) {
        const utxoId = utxoIds[i];
        const utxo = (await publicClient.readContract({
          address: PLASMA_CHAIN_UTXO_ADDRESS,
          abi: plasmaChainUtxoAbi,
          functionName: 'utxos',
          args: [utxoId],
        })) as any;

        const amount = utxo[3] as bigint;
        const spent = utxo[5] as boolean;
        const status = spent ? '❌ SPENT' : '✅ UNSPENT';

        if (!spent) {
          unspentCount++;
          totalUnspentBalance += amount;
        } else {
          spentCount++;
        }

        // Show all UTXOs
        const amountEth = Number(amount) / 1e18;
        console.log(`  [${i + 1}] ${status} | ${amountEth.toFixed(2)} tokens | ID: ${utxoId.slice(0, 12)}...`);
      }

      console.log(`\n📊 Summary:`);
      console.log(`  ✅ Unspent: ${unspentCount} UTXO (Total: ${Number(totalUnspentBalance) / 1e18} tokens)`);
      console.log(`  ❌ Spent: ${spentCount} UTXO`);

      if (unspentCount === 0) {
        console.log(`  ⚠️  WARNING: User ${user.name} has NO unspent UTXOs!`);
      }
    } catch (error) {
      console.log(`User ${user.name}: ${user.address}`);
      console.log(`  ✗ Error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  console.log(`\n${'━'.repeat(72)}`);
  console.log(`\n💡 Summary for Week 4:\n`);

  const userSummary = [];
  for (const user of users) {
    const utxoIds = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [user.address],
    })) as `0x${string}`[];

    let unspent = 0;
    for (const utxoId of utxoIds) {
      const utxo = (await publicClient.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS,
        abi: plasmaChainUtxoAbi,
        functionName: 'utxos',
        args: [utxoId],
      })) as any;
      if (!utxo[5]) unspent++;
    }
    userSummary.push({ user: user.name, total: utxoIds.length, unspent });
  }

  console.log('User | Total UTXOs | Unspent UTXOs | Can Transfer?');
  console.log('─────┼─────────────┼───────────────┼──────────────');
  for (const s of userSummary) {
    const canTransfer = s.unspent > 0 ? '✅ YES' : '❌ NO';
    console.log(`  ${s.user}  |      ${s.total}       |       ${s.unspent}       | ${canTransfer}`);
  }
}

checkUTXOs().catch(console.error);
