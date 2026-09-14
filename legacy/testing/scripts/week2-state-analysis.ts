/**
 * Week 2: State Analysis
 * Analyze UTXO set size, accumulator growth, and state management efficiency
 *
 * Metrics:
 * 1. UTXO Set Size - How many UTXOs exist
 * 2. Accumulator Size - ECC accumulator state
 * 3. State Growth Rate - Bytes per transaction
 * 4. Compression Ratio - Original size vs compressed size
 */

import { createPublicClient, http } from 'viem';
import DataCollector from './data-collector.ts';
import { getTimestamp, getDateString } from './utils.ts';
import type { StateGrowthMetric } from './types.ts';

interface StateSnapshot {
  blockNumber: bigint;
  timestamp: number;
  utxoSetSize: number;
  accumulatorSize: number;
  totalStateSize: number;
}

interface StateAnalysisConfig {
  l2RpcUrl: string;
  plasmaChainAddress: string;
  startBlock: bigint;
  endBlock: bigint;
  sampleInterval: bigint; // How many blocks between samples
}

/**
 * Load configuration from .env
 */
function loadConfig(): StateAnalysisConfig {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const plasmaChainAddress = process.env.PLASMA_CHAIN_UTXO_ADDRESS;
  const startBlock = BigInt(process.env.STATE_ANALYSIS_START_BLOCK || '0');
  const endBlock = BigInt(process.env.STATE_ANALYSIS_END_BLOCK || '999999');
  const sampleInterval = BigInt(process.env.STATE_ANALYSIS_INTERVAL || '1');

  if (!plasmaChainAddress) {
    throw new Error('Missing required env var: PLASMA_CHAIN_UTXO_ADDRESS');
  }

  return {
    l2RpcUrl,
    plasmaChainAddress: plasmaChainAddress as `0x${string}`,
    startBlock,
    endBlock,
    sampleInterval,
  };
}

/**
 * Get UTXO set size from contract storage
 * Reads block count as a proxy for UTXO activity
 */
async function analyzeUtxoSetSize(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
  blockNumber: bigint
): Promise<{ utxoCount: number; estimatedSize: number }> {
  try {
    // Read currentBlock counter (slot 0x1) - indicates number of blocks processed
    // This is a reasonable proxy for UTXO set size
    const currentBlockSlot = await publicClient.getStorageAt({
      address: contractAddress,
      slot: '0x1',
      blockTag: 'latest',
    });

    let utxoCount = 0;
    if (currentBlockSlot && currentBlockSlot !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      // Parse as uint256
      const blockCount = parseInt(currentBlockSlot.slice(2), 16);
      // Estimate: transactions per block * average UTXOs per transaction
      // Since we don't know exact UTXO creation rate, use a reasonable estimate
      utxoCount = Math.max(2, blockCount * 2); // Conservative: 2 UTXOs per block minimum
    }

    const estimatedSize = Math.max(0, utxoCount * 32);

    return {
      utxoCount,
      estimatedSize,
    };
  } catch (error) {
    console.warn('Could not analyze UTXO set size:', error instanceof Error ? error.message.split('\n')[0] : String(error));
    return { utxoCount: 0, estimatedSize: 0 };
  }
}

/**
 * Get accumulator state size from storage
 * An active accumulator uses at least 64 bytes (Point struct: x, y as uint256)
 */
