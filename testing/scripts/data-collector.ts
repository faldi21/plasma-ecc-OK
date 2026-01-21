/**
 * Data Collector
 * Utility untuk collect, store, dan manage benchmark data
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getDateString } from './utils.ts';
import type {
  DeploymentBenchmark,
  TransactionBenchmark,
  PerformanceMetrics,
  LoadTestResult,
  StateGrowthMetric,
  BenchmarkReport,
} from './types.ts';

export class DataCollector {
  private dataDir: string;

  constructor() {
    // Use ./data/research directory for all research data
    // process.cwd() is project root when running via bash script
    this.dataDir = resolve(process.cwd(), 'data', 'research');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.dataDir,
      resolve(this.dataDir, 'benchmarks'),
      resolve(this.dataDir, 'analysis'),
      resolve(this.dataDir, 'visualizations'),
    ];

    dirs.forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Save deployment benchmark to JSON
   */
  saveDeploymentBenchmark(
    benchmark: DeploymentBenchmark,
    filename?: string
  ): string {
    const timestamp = getDateString();
    const name = filename || `deployment-${timestamp}.json`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    writeFileSync(filepath, JSON.stringify(benchmark, (_, value) => {
      // Convert bigint to string for JSON serialization
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));

    console.log(`✓ Deployment benchmark saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save transaction benchmarks to JSON
   */
  saveTransactionBenchmarks(
    benchmarks: TransactionBenchmark[],
    filename?: string
  ): string {
    const timestamp = getDateString();
    const name = filename || `transactions-${timestamp}.json`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    writeFileSync(filepath, JSON.stringify(benchmarks, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));

    console.log(`✓ Transaction benchmarks saved: ${filepath} (${benchmarks.length} txs)`);
    return filepath;
  }

  /**
   * Save as CSV for spreadsheet analysis
   */
  saveTransactionBenchmarksCSV(
    benchmarks: TransactionBenchmark[],
    filename?: string
  ): string {
    const timestamp = getDateString();
    const name = filename || `transactions-${timestamp}.csv`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    // CSV Header
    const headers = [
      'txIndex',
      'txHash',
      'txType',
      'gasUsed',
      'gasPrice',
      'gasCost',
      'submissionTime(ms)',
      'blockTime(ms)',
      'latency(ms)',
      'inputSize(bytes)',
      'outputSize(bytes)',
      'success',
      'error',
    ];

    // CSV Rows
    const rows = benchmarks.map((tx) => [
      tx.txIndex,
      tx.txHash,
      tx.txType,
      tx.gasUsed.toString(),
      tx.gasPrice.toString(),
      tx.gasCost.toString(),
      tx.submissionTime,
      tx.blockTime,
      tx.latency,
      tx.inputSize,
      tx.outputSize,
      tx.success,
      tx.error || '',
    ]);

    // Combine and write
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    writeFileSync(filepath, csv);

    console.log(`✓ Transaction CSV saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save performance metrics
   */
  savePerformanceMetrics(
    metrics: PerformanceMetrics,
    filename?: string
  ): string {
    const timestamp = getDateString();
    const name = filename || `performance-${timestamp}.json`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    writeFileSync(filepath, JSON.stringify(metrics, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));

    console.log(`✓ Performance metrics saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save load test result
   */
  saveLoadTestResult(result: LoadTestResult, filename?: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const name = filename || `load-test-${result.targetTps}tps-${timestamp}.json`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    writeFileSync(filepath, JSON.stringify(result, null, 2));

    console.log(`✓ Load test result saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save state growth metrics
   */
  saveStateGrowthMetric(metric: StateGrowthMetric, filename?: string): string {
    const timestamp = getDateString();
    const name = filename || `state-growth-${timestamp}.json`;
    const filepath = resolve(this.dataDir, 'benchmarks', name);

    writeFileSync(filepath, JSON.stringify(metric, null, 2));

    console.log(`✓ State growth metric saved: ${filepath}`);
    return filepath;
  }

  /**
   * Save complete benchmark report (markdown + JSON)
   */
  saveBenchmarkReport(report: BenchmarkReport): { json: string; markdown: string } {
    const timestamp = getDateString();
    const baseFilename = `${report.phase}-${report.testName}-${timestamp}`;

    // Save JSON
    const jsonFile = resolve(this.dataDir, 'analysis', `${baseFilename}.json`);
    writeFileSync(jsonFile, JSON.stringify(report, (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));

    // Save Markdown
    const mdFile = resolve(this.dataDir, 'analysis', `${baseFilename}.md`);
    const markdown = this.generateReportMarkdown(report);
    writeFileSync(mdFile, markdown);

    console.log(`✓ Benchmark report saved: ${jsonFile}`);
    console.log(`✓ Markdown report saved: ${mdFile}`);

    return { json: jsonFile, markdown: mdFile };
  }

  /**
   * Generate markdown report from benchmark data
   */
  private generateReportMarkdown(report: BenchmarkReport): string {
    const { summary, performanceMetrics, deploymentMetrics, stateMetrics } = report;

    let md = `# ${report.testName} - ${report.phase.toUpperCase()}\n\n`;
    md += `**Environment:** ${report.environment}\n`;
    md += `**Timestamp:** ${report.timestamp}\n\n`;

    // Summary
    md += `## Summary\n\n`;
    md += `- Tests Passed: ${summary.passedTests}/${summary.totalTests}\n`;
    md += `- Total Duration: ${summary.totalTimeMinutes.toFixed(2)} minutes\n`;
    md += `- Success Rate: ${((summary.passedTests / summary.totalTests) * 100).toFixed(2)}%\n\n`;

    // Key Findings
    if (summary.keyFindings.length > 0) {
      md += `## Key Findings\n\n`;
      summary.keyFindings.forEach((finding) => {
        md += `- ${finding}\n`;
      });
      md += `\n`;
    }

    // Performance Metrics
    if (performanceMetrics) {
      md += `## Performance Metrics\n\n`;
      md += `### Throughput\n`;
      md += `- TPS: ${performanceMetrics.tps.toFixed(2)}\n`;
      md += `- Total Transactions: ${performanceMetrics.totalTransactions}\n\n`;

      md += `### Latency\n`;
      md += `- Average: ${performanceMetrics.avgLatency.toFixed(2)}ms\n`;
      md += `- P50 (Median): ${performanceMetrics.p50Latency.toFixed(2)}ms\n`;
      md += `- P95: ${performanceMetrics.p95Latency.toFixed(2)}ms\n`;
      md += `- P99: ${performanceMetrics.p99Latency.toFixed(2)}ms\n\n`;

      md += `### Gas\n`;
      md += `- Total Gas Used: ${performanceMetrics.totalGasUsed.toString()}\n`;
      md += `- Average Gas per TX: ${performanceMetrics.avgGasPerTx.toString()}\n\n`;
    }

    // Deployment Metrics
    if (deploymentMetrics) {
      md += `## Deployment Metrics\n\n`;
      md += `### L1 Contract\n`;
      md += `- Contract: ${deploymentMetrics.l1Deployment.contractName}\n`;
      md += `- Gas Used: ${deploymentMetrics.l1Deployment.gasUsed.toString()}\n`;
      md += `- Execution Time: ${deploymentMetrics.l1Deployment.executionTime}ms\n\n`;

      md += `### L2 Contract\n`;
      md += `- Contract: ${deploymentMetrics.l2Deployment.contractName}\n`;
      md += `- Gas Used: ${deploymentMetrics.l2Deployment.gasUsed.toString()}\n`;
      md += `- Execution Time: ${deploymentMetrics.l2Deployment.executionTime}ms\n\n`;
    }

    // State Metrics
    if (stateMetrics.length > 0) {
      md += `## State Growth Analysis\n\n`;
      const latestState = stateMetrics[stateMetrics.length - 1];
      md += `- Accumulator Size: ${latestState.accumulatorSize} bytes\n`;
      md += `- UTXO Set Size: ${latestState.utxoSetSize} bytes\n`;
      md += `- Growth per TX: ${latestState.growthPerTx.toFixed(2)} bytes\n`;
      md += `- Compression Ratio: ${latestState.compressionRatio.toFixed(4)}x\n\n`;
    }

    // Recommendations
    if (summary.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      summary.recommendations.forEach((rec) => {
        md += `- ${rec}\n`;
      });
      md += `\n`;
    }

    return md;
  }

  /**
   * Load existing benchmark data
   */
  loadBenchmarkJSON(filename: string): any {
    const filepath = resolve(this.dataDir, 'benchmarks', filename);
    if (!existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  }

  /**
   * List all benchmark files
   */
  listBenchmarks(): { benchmarks: string[]; analysis: string[] } {
    const benchmarkDir = resolve(this.dataDir, 'benchmarks');
    const analysisDir = resolve(this.dataDir, 'analysis');

    const benchmarks = existsSync(benchmarkDir)
      ? require('fs').readdirSync(benchmarkDir)
      : [];
    const analysis = existsSync(analysisDir)
      ? require('fs').readdirSync(analysisDir)
      : [];

    return { benchmarks, analysis };
  }

  /**
   * Get data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }
}

export default DataCollector;
