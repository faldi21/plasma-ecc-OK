#!/usr/bin/env tsx
/**
 * Real TPS Test - Shows TRUE high throughput capability
 *
 * Strategy:
 * 1. Use MANY accounts (each account sends independently)
 * 2. Pre-fetch all nonces ONCE
 * 3. Pre-create all signatures
 * 4. Fire all requests concurrently
 * 5. Measure actual throughput
 */

import axios from 'axios';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, keccak256, encodePacked, parseEther, type Address } from 'viem';
import { foundry } from 'viem/chains';
import { randomBytes } from 'crypto';

const BACKEND_URL = 'http://localhost:3001';
const TOKEN_ADDRESS = '0x663F3ad617193148711d28f5334eE4Ed07016602' as Address;
const L2_RPC_URL = 'http://localhost:8545';

// Main test accounts (with balance) - from your .env
const FUNDED_ACCOUNTS = [
  {
    key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address,
  },
  {
    key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address,
  },
];

interface PreparedTx {
  from: Address;
  to: Address;
  amount: string;
  signature: string;
  nonce: number;
}

async function createSignature(
  from: Address,
  to: Address,
  amount: bigint,
  nonce: number,
  privateKey: string
): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(L2_RPC_URL),
  });

  const messageHash = keccak256(
    encodePacked(
      ['address', 'address', 'address', 'uint256', 'uint256'],
      [from, to, TOKEN_ADDRESS, amount, BigInt(nonce)]
    )
  );

  return await walletClient.signMessage({
    message: { raw: messageHash },
  });
}

