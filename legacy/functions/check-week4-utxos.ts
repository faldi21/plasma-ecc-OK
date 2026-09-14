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

  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       WEEK 4: CHECK USER UTXO BALANCES             ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  for (const user of users) {
    try {
      const utxoIds = (await publicClient.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS,
        abi: plasmaChainUtxoAbi,
        functionName: 'getUserUtxos',
        args: [user.address],
      })) as `0x${string}`[];

      console.log(`User ${user.name}: ${user.address.slice(0, 10)}...`);
      console.log(`  ✓ Total UTXOs: ${utxoIds.length}`);

      if (utxoIds.length > 0) {
        let totalBalance = 0n;
        let unspentCount = 0;

        for (let i = 0; i < Math.min(utxoIds.length, 3); i++) {
          const utxo = (await publicClient.readContract({
            address: PLASMA_CHAIN_UTXO_ADDRESS,
            abi: plasmaChainUtxoAbi,
            functionName: 'utxos',
            args: [utxoIds[i]],
          })) as any;

          const spent = utxo[5];
          const amount = utxo[3] as bigint;

          if (!spent) {
            unspentCount++;
            totalBalance += amount;
          }

          console.log(`    - UTXO ${i + 1}: amount=${amount}, spent=${spent}`);
        }

        console.log(`  ✓ Unspent UTXOs: ${unspentCount}`);
        console.log(`  ✓ Total Balance (first 3): ${totalBalance} wei\n`);
      } else {
        console.log(`  ✗ NO UTXOs FOUND - Cannot perform transfers!\n`);
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`);
    }
  }
}

checkUTXOs().catch(console.error);
