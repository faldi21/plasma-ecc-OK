/**
 * Week 2: Load Testing (Simplified)
 * Execute multiple transfers from single operator account to measure throughput under load
 *
 * Simplified version that reuses Week 1 transfer logic but with higher volume
 * to identify network bottlenecks and capacity limits
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import DataCollector from './data-collector.ts';
import {
  calculatePerformanceMetrics,
  getTimestamp,
  getDateString,
  printBenchmarkSummary,
} from './utils.ts';
import type { TransactionBenchmark, BenchmarkReport } from './types.ts';

interface LoadTestConfig {
  l2RpcUrl: string;
  senderPrivateKey: `0x${string}`;
  receiverAddress: string;
  transferCount: number;
  amountPerTransfer: bigint;
  concurrentBatches: number; // How many batches to run
}

/**
 * Load configuration from .env
 */
function loadConfig(): LoadTestConfig {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const senderPrivateKey = process.env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`;
  const receiverAddress = process.env.USER_A_ADDRESS || '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';
  const transferCount = parseInt(process.env.TEST_TRANSFER_COUNT || '20');
  const amountPerTransfer = BigInt(process.env.TEST_TRANSFER_AMOUNT || '100');
  const concurrentBatches = parseInt(process.env.TEST_LOAD_BATCHES || '3');

  if (!senderPrivateKey) {
    throw new Error('Missing required env var: L2_OPERATOR_PRIVATE_KEY');
  }

  return {
    l2RpcUrl,
    senderPrivateKey,
    receiverAddress: receiverAddress as `0x${string}`,
    transferCount,
    amountPerTransfer,
    concurrentBatches,
  };
}

/**
 * Execute a batch of transfers
 */
async function executeBatch(
  config: LoadTestConfig,
  batchIndex: number,
  startTxIndex: number
): Promise<{
  benchmarks: TransactionBenchmark[];
  batchDuration: number;
}> {
  const sender = privateKeyToAccount(config.senderPrivateKey);

  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  const walletClient = createWalletClient({
    account: sender,
    transport: http(config.l2RpcUrl),
  });

  const benchmarks: TransactionBenchmark[] = [];
  const batchStartTime = Date.now();

  for (let i = 0; i < config.transferCount; i++) {
    try {
      const txStartTime = Date.now();

      const hash = await walletClient.sendTransaction({
        to: config.receiverAddress,
        value: config.amountPerTransfer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const latency = Date.now() - txStartTime;

      benchmarks.push({
        timestamp: getTimestamp(),
        environment: 'anvil' as const,
        txIndex: startTxIndex + i,
        txHash: hash,
        txType: 'transfer' as const,
        gasUsed: receipt.gasUsed,
        gasPrice: receipt.effectiveGasPrice || 0n,
        executionTime: latency,
        blockNumber: receipt.blockNumber,
        from: sender.address,
        to: config.receiverAddress,
        value: config.amountPerTransfer,
        status: receipt.status === 'success' ? 'success' : 'failed',
      });
    } catch (error) {
      console.error(`   ✗ TX ${startTxIndex + i} failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  const batchDuration = Date.now() - batchStartTime;
  return { benchmarks, batchDuration };
}

/**
 * Run load test
 */
