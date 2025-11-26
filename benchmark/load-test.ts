#!/usr/bin/env node
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load Testing Script for Plasma ECC Layer 2
 *
 * This script sends multiple transactions to test throughput and performance
 *
 * Features:
 * - Concurrent transaction sending
 * - Deposits and Transfers testing
 * - Performance metrics (TPS, latency, success rate)
 * - Configurable batch size and concurrency
 */

interface TestConfig {
  // RPC endpoints
  l2RpcUrl: string;
  l2ChainId: number;

  // Contract addresses
  plasmaChainAddress: `0x${string}`;
  plasmaTokenAddress: `0x${string}`;

  // Test accounts
  operatorPrivateKey: `0x${string}`;
  testAccounts: `0x${string}`[];

  // Test parameters
  totalTransactions: number;
  concurrency: number;
  testType: 'deposit' | 'transfer' | 'mixed';
  amountPerTx: string; // in ether units

  // Delays
  delayBetweenBatches?: number; // ms
}

interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  latency: number; // ms
  timestamp: number;
}

interface TestMetrics {
  totalTx: number;
  successfulTx: number;
  failedTx: number;
  totalTime: number; // ms
  avgLatency: number; // ms
  minLatency: number; // ms
  maxLatency: number; // ms
  tps: number; // transactions per second
  successRate: number; // percentage
}

// Load contract ABIs
const plasmaChainAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../out/PlasmaChain.sol/PlasmaChain.json'), 'utf-8')
).abi;

const plasmaTokenAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../out/PlasmaToken.sol/PlasmaToken.json'), 'utf-8')
).abi;

class LoadTester {
  private config: TestConfig;
  private publicClient: any;
  private results: TransactionResult[] = [];

  constructor(config: TestConfig) {
    this.config = config;

    // Create public client for reading
    this.publicClient = createPublicClient({
      chain: {
        ...foundry,
        id: config.l2ChainId,
        rpcUrls: {
          default: { http: [config.l2RpcUrl] },
          public: { http: [config.l2RpcUrl] },
        },
      },
      transport: http(config.l2RpcUrl),
    });
  }

