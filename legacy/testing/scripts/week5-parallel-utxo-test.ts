#!/usr/bin/env tsx

/**
 * Week 5: Parallel UTXO Stress Testing
 * Test concurrent UTXO transfers from multiple senders to single receiver
 *
 * Flow:
 * 1. Setup: 10 different wallet addresses as senders
 * 2. Concurrent Transfer: Each sender performs 10 parallel UTXO transfers to receiver
 * 3. Measure: TPS, latency, and success rate with concurrent load
 *
 * Test Configuration:
 * - 10 senders × 10 transfers = 100 total UTXO transfers
 * - Receiver: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda
 * - All transfers executed in parallel (not sequential)
 * - Measures throughput under concurrent load
 */

import { createPublicClient, createWalletClient, http, keccak256, encodePacked, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { getTimestamp, getDateString } from './utils.ts';

// Load .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

interface ParallelTransferResult {
  sender: string;
  senderIndex: number;
  receiver: string;
  totalTransfers: number;
  successfulTransfers: number;
  failedTransfers: number;
  totalTime: number;
  tps: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  errors: Array<{ transferIndex: number; error: string }>;
}

interface Week5TestResult {
  testType: 'Week 5: Parallel UTXO Transfers';
  totalSenders: number;
  totalTransfers: number;
  successfulTransfers: number;
  failedTransfers: number;
  successRate: number;
  totalTime: number;
  overallTps: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  senderResults: ParallelTransferResult[];
  timestamp: string;
  dateString: string;
}

// Environment variables
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_CHAIN_UTXO_ADDRESS = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as Address;
const PRIVATE_KEYS = (process.env.PRIVATE_KEYS || '').split(',').map(k => k.trim()).filter(k => k);
const WEEK5_ADDRESSES = (process.env.WEEK5_ADDRESSES || '').split(',').map(a => a.trim()).filter(a => a);

// Get test senders from environment or fallback to week 5 addresses
let TEST_SENDERS: string[] = [];
if (WEEK5_ADDRESSES.length > 0) {
  TEST_SENDERS = WEEK5_ADDRESSES;
} else {
  console.warn('⚠️  WEEK5_ADDRESSES not found in .env, using hardhat defaults');
  TEST_SENDERS = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x62dc14Fe819A241e176ee6A813f51045d04A0cda',
    '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76',
    '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab',
    '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    '0x71d8b00f6dff4f8c3d70d8ece969e7bf9d30c26',
    '0x1e59ce931b4cfea3fe4b875411e280e173cb7242',
    '0xa0ee7a142d267c1f36714e4a8f6c1025c0d32ce',
  ];
}

const RECEIVER = '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address;
const TRANSFERS_PER_SENDER = 10;

console.log('╔═══════════════════════════════════════════════════════════════════╗');
console.log('║           WEEK 5: PARALLEL UTXO TRANSFER TESTING                  ║');
console.log('║  10 Senders × 10 Transfers = 100 Concurrent UTXO Operations      ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

// Load ABI
const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(process.cwd(), 'backend/abi/PlasmaChainUTXO.json'), 'utf-8')
).abi;

async function getUnspentUtxos(
  publicClient: any,
  address: Address
): Promise<Hex[]> {
  try {
    const utxoIds = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [address],
    })) as Hex[];

    const unspentUtxos: Hex[] = [];
    for (const utxoId of utxoIds) {
      const utxoData = (await publicClient.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS,
        abi: plasmaChainUtxoAbi,
        functionName: 'utxos',
        args: [utxoId],
      })) as any;

      const spent = utxoData[5] as boolean;
      if (!spent) {
        unspentUtxos.push(utxoId);
      }
    }

    return unspentUtxos;
  } catch (error) {
    console.error(`Error getting unspent UTXOs for ${address}:`, error);
    return [];
  }
}

