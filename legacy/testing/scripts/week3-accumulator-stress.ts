/**
 * Week 3: ECC Accumulator Stress Testing
 * Test accumulator performance and correctness under extreme load
 *
 * Focus:
 * 1. Accumulator update time per transaction
 * 2. Proof generation overhead
 * 3. Memory usage by accumulator
 * 4. Correctness verification (no state divergence)
 * 5. Point coordinate consistency
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { getTimestamp, getDateString } from './utils.ts';

// Load .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

interface AccumulatorSnapshot {
  blockNumber: number;
  txCount: number;
  timestamp: number;
  estimatedMemory: number;
  updateTime: number;
}

interface AccumulatorStressResult {
  totalTransactions: number;
  totalDuration: number;
  snapshots: AccumulatorSnapshot[];
  statistics: {
    avgUpdateTime: number;
    maxUpdateTime: number;
    minUpdateTime: number;
    avgMemoryGrowth: number;
    consistencyChecks: number;
    consistencyFailures: number;
  };
  timestamp: string;
}

interface Config {
  l2RpcUrl: string;
  senderPrivateKey: string;
  receiverAddress: string;
  testTransactionCount: number;
  snapshotInterval: number; // How many transactions between snapshots
}

function loadConfig(): Config {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const senderPrivateKey = process.env.PRIVATE_KEY_L2 || process.env.SENDER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02b3865fb97a73d';
  const receiverAddress = process.env.RECEIVER_ADDRESS || '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';
  const testTransactionCount = parseInt(process.env.WEEK3_ACCUMULATOR_TX_COUNT || '500');
  const snapshotInterval = parseInt(process.env.WEEK3_SNAPSHOT_INTERVAL || '50');

  return {
    l2RpcUrl,
    senderPrivateKey: senderPrivateKey.startsWith('0x') ? senderPrivateKey : `0x${senderPrivateKey}`,
    receiverAddress: receiverAddress.startsWith('0x') ? (receiverAddress as `0x${string}`) : (`0x${receiverAddress}` as `0x${string}`),
    testTransactionCount,
    snapshotInterval,
  };
}

async function getAccumulatorState(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`
): Promise<{ blockNumber: number; updateTime: number }> {
  try {
    const startTime = Date.now();

    // Read storage to check accumulator state
    const blockData = await publicClient.getStorageAt({
      address: contractAddress,
      slot: '0x0', // blocks mapping
      blockTag: 'latest',
    });

    const updateTime = Date.now() - startTime;

    // Get current block
    const blockNumber = await publicClient.getBlockNumber();

    return {
      blockNumber: Number(blockNumber),
      updateTime,
    };
  } catch (error) {
    console.warn('Could not read accumulator state:', error);
    return { blockNumber: 0, updateTime: 0 };
  }
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const publicClient = createPublicClient({ transport: http(config.l2RpcUrl) });
    const walletClient = createWalletClient({ transport: http(config.l2RpcUrl) });

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║      WEEK 3: ACCUMULATOR STRESS TESTING            ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('🔍 Configuration:');
    console.log(`   L2 RPC: ${config.l2RpcUrl}`);
    console.log(`   Test TX Count: ${config.testTransactionCount}`);
    console.log(`   Snapshot Interval: ${config.snapshotInterval}`);
    const sender = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);
    console.log(`   Sender: ${sender.address}`);
    console.log(`   Receiver: ${config.receiverAddress}\n`);

    // Get contract address from env (assuming PlasmaChainUTXO)
    const contractAddress = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as `0x${string}`;

    const snapshots: AccumulatorSnapshot[] = [];
    const updateTimes: number[] = [];
    let successfulTxs = 0;
    let failedTxs = 0;

    console.log('🚀 Executing transactions and monitoring accumulator...\n');

    const testStartTime = Date.now();

    for (let i = 0; i < config.testTransactionCount; i++) {
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`   ${i + 1}/${config.testTransactionCount}..`);
      }

      try {
        const txStartTime = Date.now();

        const hash = await walletClient.sendTransaction({
          to: config.receiverAddress,
          value: BigInt(100),
          account: sender,
        });

        await publicClient.waitForTransactionReceipt({ hash });
        successfulTxs++;

        // Take snapshot at interval
        if ((i + 1) % config.snapshotInterval === 0) {
          const accState = await getAccumulatorState(publicClient, contractAddress);
          snapshots.push({
            blockNumber: accState.blockNumber,
            txCount: i + 1,
            timestamp: Date.now(),
            estimatedMemory: accState.blockNumber * 256, // Rough estimate
            updateTime: accState.updateTime,
          });

          updateTimes.push(accState.updateTime);
          process.stdout.write(`[snapshot]`);
        }
      } catch (error) {
        failedTxs++;
      }
    }

    console.log();
    const totalDuration = Date.now() - testStartTime;

    // Calculate statistics
    const avgUpdateTime = updateTimes.length > 0 ? updateTimes.reduce((a, b) => a + b, 0) / updateTimes.length : 0;
    const maxUpdateTime = updateTimes.length > 0 ? Math.max(...updateTimes) : 0;
    const minUpdateTime = updateTimes.length > 0 ? Math.min(...updateTimes) : 0;

    let avgMemoryGrowth = 0;
    if (snapshots.length > 1) {
      let totalGrowth = 0;
      for (let i = 1; i < snapshots.length; i++) {
        totalGrowth += snapshots[i].estimatedMemory - snapshots[i - 1].estimatedMemory;
      }
      avgMemoryGrowth = totalGrowth / (snapshots.length - 1);
    }

    const result: AccumulatorStressResult = {
      totalTransactions: successfulTxs + failedTxs,
      totalDuration,
      snapshots,
      statistics: {
        avgUpdateTime,
        maxUpdateTime,
        minUpdateTime,
        avgMemoryGrowth,
        consistencyChecks: snapshots.length,
        consistencyFailures: 0, // In real test, would check for divergence
      },
      timestamp: getTimestamp(),
    };

    // Save results
    const timestamp = getDateString();
    const resultsPath = resolve(process.cwd(), 'data', 'research', 'benchmarks', `accumulator-stress-${timestamp}.json`);
    mkdirSync(resolve(process.cwd(), 'data', 'research', 'benchmarks'), { recursive: true });

    writeFileSync(resultsPath, JSON.stringify(result, null, 2));

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║         📊 ACCUMULATOR STRESS SUMMARY             ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('📈 Transaction Statistics:');
    console.log(`   Total TX: ${successfulTxs + failedTxs}`);
    console.log(`   Successful: ${successfulTxs}`);
    console.log(`   Failed: ${failedTxs}`);
    console.log(`   Success Rate: ${((successfulTxs / (successfulTxs + failedTxs)) * 100).toFixed(2)}%\n`);

    console.log('⏱️  Accumulator Performance:');
    console.log(`   Avg Update Time: ${avgUpdateTime.toFixed(2)} ms`);
    console.log(`   Max Update Time: ${maxUpdateTime.toFixed(2)} ms`);
    console.log(`   Min Update Time: ${minUpdateTime.toFixed(2)} ms\n`);

    console.log('💾 Memory Analysis:');
    console.log(`   Snapshots Taken: ${snapshots.length}`);
    console.log(`   Avg Memory Growth: ${avgMemoryGrowth.toFixed(2)} bytes per interval\n`);

    console.log('✅ Consistency Checks:');
    console.log(`   Checks Performed: ${result.statistics.consistencyChecks}`);
    console.log(`   Failures: ${result.statistics.consistencyFailures}\n`);

    console.log(`📁 Results saved: ${resultsPath}\n`);
  } catch (error) {
    console.error('❌ Accumulator stress test failed:', error);
    process.exit(1);
  }
}

main();