async function runLoadTest(config: LoadTestConfig): Promise<void> {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    WEEK 2: LOAD TESTING (SIMPLIFIED) - START       ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('🔍 Configuration:');
  console.log(`   L2 RPC: ${config.l2RpcUrl}`);
  console.log(`   Sender: ${privateKeyToAccount(config.senderPrivateKey).address}`);
  console.log(`   Receiver: ${config.receiverAddress}`);
  console.log(`   TX per Batch: ${config.transferCount}`);
  console.log(`   Concurrent Batches: ${config.concurrentBatches}`);
  console.log(`   Total TX: ${config.transferCount * config.concurrentBatches}\n`);

  console.log('🚀 Executing load test...\n');

  const allBenchmarks: TransactionBenchmark[] = [];
  const overallStartTime = Date.now();

  // Run batches sequentially (each batch can have parallel TXs internally)
  for (let batchNum = 0; batchNum < config.concurrentBatches; batchNum++) {
    console.log(`   ⏳ Batch ${batchNum + 1}/${config.concurrentBatches}...`);

    const { benchmarks, batchDuration } = await executeBatch(
      config,
      batchNum,
      batchNum * config.transferCount
    );

    allBenchmarks.push(...benchmarks);

    const batchTPS = benchmarks.length > 0 ? benchmarks.length / (batchDuration / 1000) : 0;
    console.log(
      `   ✓ Batch complete: ${benchmarks.length} TX in ${(batchDuration / 1000).toFixed(2)}s (${batchTPS.toFixed(2)} TPS)`
    );
  }

  const totalDuration = Date.now() - overallStartTime;

  // Calculate metrics
  const successCount = allBenchmarks.filter((b) => b.status === 'success').length;
  const failureCount = allBenchmarks.length - successCount;

  const latencies = allBenchmarks.map((b) => b.executionTime);
  const totalGas = allBenchmarks.reduce((sum, b) => sum + b.gasUsed, 0n);

  const metrics = calculatePerformanceMetrics(allBenchmarks, 'anvil', totalDuration);

  // Prepare report
  const report: BenchmarkReport = {
    timestamp: getTimestamp(),
    environment: 'anvil' as const,
    phase: 'week2' as const,
    testName: 'load-test' as const,
    totalTransactions: allBenchmarks.length,
    successfulTransactions: successCount,
    failedTransactions: failureCount,
    totalDuration,
    metrics,
    transactions: allBenchmarks,
    summary: {
      passedTests: successCount,
      totalTests: allBenchmarks.length,
      totalTimeMinutes: totalDuration / 1000 / 60,
      keyFindings: [
        `Average gas per transfer: ${(totalGas / BigInt(Math.max(1, allBenchmarks.length))).toString()} wei`,
        `Average latency: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)}ms`,
        `TPS achieved: ${metrics.tps.toFixed(2)}`,
        `Success rate: ${((successCount / allBenchmarks.length) * 100).toFixed(2)}%`,
      ],
    },
  };

  // Save results (JSON only, markdown generation has issues)
  const collector = new DataCollector();

  // Save just the JSON report directly to avoid markdown generation errors
  const timestamp = getDateString();
  const jsonFilename = `load-test-${timestamp}.json`;
  const analysisDir = resolve(collector.dataDir, 'analysis');
  const jsonPath = resolve(analysisDir, jsonFilename);

  // Create analysis directory if needed
  try {
    mkdirSync(analysisDir, { recursive: true });
  } catch (e) {
    // Directory might already exist
  }

  // Write JSON directly
  writeFileSync(jsonPath, JSON.stringify(report, (_, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, 2));

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║              📊 LOAD TEST SUMMARY                 ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('📈 Results:');
  console.log(`   Total TX: ${allBenchmarks.length}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failureCount}`);
  console.log(`   Success Rate: ${((successCount / allBenchmarks.length) * 100).toFixed(2)}%\n`);

  console.log('⏱️  Performance:');
  console.log(`   Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   Average TPS: ${metrics.tps.toFixed(2)}`);
  console.log(`   Min Latency: ${Math.min(...latencies).toFixed(2)}ms`);
  console.log(`   Avg Latency: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)}ms`);
  console.log(`   Max Latency: ${Math.max(...latencies).toFixed(2)}ms\n`);

  console.log('⛽ Gas:');
  console.log(`   Total: ${totalGas.toString()}`);
  console.log(`   Avg per TX: ${(totalGas / BigInt(allBenchmarks.length)).toString()}\n`);

  console.log(`📁 Reports saved:`);
  console.log(`   JSON: ${jsonPath}\n`);
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const config = loadConfig();
    await runLoadTest(config);
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

main();
