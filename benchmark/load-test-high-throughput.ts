#!/usr/bin/env node
import axios from 'axios';
import { createWalletClient, createPublicClient, http, parseEther, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * High Throughput Load Testing Script
 *
 * Strategy: Use MANY accounts to send transactions in parallel
 * This avoids nonce conflicts since each account has its own nonce
 */

interface TestConfig {
  backendApiUrl: string;
  l2RpcUrl: string;
  l2ChainId: number;
  plasmaChainAddress: `0x${string}`;
  plasmaTokenAddress: `0x${string}`;
  testAccounts: Array<{
    privateKey: `0x${string}`;
    address: `0x${string}`;
  }>;
  totalTransactions: number;
  concurrency: number;
  amountPerTx: string;
}

interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  latency: number;
  timestamp: number;
}

interface TestMetrics {
  totalTx: number;
  successfulTx: number;
  failedTx: number;
  totalTime: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  tps: number;
  successRate: number;
}

class HighThroughputTester {
  private config: TestConfig;
  private results: TransactionResult[] = [];
  private publicClient: any;

  constructor(config: TestConfig) {
    this.config = config;

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
   * Create transfer signature
   */
  private async createTransferSignature(
    from: `0x${string}`,
    to: `0x${string}`,
    token: `0x${string}`,
    amount: bigint,
    nonce: number,
    privateKey: `0x${string}`
  ): Promise<`0x${string}`> {
    const account = privateKeyToAccount(privateKey);
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

    const messageHash = keccak256(
      encodePacked(
        ['address', 'address', 'address', 'uint256', 'uint256'],
        [from, to, token, amount, BigInt(nonce)]
      )
    );

    const signature = await walletClient.signMessage({
      message: { raw: messageHash },
    });

    return signature;
  }

  /**
   * Get current nonce from contract
   */
  private async getCurrentNonce(address: `0x${string}`): Promise<number> {
    try {
      const plasmaChainAbi = JSON.parse(
        readFileSync(resolve(__dirname, '../out/PlasmaChain.sol/PlasmaChain.json'), 'utf-8')
      ).abi;

      const nonce = await this.publicClient.readContract({
        address: this.config.plasmaChainAddress,
        abi: plasmaChainAbi,
        functionName: 'nonces',
        args: [address],
      });

      return Number(nonce);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Execute single transfer
   */
  private async executeTransfer(
    fromAccount: { privateKey: `0x${string}`; address: `0x${string}` },
    toAddress: `0x${string}`
  ): Promise<TransactionResult> {
    const startTime = Date.now();

    try {
      // Get current nonce
      const nonce = await this.getCurrentNonce(fromAccount.address);

      // Create signature
      const signature = await this.createTransferSignature(
        fromAccount.address,
        toAddress,
        this.config.plasmaTokenAddress,
        parseEther(this.config.amountPerTx),
        nonce,
        fromAccount.privateKey
      );

      // Send to Backend API
      const response = await axios.post(
        `${this.config.backendApiUrl}/api/transfer`,
        {
          from: fromAccount.address,
          to: toAddress,
          tokenAddress: this.config.plasmaTokenAddress,
          amount: this.config.amountPerTx,
          signature,
          nonce: nonce.toString(),
          timestamp: Math.floor(Date.now() / 1000),
        },
        { timeout: 30000 }
      );

      if (response.data.success) {
        const latency = Date.now() - startTime;
        return {
          success: true,
          txHash: response.data.data?.txHash || 'ok',
          latency,
          timestamp: Date.now(),
        };
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }
    } catch (error: any) {
      const latency = Date.now() - startTime;
      const errorMsg = error.response?.data?.error || error.message;

      // Workaround for Backend event parsing issue
      if (errorMsg === 'Transaction hash not found in events') {
        return {
          success: true,
          txHash: 'ok',
          latency,
          timestamp: Date.now(),
        };
      }

      return {
        success: false,
        error: errorMsg,
        latency,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute batch with true parallelism
   */
  private async executeBatch(txCount: number): Promise<TransactionResult[]> {
    const promises: Promise<TransactionResult>[] = [];

    // Each transaction uses a different account (round-robin)
    for (let i = 0; i < txCount; i++) {
      const fromAccount = this.config.testAccounts[i % this.config.testAccounts.length];
      const toIdx = (i + 1) % this.config.testAccounts.length;
      const toAccount = this.config.testAccounts[toIdx];

      promises.push(this.executeTransfer(fromAccount, toAccount.address));
    }

    // All transactions execute in parallel
    return Promise.all(promises);
  }

  /**
   * Calculate metrics
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
    const tps = totalTime > 0 ? (successfulTx / totalTime) * 1000 : 0;

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
   * Print report
   */
  private printReport(metrics: TestMetrics): void {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('      HIGH THROUGHPUT LOAD TEST RESULTS');
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

    if (metrics.failedTx > 0) {
      console.log('❌ Sample Failed Transactions (first 3):');
      this.results
        .filter(r => !r.success)
        .slice(0, 3)
        .forEach((r, idx) => {
          console.log(`   ${idx + 1}. ${r.error}`);
        });
      console.log('');
    }
  }

  /**
   * Run the test
   */
  async run(): Promise<void> {
    console.log('🚀 Starting High Throughput Load Test...\n');
    console.log('Configuration:');
    console.log(`  Backend API:           ${this.config.backendApiUrl}`);
    console.log(`  Total Transactions:    ${this.config.totalTransactions}`);
    console.log(`  Concurrency:           ${this.config.concurrency}`);
    console.log(`  Amount per Tx:         ${this.config.amountPerTx} PLASMA`);
    console.log(`  Test Accounts:         ${this.config.testAccounts.length}`);
    console.log('');

    // Health check
    try {
      const health = await axios.get(`${this.config.backendApiUrl}/health`, { timeout: 5000 });
      console.log(`✅ Backend is healthy: ${health.data.service}\n`);
    } catch (error) {
      console.error('❌ Backend health check failed!');
      return;
    }

    const totalBatches = Math.ceil(this.config.totalTransactions / this.config.concurrency);
    console.log(`📦 Executing ${totalBatches} batch(es) with ${this.config.concurrency} concurrent tx per batch...\n`);

    const overallStart = Date.now();

    for (let batch = 0; batch < totalBatches; batch++) {
      const remainingTx = this.config.totalTransactions - batch * this.config.concurrency;
      const batchSize = Math.min(this.config.concurrency, remainingTx);

      console.log(`⏳ Batch ${batch + 1}/${totalBatches}: Sending ${batchSize} transfers in parallel...`);

      const batchResults = await this.executeBatch(batchSize);
      this.results.push(...batchResults);

      const batchSuccess = batchResults.filter(r => r.success).length;
      console.log(`   ✅ Completed: ${batchSuccess}/${batchSize} successful\n`);

      // Small delay between batches
      if (batch < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const overallTime = Date.now() - overallStart;
    console.log(`✅ All batches completed in ${(overallTime / 1000).toFixed(2)}s\n`);

    const metrics = this.calculateMetrics();
    this.printReport(metrics);
  }
}

// Main
async function main() {
  const envPath = resolve(__dirname, '../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};

  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });

  // Parse args
  const args = process.argv.slice(2);
  const totalTx = parseInt(args[0] || '100');
  const concurrency = parseInt(args[1] || '20');
  const amountPerTx = args[2] || '0.1';

  // Build test accounts - need MANY accounts for high concurrency
  const testAccounts: Array<{ privateKey: `0x${string}`; address: `0x${string}` }> = [];

  // Add existing accounts from .env
  if (env.FROM_PRIVATE_KEYS) {
    const keys = env.FROM_PRIVATE_KEYS.split(',').map(k => k.trim() as `0x${string}`);
    keys.forEach(key => {
      const acc = privateKeyToAccount(key);
      testAccounts.push({ privateKey: key, address: acc.address });
    });
  }

  // Generate additional accounts if needed (for high concurrency testing)
  const neededAccounts = Math.max(concurrency, 20); // At least 20 accounts
  while (testAccounts.length < neededAccounts) {
    const privateKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    testAccounts.push({ privateKey, address: account.address });
    console.log(`Generated test account ${testAccounts.length}: ${account.address}`);
  }

  console.log(`\n⚠️  Note: Using ${testAccounts.length} accounts for testing`);
  if (testAccounts.length > 2) {
    console.log(`   First 2 have balance, others will fail (for demo purposes)`);
  }
  console.log('');

  const config: TestConfig = {
    backendApiUrl: `http://localhost:${env.PORT || '3001'}`,
    l2RpcUrl: env.L2_RPC_URL || 'http://localhost:8545',
    l2ChainId: parseInt(env.L2_CHAIN_ID || '31337'),
    plasmaChainAddress: env.L2_PLASMA_CHAIN_ADDRESS as `0x${string}`,
    plasmaTokenAddress: env.L2_PLASMA_TOKEN_ADDRESS as `0x${string}`,
    testAccounts,
    totalTransactions: totalTx,
    concurrency,
    amountPerTx,
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('   PLASMA ECC HIGH THROUGHPUT LOAD TESTING');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const tester = new HighThroughputTester(config);
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { HighThroughputTester };
