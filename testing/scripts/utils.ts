/**
 * Testing Framework Utilities
 * Helper functions untuk benchmarking
 */

import type { TransactionBenchmark, PerformanceMetrics } from './types.js';

/**
 * Calculate percentile from sorted array of numbers
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Calculate average of array
 */
export function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate min/max from array
 */
export function calculateMinMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Calculate aggregate performance metrics from transaction benchmarks
 */
export function calculatePerformanceMetrics(
  transactions: TransactionBenchmark[],
  environment: 'anvil' | 'geth' | 'production',
  totalTime: number // in ms
): PerformanceMetrics {
  if (transactions.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      environment,
      totalTransactions: 0,
      totalTime,
      tps: 0,
      avgLatency: 0,
      minLatency: 0,
      maxLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      totalGasUsed: 0n,
      avgGasPerTx: 0n,
      minGasPerTx: 0n,
      maxGasPerTx: 0n,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      totalStateGrowth: 0,
      avgStateGrowthPerTx: 0,
    };
  }

  // Calculate latencies
  const latencies = transactions.map((tx) => tx.latency);
  const latencyMinMax = calculateMinMax(latencies);

  // Calculate gas metrics
  const gasCosts = transactions.map((tx) => tx.gasCost);
  const gasUsedValues = transactions.map((tx) => Number(tx.gasUsed));
  const gasMinMax = calculateMinMax(gasUsedValues);

  // Calculate state growth
  const stateGrowths = transactions.map((tx) => tx.outputSize - tx.inputSize);
  const totalStateGrowth = stateGrowths.reduce((a, b) => a + b, 0);

  // Count success/failure
  const successCount = transactions.filter((tx) => tx.success).length;
  const failureCount = transactions.length - successCount;

  return {
    timestamp: new Date().toISOString(),
    environment,
    totalTransactions: transactions.length,
    totalTime,
    tps: (transactions.length / (totalTime / 1000)),
    avgLatency: calculateAverage(latencies),
    minLatency: latencyMinMax.min,
    maxLatency: latencyMinMax.max,
    p50Latency: calculatePercentile(latencies, 50),
    p95Latency: calculatePercentile(latencies, 95),
    p99Latency: calculatePercentile(latencies, 99),
    totalGasUsed: transactions.reduce((sum, tx) => sum + tx.gasUsed, 0n),
    avgGasPerTx: BigInt(
      Math.round(
        Number(transactions.reduce((sum, tx) => sum + tx.gasUsed, 0n)) /
          transactions.length
      )
    ),
    minGasPerTx: BigInt(Math.min(...gasUsedValues)),
    maxGasPerTx: BigInt(Math.max(...gasUsedValues)),
    successCount,
    failureCount,
    successRate: (successCount / transactions.length) * 100,
    totalStateGrowth,
    avgStateGrowthPerTx: totalStateGrowth / transactions.length,
  };
}

/**
 * Format gas value for display
 */
export function formatGas(gas: bigint | number): string {
  const g = typeof gas === 'bigint' ? Number(gas) : gas;
  if (g >= 1_000_000) {
    return `${(g / 1_000_000).toFixed(2)}M`;
  }
  if (g >= 1_000) {
    return `${(g / 1_000).toFixed(2)}K`;
  }
  return g.toString();
}

/**
 * Format TPS for display
 */
export function formatTps(tps: number): string {
  return tps.toFixed(2);
}

/**
 * Format latency for display
 */
export function formatLatency(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(2)}ms`;
}

/**
 * Print formatted benchmark summary to console
 */
export function printBenchmarkSummary(metrics: PerformanceMetrics): void {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║           📊 BENCHMARK SUMMARY                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log(`🎯 Throughput:`);
  console.log(`   TPS: ${formatTps(metrics.tps)} tx/s`);
  console.log(`   Total TX: ${metrics.totalTransactions}`);
  console.log(`   Duration: ${(metrics.totalTime / 1000).toFixed(2)}s\n`);

  console.log(`⏱️  Latency:`);
  console.log(`   Average: ${formatLatency(metrics.avgLatency)}`);
  console.log(`   Median (P50): ${formatLatency(metrics.p50Latency)}`);
  console.log(`   P95: ${formatLatency(metrics.p95Latency)}`);
  console.log(`   P99: ${formatLatency(metrics.p99Latency)}\n`);

  console.log(`⛽ Gas:`);
  console.log(`   Total: ${formatGas(metrics.totalGasUsed)}`);
  console.log(`   Avg per TX: ${formatGas(metrics.avgGasPerTx)}`);
  console.log(`   Min: ${formatGas(metrics.minGasPerTx)}`);
  console.log(`   Max: ${formatGas(metrics.maxGasPerTx)}\n`);

  console.log(`✅ Success Rate:`);
  console.log(`   ${metrics.successCount}/${metrics.totalTransactions} (${metrics.successRate.toFixed(2)}%)\n`);

  console.log(`📈 State Growth:`);
  console.log(`   Total: ${metrics.totalStateGrowth} bytes`);
  console.log(`   Per TX: ${metrics.avgStateGrowthPerTx.toFixed(2)} bytes\n`);

  console.log('═══════════════════════════════════════════════════════\n');
}

/**
 * Sleep for N milliseconds
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Measure execution time of async function
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; time: number }> {
  const start = Date.now();
  const result = await fn();
  const time = Date.now() - start;
  return { result, time };
}

/**
 * Pretty print JSON
 */
export function prettyJson(obj: any): string {
  return JSON.stringify(obj, (_, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, 2);
}

/**
 * Get current timestamp string (ISO format)
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get date string for filenames (YYYY-MM-DD-HHmmss)
 */
export function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${date}-${hours}${minutes}${seconds}`;
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`❌ Attempt ${attempt} failed. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError.message}`);
}