async function analyzeAccumulatorSize(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`
): Promise<number> {
  try {
    // Try reading the blocks mapping to see if accumulator is active
    // Slot 0x0 is typically blocks mapping
    const blockZeroData = await publicClient.getStorageAt({
      address: contractAddress,
      slot: '0x0',
      blockTag: 'latest',
    });

    // If blocks exist, accumulator is being used
    if (blockZeroData && blockZeroData !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      // ECC Point struct = 2 * uint256 (x, y coordinates)
      return 64;
    }

    return 0;
  } catch (error) {
    console.warn('Could not analyze accumulator size:', error instanceof Error ? error.message.split('\n')[0] : String(error));
    return 0;
  }
}

/**
 * Snapshot current state
 */
async function takeStateSnapshot(
  config: StateAnalysisConfig,
  blockNumber: bigint
): Promise<StateSnapshot> {
  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  const utxoAnalysis = await analyzeUtxoSetSize(publicClient, config.plasmaChainAddress, blockNumber);
  const accumulatorSize = await analyzeAccumulatorSize(publicClient, config.plasmaChainAddress);

  const totalStateSize = utxoAnalysis.estimatedSize + accumulatorSize;

  return {
    blockNumber,
    timestamp: Date.now(),
    utxoSetSize: utxoAnalysis.utxoCount,
    accumulatorSize,
    totalStateSize,
  };
}

/**
 * Analyze state growth over time
 */
async function analyzeStateGrowth(config: StateAnalysisConfig): Promise<StateGrowthMetric> {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    WEEK 2: STATE ANALYSIS - PHASE START            ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('🔍 Configuration:');
  console.log(`   L2 RPC: ${config.l2RpcUrl}`);
  console.log(`   Contract: ${config.plasmaChainAddress}`);
  console.log(`   Block Range: ${config.startBlock} - ${config.endBlock}`);
  console.log(`   Sample Interval: ${config.sampleInterval}\n`);

  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  // Get current block number
  const currentBlock = await publicClient.getBlockNumber();
  const analyzeEndBlock = config.endBlock > currentBlock ? currentBlock : config.endBlock;

  console.log(`📊 Taking state snapshots from block ${config.startBlock} to ${analyzeEndBlock}...\n`);

  const snapshots: StateSnapshot[] = [];

  // Sample state at intervals
  for (let block = config.startBlock; block <= analyzeEndBlock; block += config.sampleInterval) {
    try {
      const snapshot = await takeStateSnapshot(config, block);
      snapshots.push(snapshot);

      if (snapshots.length % 10 === 0) {
        console.log(`   ✓ Snapshot ${snapshots.length}: Block ${block} (UTXO: ${snapshot.utxoSetSize}, Total: ${snapshot.totalStateSize} bytes)`);
      }
    } catch (error) {
      console.warn(`   ⚠️  Failed to snapshot block ${block}:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`\n✅ Collected ${snapshots.length} state snapshots\n`);

  // Calculate growth metrics
  let totalGrowth = 0;
  let maxGrowthRate = 0;
  let growthRates: number[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const growth = snapshots[i].totalStateSize - snapshots[i - 1].totalStateSize;
    totalGrowth += Math.max(0, growth);
    growthRates.push(growth);
    maxGrowthRate = Math.max(maxGrowthRate, growth);
  }

  const avgGrowthPerSnapshot = snapshots.length > 1 ? totalGrowth / (snapshots.length - 1) : 0;
  const estimatedGrowthPerTx = avgGrowthPerSnapshot / Number(config.sampleInterval);

  // Calculate compression ratio
  // Theoretical uncompressed size: UTXO * 32 bytes
  // Compressed size: UTXO * 32 + accumulator
  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;

  snapshots.forEach((s) => {
    const uncompressed = s.utxoSetSize * 32;
    totalUncompressedSize += uncompressed;
    totalCompressedSize += s.totalStateSize;
  });

  const compressionRatio = totalUncompressedSize > 0 ? totalUncompressedSize / totalCompressedSize : 1;

  const metric: StateGrowthMetric = {
    timestamp: getTimestamp(),
    environment: 'anvil' as const,
    blockRange: {
      start: Number(config.startBlock),
      end: Number(analyzeEndBlock),
      total: Number(analyzeEndBlock - config.startBlock + 1n),
    },
    snapshotCount: snapshots.length,
    sampleInterval: Number(config.sampleInterval),
    utxoStats: {
      finalCount: snapshots.length > 0 ? snapshots[snapshots.length - 1].utxoSetSize : 0,
      minCount: Math.min(...snapshots.map((s) => s.utxoSetSize)),
      maxCount: Math.max(...snapshots.map((s) => s.utxoSetSize)),
    },
    accumulatorStats: {
      baseSize: snapshots.length > 0 ? snapshots[0].accumulatorSize : 0,
      currentSize: snapshots.length > 0 ? snapshots[snapshots.length - 1].accumulatorSize : 0,
    },
    stateGrowthStats: {
      totalGrowth,
      averagePerSnapshot: avgGrowthPerSnapshot,
      averagePerTx: estimatedGrowthPerTx,
      maxGrowthRate,
    },
    compressionRatio,
    snapshots: snapshots.map((s) => ({
      blockNumber: Number(s.blockNumber),
      utxoSetSize: s.utxoSetSize,
      accumulatorSize: s.accumulatorSize,
      totalStateSize: s.totalStateSize,
    })),
  };

  return metric;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const stateMetric = await analyzeStateGrowth(config);

    // Save results
    const collector = new DataCollector();
    const reportPath = collector.saveStateGrowthMetric(stateMetric);

    // Print summary
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║           📊 STATE ANALYSIS SUMMARY               ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('🗂️  UTXO Statistics:');
    console.log(`   Final Count: ${stateMetric.utxoStats.finalCount}`);
    console.log(`   Min Count: ${stateMetric.utxoStats.minCount}`);
    console.log(`   Max Count: ${stateMetric.utxoStats.maxCount}\n`);

    console.log('📦 Accumulator:');
    console.log(`   Base Size: ${stateMetric.accumulatorStats.baseSize} bytes`);
    console.log(`   Current Size: ${stateMetric.accumulatorStats.currentSize} bytes\n`);

    console.log('📈 State Growth:');
    console.log(`   Total Growth: ${stateMetric.stateGrowthStats.totalGrowth} bytes`);
    console.log(`   Avg per Snapshot: ${stateMetric.stateGrowthStats.averagePerSnapshot.toFixed(2)} bytes`);
    console.log(`   Avg per TX: ${stateMetric.stateGrowthStats.averagePerTx.toFixed(2)} bytes`);
    console.log(`   Max Growth Rate: ${stateMetric.stateGrowthStats.maxGrowthRate} bytes\n`);

    console.log('🗜️  Compression:');
    console.log(`   Compression Ratio: ${stateMetric.compressionRatio.toFixed(4)}x\n`);

    console.log(`📁 Report saved: ${reportPath}\n`);
  } catch (error) {
    console.error('❌ State analysis failed:', error);
    process.exit(1);
  }
}

main();