async function transferUtxo(
  walletClient: any,
  publicClient: any,
  sender: Address,
  receiver: Address,
  utxoId: Hex,
  transferIndex: number
): Promise<{ success: boolean; latency: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Get UTXO details
    const utxoData = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId],
    })) as any;

    const amount = utxoData[3] as bigint;
    const transferAmount = amount / 2n;
    const changeAmount = amount - transferAmount;

    // Create message hash
    const messageHash = keccak256(
      encodePacked(
        ['address', 'bytes32', 'address', 'uint256', 'address', 'uint256'],
        [sender, utxoId, receiver, transferAmount, sender, changeAmount]
      )
    );

    // Sign the message
    const signature = await walletClient.signMessage({
      account: walletClient.account,
      message: { raw: messageHash },
    });

    // Send transaction
    const hash = await walletClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'transferUtxo',
      args: [utxoId, receiver, transferAmount, signature],
    });

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const latency = Date.now() - startTime;

    if (receipt.status === 'success') {
      return { success: true, latency };
    } else {
      return { success: false, latency, error: 'Transaction reverted' };
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      latency,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testSender(
  senderIndex: number,
  senderAddress: Address,
  privateKey: string
): Promise<ParallelTransferResult> {
  const publicClient = createPublicClient({ transport: http(L2_RPC_URL) });
  const account = privateKeyToAccount(`0x${privateKey}` as Hex);

  const walletClient = createWalletClient({
    account,
    transport: http(L2_RPC_URL),
  });

  const senderStartTime = Date.now();
  const latencies: number[] = [];
  const errors: Array<{ transferIndex: number; error: string }> = [];
  let successCount = 0;

  console.log(`\n📤 Sender ${senderIndex + 1}: ${senderAddress.slice(0, 10)}...`);

  try {
    // Get unspent UTXOs
    const unspentUtxos = await getUnspentUtxos(publicClient, senderAddress);

    if (unspentUtxos.length === 0) {
      console.log(`  ❌ No unspent UTXOs available`);
      return {
        sender: senderAddress,
        senderIndex,
        receiver: RECEIVER,
        totalTransfers: TRANSFERS_PER_SENDER,
        successfulTransfers: 0,
        failedTransfers: TRANSFERS_PER_SENDER,
        totalTime: 0,
        tps: 0,
        avgLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        errors: [{
          transferIndex: 0,
          error: 'No unspent UTXOs available',
        }],
      };
    }

    console.log(`  ✓ Found ${unspentUtxos.length} unspent UTXO(s)`);
    console.log(`  🔄 Initiating ${TRANSFERS_PER_SENDER} parallel transfers...`);

    // Create all transfer promises
    const transferPromises: Promise<{ success: boolean; latency: number; error?: string; transferIndex: number }>[] = [];

    for (let i = 0; i < TRANSFERS_PER_SENDER; i++) {
      const utxoIndex = i % unspentUtxos.length;
      const utxoId = unspentUtxos[utxoIndex];

      const promise = transferUtxo(
        walletClient,
        publicClient,
        senderAddress,
        RECEIVER,
        utxoId,
        i
      ).then((result) => ({ ...result, transferIndex: i }));

      transferPromises.push(promise);
    }

    // Execute all transfers in parallel
    const results = await Promise.all(transferPromises);

    // Process results
    for (const result of results) {
      if (result.success) {
        successCount++;
        latencies.push(result.latency);
      } else {
        errors.push({
          transferIndex: result.transferIndex,
          error: result.error || 'Unknown error',
        });
      }
    }

    const totalTime = Date.now() - senderStartTime;
    const tps = successCount > 0 ? (successCount / (totalTime / 1000)) : 0;
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

    console.log(`  ✓ Completed: ${successCount}/${TRANSFERS_PER_SENDER} successful`);
    console.log(`  ⏱️  Time: ${totalTime}ms, TPS: ${tps.toFixed(2)}, Latency: ${avgLatency.toFixed(0)}ms avg`);

    return {
      sender: senderAddress,
      senderIndex,
      receiver: RECEIVER,
      totalTransfers: TRANSFERS_PER_SENDER,
      successfulTransfers: successCount,
      failedTransfers: TRANSFERS_PER_SENDER - successCount,
      totalTime,
      tps,
      avgLatency,
      minLatency,
      maxLatency,
      errors,
    };
  } catch (error) {
    console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      sender: senderAddress,
      senderIndex,
      receiver: RECEIVER,
      totalTransfers: TRANSFERS_PER_SENDER,
      successfulTransfers: 0,
      failedTransfers: TRANSFERS_PER_SENDER,
      totalTime: Date.now() - senderStartTime,
      tps: 0,
      avgLatency: 0,
      minLatency: 0,
      maxLatency: 0,
      errors: [{
        transferIndex: 0,
        error: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

async function runWeek5Test() {
  const testStartTime = Date.now();
  const senderResults: ParallelTransferResult[] = [];

  console.log(`\n🚀 Starting parallel transfers with ${TEST_SENDERS.length} senders...`);
  console.log(`📌 Receiver: ${RECEIVER}\n`);

  // Run all senders in parallel
  const senderPromises = TEST_SENDERS.map((sender, index) => {
    const privateKey = PRIVATE_KEYS[index];
    if (!privateKey) {
      console.warn(`⚠️  No private key for sender ${index + 1}`);
      return Promise.resolve(null);
    }
    return testSender(index, sender as Address, privateKey);
  });

  const results = await Promise.allSettled(senderPromises);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      senderResults.push(result.value);
    }
  }

  const totalTime = Date.now() - testStartTime;
  const totalTransfers = senderResults.reduce((sum, r) => sum + r.totalTransfers, 0);
  const successfulTransfers = senderResults.reduce((sum, r) => sum + r.successfulTransfers, 0);
  const failedTransfers = senderResults.reduce((sum, r) => sum + r.failedTransfers, 0);
  const allLatencies = senderResults.flatMap((r) =>
    Array(r.successfulTransfers).fill(r.avgLatency)
  );

  const overallTps = successfulTransfers > 0 ? (successfulTransfers / (totalTime / 1000)) : 0;
  const avgLatency = allLatencies.length > 0 ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length : 0;
  const minLatency = allLatencies.length > 0 ? Math.min(...allLatencies) : 0;
  const maxLatency = allLatencies.length > 0 ? Math.max(...allLatencies) : 0;
  const successRate = (successfulTransfers / totalTransfers) * 100;

  const testResult: Week5TestResult = {
    testType: 'Week 5: Parallel UTXO Transfers',
    totalSenders: TEST_SENDERS.length,
    totalTransfers,
    successfulTransfers,
    failedTransfers,
    successRate,
    totalTime,
    overallTps,
    avgLatency,
    minLatency,
    maxLatency,
    senderResults,
    timestamp: getTimestamp(),
    dateString: getDateString(),
  };

  // Print summary
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                      WEEK 5 TEST RESULTS                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total Senders:             ${TEST_SENDERS.length}`);
  console.log(`Transfers per Sender:      ${TRANSFERS_PER_SENDER}`);
  console.log(`Total Transfers:           ${totalTransfers}`);
  console.log(`Successful:                ${successfulTransfers} (${successRate.toFixed(2)}%)`);
  console.log(`Failed:                    ${failedTransfers}`);
  console.log(`Total Time:                ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  console.log(`Overall TPS:               ${overallTps.toFixed(2)} TX/sec`);
  console.log(`Avg Latency:               ${avgLatency.toFixed(0)}ms`);
  console.log(`Min Latency:               ${minLatency.toFixed(0)}ms`);
  console.log(`Max Latency:               ${maxLatency.toFixed(0)}ms\n`);

  // Per-sender summary
  console.log(`📋 PER-SENDER BREAKDOWN`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  for (const result of senderResults) {
    const successRate = (result.successfulTransfers / result.totalTransfers) * 100;
    console.log(
      `Sender ${result.senderIndex + 1}: ${result.successfulTransfers}/${result.totalTransfers} ✓ | ` +
      `TPS: ${result.tps.toFixed(2)} | Latency: ${result.avgLatency.toFixed(0)}ms | ` +
      `Success: ${successRate.toFixed(0)}%`
    );
  }

  // Save results
  const dataDir = resolve(process.cwd(), 'data/research/benchmarks');
  mkdirSync(dataDir, { recursive: true });

  const timestamp = getTimestamp();
  const filename = `${dataDir}/week5-parallel-utxo-${getDateString()}-${timestamp}.json`;
  writeFileSync(filename, JSON.stringify(testResult, null, 2));

  console.log(`\n✅ Results saved: ${filename}`);

  return testResult;
}

// Run test
runWeek5Test().catch(console.error);
