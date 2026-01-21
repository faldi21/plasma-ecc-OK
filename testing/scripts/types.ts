/**
 * Testing Framework Types
 * Data structures untuk benchmarking dan analysis
 */

export interface DeploymentBenchmark {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  // L1 Deployment
  l1Deployment: {
    contractName: string;
    gasUsed: bigint;
    txHash: string;
    blockNumber: number;
    contractAddress: string;
    executionTime: number; // ms
  };

  // L2 Deployment
  l2Deployment: {
    contractName: string;
    gasUsed: bigint;
    txHash: string;
    blockNumber: number;
    contractAddress: string;
    executionTime: number; // ms
  };
}

export interface TransactionBenchmark {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  txIndex: number;
  txHash: string;
  txType: 'transfer' | 'deposit' | 'withdrawal' | 'block-submission';

  // Gas metrics
  gasUsed: bigint;
  gasPrice: bigint;
  gasCost: bigint; // gasUsed * gasPrice

  // Timing metrics
  submissionTime: number; // ms from broadcast to confirmation
  blockTime: number; // ms from block start to confirmation
  latency: number; // total latency in ms

  // State metrics
  inputSize: number; // bytes
  outputSize: number; // bytes
  stateRootBefore: string;
  stateRootAfter: string;

  // Success/failure
  success: boolean;
  error?: string;
}

export interface PerformanceMetrics {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  // Throughput
  totalTransactions: number;
  totalTime: number; // ms
  tps: number; // transactions per second

  // Latency
  avgLatency: number; // ms
  minLatency: number; // ms
  maxLatency: number; // ms
  p50Latency: number; // median
  p95Latency: number; // 95th percentile
  p99Latency: number; // 99th percentile

  // Gas
  totalGasUsed: bigint;
  avgGasPerTx: bigint;
  minGasPerTx: bigint;
  maxGasPerTx: bigint;

  // Success rate
  successCount: number;
  failureCount: number;
  successRate: number; // 0-100

  // State
  totalStateGrowth: number; // bytes
  avgStateGrowthPerTx: number; // bytes per tx
}

export interface LoadTestResult {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  targetTps: number;

  // Achieved metrics
  achievedTps: number;
  totalTransactions: number;
  totalTime: number; // ms

  // Performance under load
  avgLatency: number; // ms
  p95Latency: number; // ms
  p99Latency: number; // ms

  // Stability
  memoryUsed: number; // MB
  cpuUsage: number; // percentage

  // Result
  success: boolean;
  bottleneck?: string; // where it broke
  notes: string;
}

export interface StateGrowthMetric {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  txCount: number;
  accumulatorSize: number; // bytes - for UTXO
  utxoSetSize: number; // bytes - all UTXOs
  totalStateSize: number; // bytes

  growthPerTx: number; // bytes per transaction
  compressionRatio: number; // (initial / current)
}

export interface BenchmarkReport {
  timestamp: string;
  environment: 'anvil' | 'geth' | 'production';

  // Phase info
  phase: 'week1' | 'week2' | 'week3' | 'week4';
  testName: string;

  // Aggregated results
  deploymentMetrics?: DeploymentBenchmark;
  transactionMetrics: TransactionBenchmark[];
  performanceMetrics: PerformanceMetrics;
  stateMetrics: StateGrowthMetric[];

  // Summary
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    totalTimeMinutes: number;
    keyFindings: string[];
    recommendations: string[];
  };
}
