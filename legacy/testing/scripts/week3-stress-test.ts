/**
 * Week 3: Progressive Stress Testing
 * Escalate transaction load from 100 to 2000+ TX to find breaking point
 *
 * Phases:
 * 1. Phase 1: 100 TX (baseline high volume)
 * 2. Phase 2: 250 TX (1x -> 2.5x)
 * 3. Phase 3: 500 TX (1x -> 5x)
 * 4. Phase 4: 1000 TX (1x -> 10x)
 * 5. Phase 5: 2000+ TX (extreme stress)
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import DataCollector from './data-collector.ts';
import { getTimestamp, getDateString } from './utils.ts';
import type { LoadTestResult, PerformanceMetrics } from './types.ts';

// Load .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

interface StressPhase {
  phase: number;
  transactionCount: number;
  batchSize: number;
  description: string;
}

interface PhaseResult {
  phase: number;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalTime: number;
  tps: number;
  avgLatency: number | null;
  minLatency: number | null;
  maxLatency: number | null;
  errors: Array<{ tx: number; error: string }>;
  timestamp: string;
}

const STRESS_PHASES: StressPhase[] = [
  { phase: 1, transactionCount: 100, batchSize: 20, description: 'Baseline high volume' },
  { phase: 2, transactionCount: 250, batchSize: 25, description: '2.5x increase' },
  { phase: 3, transactionCount: 500, batchSize: 50, description: '5x increase' },
  { phase: 4, transactionCount: 1000, batchSize: 100, description: '10x increase' },
  { phase: 5, transactionCount: 2000, batchSize: 200, description: 'Extreme stress' },
];

interface Config {
  l2RpcUrl: string;
  senderPrivateKey: string;
  receiverAddress: string;
  stopOnFailure: boolean; // Stop testing if failure rate exceeds threshold
  failureThreshold: number; // %
}

function loadConfig(): Config {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const senderPrivateKey = process.env.PRIVATE_KEY_L2 || process.env.SENDER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02b3865fb97a73d';
  const receiverAddress = process.env.RECEIVER_ADDRESS || '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';
  const stopOnFailure = process.env.WEEK3_STOP_ON_FAILURE === 'true';
  const failureThreshold = parseInt(process.env.WEEK3_FAILURE_THRESHOLD || '10'); // 10% default

  return {
    l2RpcUrl,
    senderPrivateKey: senderPrivateKey.startsWith('0x') ? senderPrivateKey : `0x${senderPrivateKey}`,
    receiverAddress: receiverAddress.startsWith('0x') ? (receiverAddress as `0x${string}`) : (`0x${receiverAddress}` as `0x${string}`),
    stopOnFailure,
    failureThreshold,
  };
}

async function executePhase(
  config: Config,
  phase: StressPhase,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<PhaseResult> {
  console.log(`\n⏳ PHASE ${phase.phase}: ${phase.description}`);
  console.log(`   Transactions: ${phase.transactionCount}`);
  console.log(`   Batch Size: ${phase.batchSize}`);
  console.log('');

  const startTime = Date.now();
  let successCount = 0;
  let failureCount = 0;
  const errors: Array<{ tx: number; error: string }> = [];
  const latencies: number[] = [];

  const numBatches = Math.ceil(phase.transactionCount / phase.batchSize);
  let txIndex = 0;

  for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
    const batchStart = Date.now();
    const txsInBatch = Math.min(phase.batchSize, phase.transactionCount - batchIdx * phase.batchSize);

    process.stdout.write(`   Batch ${batchIdx + 1}/${numBatches}: `);

    for (let i = 0; i < txsInBatch; i++) {
      try {
        const txStartTime = Date.now();

        const hash = await walletClient.sendTransaction({
          to: config.receiverAddress,
          value: BigInt(100),
          account: privateKeyToAccount(config.senderPrivateKey as `0x${string}`),
        });

        // Wait for receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });

        const txLatency = Date.now() - txStartTime;
        latencies.push(txLatency);
        successCount++;
        txIndex++;

        if ((txIndex) % 10 === 0) {
          process.stdout.write(`${txIndex}..`);
        }
      } catch (error) {
        failureCount++;
        txIndex++;
        errors.push({
          tx: txIndex,
          error: error instanceof Error ? error.message : String(error),
        });

        if (failureCount > 0) {
          process.stdout.write('F');
        }
      }
    }

    const batchDuration = Date.now() - batchStart;
    const batchTps = (txsInBatch / (batchDuration / 1000)).toFixed(2);
    console.log(` ${batchTps} TPS`);

    // Check failure threshold
    const failureRate = (failureCount / txIndex) * 100;
    if (config.stopOnFailure && failureRate > config.failureThreshold) {
      console.log(`\n⚠️  Failure rate ${failureRate.toFixed(2)}% exceeds threshold ${config.failureThreshold}%`);
      console.log('   Stopping phase execution');
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  const tps = (successCount / (totalTime / 1000)).toFixed(2);
  const avgLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2) : null;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : null;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;

  return {
    phase: phase.phase,
    totalTransactions: successCount + failureCount,
    successfulTransactions: successCount,
    failedTransactions: failureCount,
    totalTime,
    tps: parseFloat(tps as string),
    avgLatency: avgLatency ? parseFloat(avgLatency as string) : null,
    minLatency,
    maxLatency,
    errors,
    timestamp: getTimestamp(),
  };
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const publicClient = createPublicClient({ transport: http(config.l2RpcUrl) });
    const walletClient = createWalletClient({ transport: http(config.l2RpcUrl) });

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║    WEEK 3: PROGRESSIVE STRESS TESTING - START      ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('🔍 Configuration:');
    console.log(`   L2 RPC: ${config.l2RpcUrl}`);
    console.log(`   Sender: ${privateKeyToAccount(config.senderPrivateKey as `0x${string}`).address}`);
    console.log(`   Receiver: ${config.receiverAddress}`);
    console.log(`   Stop on Failure: ${config.stopOnFailure}`);
    console.log(`   Failure Threshold: ${config.failureThreshold}%\n`);

    const allPhaseResults: PhaseResult[] = [];

    for (const phase of STRESS_PHASES) {
      const phaseResult = await executePhase(config, phase, publicClient, walletClient);
      allPhaseResults.push(phaseResult);

      // Summary for this phase
      console.log(`\n   📊 Phase ${phase.phase} Summary:`);
      console.log(`      Total: ${phaseResult.totalTransactions}`);
      console.log(`      Success: ${phaseResult.successfulTransactions} (${((phaseResult.successfulTransactions / phaseResult.totalTransactions) * 100).toFixed(2)}%)`);
      console.log(`      Failed: ${phaseResult.failedTransactions}`);
      console.log(`      TPS: ${phaseResult.tps}`);
      console.log(`      Avg Latency: ${phaseResult.avgLatency ?? 'N/A'} ms`);

      // Check if we should continue
      const failureRate = (phaseResult.failedTransactions / phaseResult.totalTransactions) * 100;
      if (config.stopOnFailure && failureRate > config.failureThreshold) {
        console.log(`\n⚠️  Stopping at Phase ${phase.phase} due to high failure rate`);
        break;
      }
    }

    // Save results
    const collector = new DataCollector();
    const timestamp = getDateString();

    // Save detailed results for each phase
    for (const result of allPhaseResults) {
      const phasePath = resolve(
        collector.dataDir,
        'benchmarks',
        `stress-test-phase${result.phase}-${timestamp}.json`
      );
      mkdirSync(resolve(collector.dataDir, 'benchmarks'), { recursive: true });
      writeFileSync(phasePath, JSON.stringify(result, null, 2));
    }

    // Save summary across all phases
    const summaryPath = resolve(collector.dataDir, 'benchmarks', `stress-test-summary-${timestamp}.json`);
    writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          timestamp: getTimestamp(),
          totalPhases: allPhaseResults.length,
          phases: allPhaseResults,
          summary: {
            maxTps: Math.max(...allPhaseResults.map((p) => p.tps)),
            minTps: Math.min(...allPhaseResults.map((p) => p.tps)),
            avgTps: (allPhaseResults.reduce((sum, p) => sum + p.tps, 0) / allPhaseResults.length).toFixed(2),
            totalTransactions: allPhaseResults.reduce((sum, p) => sum + p.totalTransactions, 0),
            totalSuccessful: allPhaseResults.reduce((sum, p) => sum + p.successfulTransactions, 0),
            totalFailed: allPhaseResults.reduce((sum, p) => sum + p.failedTransactions, 0),
            overallSuccessRate: (
              (allPhaseResults.reduce((sum, p) => sum + p.successfulTransactions, 0) /
                allPhaseResults.reduce((sum, p) => sum + p.totalTransactions, 0)) *
              100
            ).toFixed(2),
          },
        },
        null,
        2
      )
    );

    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║           📊 STRESS TEST COMPLETE                 ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('📈 Overall Summary:');
    console.log(`   Total Phases: ${allPhaseResults.length}`);
    console.log(`   Total Transactions: ${allPhaseResults.reduce((sum, p) => sum + p.totalTransactions, 0)}`);
    console.log(`   Successful: ${allPhaseResults.reduce((sum, p) => sum + p.successfulTransactions, 0)}`);
    console.log(`   Failed: ${allPhaseResults.reduce((sum, p) => sum + p.failedTransactions, 0)}`);
    console.log(`   Min TPS: ${Math.min(...allPhaseResults.map((p) => p.tps)).toFixed(2)}`);
    console.log(`   Max TPS: ${Math.max(...allPhaseResults.map((p) => p.tps)).toFixed(2)}`);
    console.log(`   Avg TPS: ${(allPhaseResults.reduce((sum, p) => sum + p.tps, 0) / allPhaseResults.length).toFixed(2)}`);
    console.log(`\n📁 Results saved: ${summaryPath}\n`);
  } catch (error) {
    console.error('❌ Stress test failed:', error);
    process.exit(1);
  }
}

main();
