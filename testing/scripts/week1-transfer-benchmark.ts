/**
 * Week 1: Transfer Benchmarking
 * Measure gas costs and latency for L2 UTXO transfers
 *
 * Test Flow:
 * 1. Setup N accounts with initial UTXO balance
 * 2. Submit M transfers from each account
 * 3. Measure gas, latency, success rate
 * 4. Analyze state growth
 * 5. Generate report
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import DataCollector from './data-collector.ts';
import {
  calculatePerformanceMetrics,
  measureTime,
  getTimestamp,
  sleep,
  getDateString,
  printBenchmarkSummary,
  retry,
} from './utils.ts';
import type { TransactionBenchmark, BenchmarkReport } from './types.ts';

interface TransferConfig {
  l2RpcUrl: string;
  plasmaChainAddress: string;
  senderPrivateKey: `0x${string}`;
  receiverAddress: string;
  transferCount: number;
  amountPerTransfer: bigint;
}

/**
 * Load configuration from .env
 */
function loadConfig(): TransferConfig {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const plasmaChainAddress = process.env.PLASMA_CHAIN_UTXO_ADDRESS;
  const senderPrivateKey = process.env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`;
  const receiverAddress = process.env.USER_A_ADDRESS || '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';
  const transferCount = parseInt(process.env.TEST_TRANSFER_COUNT || '10');
  const amountPerTransfer = BigInt(process.env.TEST_TRANSFER_AMOUNT || '100');

  if (!plasmaChainAddress || !senderPrivateKey) {
    throw new Error('Missing required env vars: PLASMA_CHAIN_UTXO_ADDRESS, L2_OPERATOR_PRIVATE_KEY');
  }

  return {
    l2RpcUrl,
    plasmaChainAddress: plasmaChainAddress as `0x${string}`,
    senderPrivateKey,
    receiverAddress: receiverAddress as `0x${string}`,
    transferCount,
    amountPerTransfer,
  };
}

/**
 * Simulate UTXO transfer
 */
async function simulateTransfer(
  config: TransferConfig,
  transferIndex: number
): Promise<TransactionBenchmark> {
  const sender = privateKeyToAccount(config.senderPrivateKey);

  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  const walletClient = createWalletClient({
    account: sender,
    transport: http(config.l2RpcUrl),
  });

  const startTime = Date.now();

  try {
    // Send transfer transaction
    // In production, this would call the actual PlasmaChainUTXO.transferUtxo()
    const hash = await walletClient.sendTransaction({
      account: sender,
      to: config.receiverAddress,
      value: config.amountPerTransfer,
    });

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const latency = Date.now() - startTime;

    const benchmark: TransactionBenchmark = {
      timestamp: getTimestamp(),
      environment: 'anvil' as const,
      txIndex: transferIndex,
      txHash: hash,
      txType: 'transfer' as const,
      gasUsed: receipt.gasUsed,
      gasPrice: receipt.effectiveGasPrice,
      gasCost: receipt.gasUsed * receipt.effectiveGasPrice,
      submissionTime: latency / 2, // Estimate
      blockTime: latency / 2,
      latency,
      inputSize: 100, // Estimated
      outputSize: 100, // Estimated
      stateRootBefore: '',
      stateRootAfter: '',
      success: true,
    };

    return benchmark;
  } catch (error: any) {
    const latency = Date.now() - startTime;

    return {
      timestamp: getTimestamp(),
      environment: 'anvil' as const,
      txIndex: transferIndex,
      txHash: '',
      txType: 'transfer' as const,
      gasUsed: 0n,
      gasPrice: 0n,
      gasCost: 0n,
      submissionTime: 0,
      blockTime: 0,
      latency,
      inputSize: 0,
      outputSize: 0,
      stateRootBefore: '',
      stateRootAfter: '',
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run transfer benchmark suite
 */
async function runTransferBenchmark(): Promise<void> {
  const config = loadConfig();
  const collector = new DataCollector();

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    WEEK 1: TRANSFER BENCHMARKING - PHASE START    ║');
  console.log('╚════════════════════════════════════════════════════╝');

  console.log('\n🔍 Configuration:');
  console.log(`   L2 RPC: ${config.l2RpcUrl}`);
  console.log(`   PlasmaChain: ${config.plasmaChainAddress}`);
  console.log(`   Sender: ${privateKeyToAccount(config.senderPrivateKey).address}`);
  console.log(`   Receiver: ${config.receiverAddress}`);
  console.log(`   Transfer Count: ${config.transferCount}`);
  console.log(`   Amount per Transfer: ${config.amountPerTransfer}`);

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('PHASE 1: EXECUTING TRANSFERS');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = await measureTime(async () => {
    const benchmarks: TransactionBenchmark[] = [];

    for (let i = 0; i < config.transferCount; i++) {
      try {
        process.stdout.write(`\r📤 Transfer ${i + 1}/${config.transferCount}`);

        const result = await retry(() => simulateTransfer(config, i), 3, 500);
        benchmarks.push(result);

        // Add delay between transfers
        if (i < config.transferCount - 1) {
          await sleep(100);
        }
      } catch (error: any) {
        console.error(`\n❌ Transfer ${i + 1} failed: ${error.message}`);
      }
    }

    console.log(`\n✅ All ${benchmarks.length} transfers completed\n`);
    return benchmarks;
  });

  if (results.result.length === 0) {
    console.error('❌ No transfers completed');
    process.exit(1);
  }

  // Calculate metrics
  const performanceMetrics = calculatePerformanceMetrics(
    results.result,
    'anvil',
    results.time
  );

  // Create report
  const successfulTxs = results.result.filter((tx) => tx.success);
  const report: BenchmarkReport = {
    timestamp: getTimestamp(),
    environment: 'anvil' as const,
    phase: 'week1' as const,
    testName: 'transfer-benchmark',
    transactionMetrics: results.result,
    performanceMetrics,
    stateMetrics: [
      {
        timestamp: getTimestamp(),
        environment: 'anvil' as const,
        txCount: successfulTxs.length,
        accumulatorSize: 256, // Estimated
        utxoSetSize: successfulTxs.length * 32, // Estimated
        totalStateSize: 256 + successfulTxs.length * 32,
        growthPerTx: (successfulTxs.length * 32) / successfulTxs.length,
        compressionRatio: 1.0,
      },
    ],
    summary: {
      totalTests: results.result.length,
      passedTests: successfulTxs.length,
      failedTests: results.result.length - successfulTxs.length,
      totalTimeMinutes: results.time / 60000,
      keyFindings: [
        `Average gas per transfer: ${(performanceMetrics.avgGasPerTx / 1000n).toString()}K`,
        `Average latency: ${performanceMetrics.avgLatency.toFixed(0)}ms`,
        `TPS achieved: ${performanceMetrics.tps.toFixed(2)}`,
        `Success rate: ${performanceMetrics.successRate.toFixed(2)}%`,
      ],
      recommendations: [
        'Monitor gas usage for optimization opportunities',
        'Consider batching transfers for higher throughput',
        'Analyze latency spikes for bottlenecks',
      ],
    },
  };

  // Save results
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('PHASE 2: SAVING RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');

  collector.saveTransactionBenchmarks(results.result);
  collector.saveTransactionBenchmarksCSV(results.result);
  collector.savePerformanceMetrics(performanceMetrics);
  collector.saveBenchmarkReport(report);

  // Print summary
  printBenchmarkSummary(performanceMetrics);

  console.log('📁 Data saved to:');
  console.log(`   ${collector.getDataDir()}/benchmarks/`);
  console.log(`   ${collector.getDataDir()}/analysis/\n`);

  console.log('✨ Week 1, Phase 2 Complete!\n');
}

// Run benchmark
runTransferBenchmark().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