async function sendTransfer(tx: PreparedTx): Promise<{ success: boolean; latency: number; error?: string }> {
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/transfer`,
      {
        from: tx.from,
        to: tx.to,
        tokenAddress: TOKEN_ADDRESS,
        amount: tx.amount,
        signature: tx.signature,
        nonce: tx.nonce.toString(),
      },
      { timeout: 10000 }
    );

    return {
      success: response.data.success,
      latency: Date.now() - startTime,
      error: response.data.error,
    };
  } catch (error: any) {
    return {
      success: false,
      latency: Date.now() - startTime,
      error: error.response?.data?.error || error.message,
    };
  }
}

async function main() {
  const totalTx = parseInt(process.argv[2] || '200');
  const concurrency = parseInt(process.argv[3] || '50');

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('          REAL TPS TEST - HIGH THROUGHPUT');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`📊 Test Configuration:`);
  console.log(`   Total Transactions:    ${totalTx}`);
  console.log(`   Concurrency:           ${concurrency}`);
  console.log(`   Funded Accounts:       ${FUNDED_ACCOUNTS.length}`);
  console.log('');

  // Check server health
  try {
    await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
    console.log('✅ Backend server is healthy\n');
  } catch (error) {
    console.error('❌ Backend server is not responding!\n');
    process.exit(1);
  }

  console.log('📋 Phase 1: Fetching current nonces...');

  // Fetch current nonces for all accounts
  const accountNonces = new Map<Address, number>();

  for (const account of FUNDED_ACCOUNTS) {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/nonce/${account.address}`);
      accountNonces.set(account.address, response.data.nonce);
      console.log(`   ${account.address}: ${response.data.nonce}`);
    } catch (error) {
      console.error(`   ❌ Failed to fetch nonce for ${account.address}`);
      process.exit(1);
    }
  }

  console.log('');
  console.log('🔐 Phase 2: Pre-creating all signatures...');

  const preparedTxs: PreparedTx[] = [];
  const amount = parseEther('0.01'); // Small amount to allow many transfers

  // Create transactions alternating between accounts
  for (let i = 0; i < totalTx; i++) {
    const fromIndex = i % FUNDED_ACCOUNTS.length;
    const toIndex = (i + 1) % FUNDED_ACCOUNTS.length;

    const fromAccount = FUNDED_ACCOUNTS[fromIndex];
    const toAccount = FUNDED_ACCOUNTS[toIndex];

    const currentNonce = accountNonces.get(fromAccount.address)!;

    const signature = await createSignature(
      fromAccount.address,
      toAccount.address,
      amount,
      currentNonce,
      fromAccount.key
    );

    preparedTxs.push({
      from: fromAccount.address,
      to: toAccount.address,
      amount: '0.01',
      signature,
      nonce: currentNonce,
    });

    // Increment nonce for next tx from this account
    accountNonces.set(fromAccount.address, currentNonce + 1);

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r   Created: ${i + 1}/${totalTx} signatures`);
    }
  }
  console.log(`\r   Created: ${totalTx}/${totalTx} signatures ✅\n`);

  console.log('🚀 Phase 3: Firing all transactions concurrently...\n');
  console.log('   ⏱️  Timer started!\n');

  const startTime = Date.now();
  const results: Array<{ success: boolean; latency: number; error?: string }> = [];

  // Execute in controlled batches for stability
  for (let i = 0; i < preparedTxs.length; i += concurrency) {
    const batch = preparedTxs.slice(i, i + concurrency);
    const promises = batch.map((tx) => sendTransfer(tx));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    const progress = Math.min(i + concurrency, totalTx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const currentTps = (progress / parseFloat(elapsed)).toFixed(2);

    process.stdout.write(
      `\r   Progress: ${progress}/${totalTx} | ` +
      `Elapsed: ${elapsed}s | ` +
      `Current TPS: ${currentTps}`
    );
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n');

  // Calculate statistics
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const latencies = results.filter((r) => r.success).map((r) => r.latency);

  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  const actualTps = totalTx / totalTime;
  const successTps = successful / totalTime;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('              REAL TPS TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Transaction Statistics:');
  console.log(`   Total Sent:            ${totalTx}`);
  console.log(`   Successful:            ${successful} ✅`);
  console.log(`   Failed:                ${failed} ❌`);
  console.log(`   Success Rate:          ${((successful / totalTx) * 100).toFixed(2)}%`);
  console.log('');
  console.log('⚡ Performance Metrics:');
  console.log(`   Total Time:            ${totalTime.toFixed(3)}s`);
  console.log(`   Total Throughput:      ${actualTps.toFixed(2)} tx/s`);
  console.log(`   Success Throughput:    ${successTps.toFixed(2)} tx/s   ← REAL TPS!`);
  console.log('');
  console.log('⏱️  Latency Statistics:');
  console.log(`   Average Latency:       ${avgLatency.toFixed(2)}ms`);
  console.log(`   Min Latency:           ${minLatency.toFixed(2)}ms`);
  console.log(`   Max Latency:           ${maxLatency.toFixed(2)}ms`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Comparison with old system
  const oldLatency = 4260; // ms
  const oldTps = 0.23;
  const latencyImprovement = oldLatency / avgLatency;
  const tpsImprovement = successTps / oldTps;

  console.log('📈 Comparison with Old System:');
  console.log('');
  console.log('   Old System:');
  console.log(`      Latency:            ${oldLatency}ms`);
  console.log(`      TPS:                ${oldTps}`);
  console.log('');
  console.log('   New System (Fast):');
  console.log(`      Latency:            ${avgLatency.toFixed(2)}ms`);
  console.log(`      TPS:                ${successTps.toFixed(2)}`);
  console.log('');
  console.log('   🚀 IMPROVEMENT:');
  console.log(`      Latency:            ${latencyImprovement.toFixed(1)}x FASTER ⚡`);
  console.log(`      TPS:                ${tpsImprovement.toFixed(1)}x FASTER ⚡`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  if (failed > 0) {
    console.log('❌ Top 5 Failure Reasons:');
    const errorCounts = new Map<string, number>();
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        const error = r.error || 'Unknown';
        errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
      });

    const topErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    topErrors.forEach(([error, count]) => {
      console.log(`   ${count}x - ${error}`);
    });
    console.log('');
  }

  // Check pending transactions
  try {
    const pendingResponse = await axios.get(`${BACKEND_URL}/api/pending-count`);
    console.log('📦 Server Status:');
    console.log(`   Pending Transactions:  ${pendingResponse.data.count}`);
    console.log(`   (Waiting for batch submission to L1)`);
    console.log('');
  } catch (error) {
    // Ignore
  }

  console.log('✅ Test completed!\n');
}

main().catch(console.error);
