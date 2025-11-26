#!/usr/bin/env tsx
/**
 * Pure TPS Test - No nonce management, just raw server performance
 *
 * This sends many concurrent requests to measure raw server throughput
 */

import axios from 'axios';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, keccak256, encodePacked, parseEther } from 'viem';
import { foundry } from 'viem/chains';

const BACKEND_URL = 'http://localhost:3001';
const TOKEN_ADDRESS = '0x663F3ad617193148711d28f5334eE4Ed07016602';

// Test accounts with private keys
const ACCOUNT1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ACCOUNT2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

interface TestResult {
  success: boolean;
  latency: number;
  error?: string;
}

async function createSignature(
  from: string,
  to: string,
  amount: bigint,
  nonce: number,
  privateKey: string
) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http('http://localhost:8545'),
  });

  const messageHash = keccak256(
    encodePacked(
      ['address', 'address', 'address', 'uint256', 'uint256'],
      [from as `0x${string}`, to as `0x${string}`, TOKEN_ADDRESS as `0x${string}`, amount, BigInt(nonce)]
    )
  );

  return await walletClient.signMessage({
    message: { raw: messageHash },
  });
}

async function sendTransfer(
  from: string,
  to: string,
  nonce: number,
  privateKey: string
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const amount = parseEther('0.1');
    const signature = await createSignature(from, to, amount, nonce, privateKey);

    const response = await axios.post(
      `${BACKEND_URL}/api/transfer`,
      {
        from,
        to,
        tokenAddress: TOKEN_ADDRESS,
        amount: '0.1',
        signature,
        nonce: nonce.toString(),
      },
      { timeout: 10000 }
    );

    const latency = Date.now() - startTime;

    return {
      success: response.data.success,
      latency,
      error: response.data.error,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      latency,
      error: error.response?.data?.error || error.message,
    };
  }
}

async function main() {
  const totalTx = parseInt(process.argv[2] || '100');
  const concurrency = parseInt(process.argv[3] || '50');

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('         PURE TPS TEST (NO NONCE MANAGEMENT)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total Transactions:    ${totalTx}`);
  console.log(`Concurrency:           ${concurrency}`);
  console.log('');
  console.log('⚠️  Note: Some will fail due to nonce conflicts (expected)');
  console.log('   Goal: Measure RAW server throughput capacity');
  console.log('');

  // Get current nonces
  const nonce1Response = await axios.get(`${BACKEND_URL}/api/nonce/0x62dc14Fe819A241e176ee6A813f51045d04A0cda`);
  const nonce2Response = await axios.get(`${BACKEND_URL}/api/nonce/0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76`);

  let currentNonce1 = nonce1Response.data.nonce;
  let currentNonce2 = nonce2Response.data.nonce;

  console.log(`📋 Starting Nonces:`);
  console.log(`   Account 1: ${currentNonce1}`);
  console.log(`   Account 2: ${currentNonce2}`);
  console.log('');

  const account1 = privateKeyToAccount(ACCOUNT1_KEY);
  const account2 = privateKeyToAccount(ACCOUNT2_KEY);

  // Create all transfer promises
  const allPromises: Promise<TestResult>[] = [];
  const startTime = Date.now();

  console.log('🚀 Sending all transactions concurrently...\n');

  for (let i = 0; i < totalTx; i++) {
    // Alternate between accounts
    const useAccount1 = i % 2 === 0;

    if (useAccount1) {
      allPromises.push(
        sendTransfer(
          account1.address,
          account2.address,
          currentNonce1,
          ACCOUNT1_KEY
        )
      );
      currentNonce1++;
    } else {
      allPromises.push(
        sendTransfer(
          account2.address,
          account1.address,
          currentNonce2,
          ACCOUNT2_KEY
        )
      );
      currentNonce2++;
    }
  }

  // Execute in controlled batches
  const results: TestResult[] = [];
  for (let i = 0; i < allPromises.length; i += concurrency) {
    const batch = allPromises.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);

    process.stdout.write(`\r   Progress: ${Math.min(i + concurrency, totalTx)}/${totalTx} completed`);
  }
  console.log('\n');

  const totalTime = (Date.now() - startTime) / 1000;
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const latencies = results.filter((r) => r.success).map((r) => r.latency);

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  const actualTps = totalTx / totalTime;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('              PURE TPS TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Transaction Statistics:');
  console.log(`   Total Sent:            ${totalTx}`);
  console.log(`   Successful:            ${successful} ✅`);
  console.log(`   Failed:                ${failed} ❌`);
  console.log(`   Success Rate:          ${((successful / totalTx) * 100).toFixed(2)}%`);
  console.log('');
  console.log('⚡ Performance Metrics:');
  console.log(`   Total Time:            ${totalTime.toFixed(2)}s`);
  console.log(`   Throughput (TPS):      ${actualTps.toFixed(2)} tx/s   ← PURE SERVER CAPACITY`);
  console.log(`   Requests/sec:          ${(totalTx / totalTime).toFixed(2)} req/s`);
  console.log('');
  console.log('⏱️  Latency Statistics (Successful):');
  console.log(`   Average Latency:       ${avgLatency.toFixed(2)}ms`);
  console.log(`   Min Latency:           ${minLatency.toFixed(2)}ms`);
  console.log(`   Max Latency:           ${maxLatency.toFixed(2)}ms`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  if (failed > 0) {
    const errorCounts = new Map<string, number>();
    results.filter((r) => !r.success).forEach((r) => {
      const error = r.error || 'Unknown';
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
    });

    console.log('❌ Failure Breakdown:');
    errorCounts.forEach((count, error) => {
      console.log(`   ${error}: ${count}`);
    });
    console.log('');
  }

  console.log('💡 Interpretation:');
  console.log('   - Pure TPS shows raw server capacity');
  console.log('   - Nonce conflicts are EXPECTED in this test');
  console.log('   - Focus on: Total Time and Requests/sec');
  console.log('   - Low latency = Fast processing');
  console.log('');
}

main().catch(console.error);