  /**
   * Execute deposit transaction
   */
  private async executeDeposit(
    senderKey: `0x${string}`,
    amount: bigint
  ): Promise<TransactionResult> {
    const startTime = Date.now();

    try {
      const account = privateKeyToAccount(senderKey);
      const walletClient = createWalletClient({
        account,
        chain: {
          ...foundry,
          id: this.config.l2ChainId,
          rpcUrls: {
            default: { http: [this.config.l2RpcUrl] },
            public: { http: [this.config.l2RpcUrl] },
          },
        },
        transport: http(this.config.l2RpcUrl),
      });

      // Approve token first
      const approveHash = await walletClient.writeContract({
        address: this.config.plasmaTokenAddress,
        abi: plasmaTokenAbi,
        functionName: 'approve',
        args: [this.config.plasmaChainAddress, amount],
      });

      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Execute deposit
      const depositHash = await walletClient.writeContract({
        address: this.config.plasmaChainAddress,
        abi: plasmaChainAbi,
        functionName: 'deposit',
        args: [this.config.plasmaTokenAddress, amount],
      });

      await this.publicClient.waitForTransactionReceipt({ hash: depositHash });

      const latency = Date.now() - startTime;
      return {
        success: true,
        txHash: depositHash,
        latency,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        latency,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute transfer transaction
   */
  private async executeTransfer(
    senderKey: `0x${string}`,
    recipientAddress: `0x${string}`,
    amount: bigint
  ): Promise<TransactionResult> {
    const startTime = Date.now();

    try {
      const account = privateKeyToAccount(senderKey);
      const walletClient = createWalletClient({
        account,
        chain: {
          ...foundry,
          id: this.config.l2ChainId,
          rpcUrls: {
            default: { http: [this.config.l2RpcUrl] },
            public: { http: [this.config.l2RpcUrl] },
          },
        },
        transport: http(this.config.l2RpcUrl),
      });

      // Execute transfer on Layer 2
      const transferHash = await walletClient.writeContract({
        address: this.config.plasmaChainAddress,
        abi: plasmaChainAbi,
        functionName: 'executeTransaction',
        args: [
          account.address,
          recipientAddress,
          this.config.plasmaTokenAddress,
          amount,
          0, // nonce (should increment in real scenario)
          '0x', // empty signature for testing
        ],
      });

      await this.publicClient.waitForTransactionReceipt({ hash: transferHash });

      const latency = Date.now() - startTime;
      return {
        success: true,
        txHash: transferHash,
        latency,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        latency,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute a batch of transactions concurrently
   */
  private async executeBatch(
    txCount: number,
    testType: 'deposit' | 'transfer'
  ): Promise<TransactionResult[]> {
    const promises: Promise<TransactionResult>[] = [];
    const amount = parseEther(this.config.amountPerTx);

    for (let i = 0; i < txCount; i++) {
      const senderKey = this.config.testAccounts[i % this.config.testAccounts.length];

      if (testType === 'deposit') {
        promises.push(this.executeDeposit(senderKey, amount));
      } else {
        // For transfer, send to next account in rotation
        const recipientIdx = (i + 1) % this.config.testAccounts.length;
        const recipientKey = this.config.testAccounts[recipientIdx];
        const recipientAddress = privateKeyToAccount(recipientKey).address;
        promises.push(this.executeTransfer(senderKey, recipientAddress, amount));
      }
    }

    return Promise.all(promises);
  }

  /**
   * Calculate metrics from results
   */
  private calculateMetrics(): TestMetrics {
    const successfulTx = this.results.filter(r => r.success).length;
    const failedTx = this.results.filter(r => !r.success).length;

    const latencies = this.results.map(r => r.latency);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);

    const timestamps = this.results.map(r => r.timestamp);
    const totalTime = Math.max(...timestamps) - Math.min(...timestamps);
    const tps = (successfulTx / totalTime) * 1000; // convert ms to seconds

    const successRate = (successfulTx / this.results.length) * 100;

    return {
      totalTx: this.results.length,
      successfulTx,
      failedTx,
      totalTime,
      avgLatency,
      minLatency,
      maxLatency,
      tps,
      successRate,
    };
  }

  /**
   * Print test report
   */
  private printReport(metrics: TestMetrics): void {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('           LOAD TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Transaction Statistics:');
    console.log(`   Total Transactions:    ${metrics.totalTx}`);
    console.log(`   Successful:            ${metrics.successfulTx} ✅`);
    console.log(`   Failed:                ${metrics.failedTx} ❌`);
    console.log(`   Success Rate:          ${metrics.successRate.toFixed(2)}%`);
    console.log('');
    console.log('⚡ Performance Metrics:');
    console.log(`   Total Time:            ${(metrics.totalTime / 1000).toFixed(2)}s`);
    console.log(`   Throughput (TPS):      ${metrics.tps.toFixed(2)} tx/s`);
    console.log('');
    console.log('⏱️  Latency Statistics:');
    console.log(`   Average Latency:       ${metrics.avgLatency.toFixed(2)}ms`);
    console.log(`   Min Latency:           ${metrics.minLatency.toFixed(2)}ms`);
    console.log(`   Max Latency:           ${metrics.maxLatency.toFixed(2)}ms`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Print failed transactions if any
    if (metrics.failedTx > 0) {
      console.log('❌ Failed Transactions:');
      this.results
        .filter(r => !r.success)
        .forEach((r, idx) => {
          console.log(`   ${idx + 1}. Error: ${r.error}`);
        });
      console.log('');
    }
  }

  /**
   * Run the load test
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Load Test...\n');
    console.log('Configuration:');
    console.log(`  Test Type:             ${this.config.testType}`);
    console.log(`  Total Transactions:    ${this.config.totalTransactions}`);
    console.log(`  Concurrency:           ${this.config.concurrency}`);
    console.log(`  Amount per Tx:         ${this.config.amountPerTx} PLASMA`);
    console.log(`  Test Accounts:         ${this.config.testAccounts.length}`);
    console.log('');

    const startTime = Date.now();

    // Calculate number of batches
    const totalBatches = Math.ceil(this.config.totalTransactions / this.config.concurrency);

    console.log(`📦 Executing ${totalBatches} batch(es)...\n`);

    for (let batch = 0; batch < totalBatches; batch++) {
      const remainingTx = this.config.totalTransactions - (batch * this.config.concurrency);
      const batchSize = Math.min(this.config.concurrency, remainingTx);

      console.log(`⏳ Batch ${batch + 1}/${totalBatches}: Sending ${batchSize} transactions...`);

      let testType: 'deposit' | 'transfer';
      if (this.config.testType === 'mixed') {
        testType = batch % 2 === 0 ? 'deposit' : 'transfer';
      } else {
        testType = this.config.testType;
      }

      const batchResults = await this.executeBatch(batchSize, testType);
      this.results.push(...batchResults);

      const batchSuccess = batchResults.filter(r => r.success).length;
      console.log(`   ✅ Completed: ${batchSuccess}/${batchSize} successful\n`);

      // Delay between batches if configured
      if (batch < totalBatches - 1 && this.config.delayBetweenBatches) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenBatches));
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ All transactions completed in ${(totalTime / 1000).toFixed(2)}s\n`);

    // Calculate and print metrics
    const metrics = this.calculateMetrics();
    this.printReport(metrics);
  }
}

// Main execution
async function main() {
  // Load environment variables
  const envPath = resolve(__dirname, '../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};

  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });

  // Parse command line arguments
  const args = process.argv.slice(2);
  const totalTx = parseInt(args[0] || '100');
  const concurrency = parseInt(args[1] || '10');
  const testType = (args[2] || 'transfer') as 'deposit' | 'transfer' | 'mixed';
  const amountPerTx = args[3] || '1';

  // Generate test accounts (using multiple private keys from env)
  const testAccounts: `0x${string}`[] = [];

  // Add operator key
  if (env.L2_OPERATOR_PRIVATE_KEY) {
    testAccounts.push(env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`);
  }

  // Add sender keys if available
  if (env.FROM_PRIVATE_KEYS) {
    const keys = env.FROM_PRIVATE_KEYS.split(',').map(k => k.trim() as `0x${string}`);
    testAccounts.push(...keys);
  } else if (env.SENDER_PRIVATE_KEY) {
    testAccounts.push(env.SENDER_PRIVATE_KEY as `0x${string}`);
  }

  // Ensure we have at least 2 accounts for testing
  if (testAccounts.length < 2) {
    console.error('❌ Error: Need at least 2 test accounts');
    console.error('   Add FROM_PRIVATE_KEYS to .env with comma-separated keys');
    process.exit(1);
  }

  const config: TestConfig = {
    l2RpcUrl: env.L2_RPC_URL || 'http://localhost:8545',
    l2ChainId: parseInt(env.L2_CHAIN_ID || '31337'),
    plasmaChainAddress: env.L2_PLASMA_CHAIN_ADDRESS as `0x${string}`,
    plasmaTokenAddress: env.L2_PLASMA_TOKEN_ADDRESS as `0x${string}`,
    operatorPrivateKey: env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`,
    testAccounts,
    totalTransactions: totalTx,
    concurrency,
    testType,
    amountPerTx,
    delayBetweenBatches: 100, // 100ms delay between batches
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('      PLASMA ECC LAYER 2 LOAD TESTING');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const tester = new LoadTester(config);
  await tester.run();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { LoadTester, TestConfig, TransactionResult, TestMetrics };
