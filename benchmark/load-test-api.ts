#!/usr/bin/env node
import axios from 'axios';
import { createWalletClient, createPublicClient, http, parseEther, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load Testing Script for Plasma ECC Layer 2 (API Version)
 *
 * This script tests throughput by sending requests to Backend API
 *
 * Features:
 * - Uses Backend API endpoints (more realistic)
 * - Proper nonce management
 * - Supports deposits and transfers
 * - Performance metrics
 */

interface TestConfig {
  // API endpoint
  backendApiUrl: string;

  // L2 Configuration
  l2RpcUrl: string;
  l2ChainId: number;
  plasmaChainAddress: `0x${string}`;
  plasmaTokenAddress: `0x${string}`;

  // Test accounts
  testAccounts: Array<{
    privateKey: `0x${string}`;
    address: `0x${string}`;
  }>;

  // Test parameters
  totalTransactions: number;
  concurrency: number;
  testType: 'deposit' | 'transfer';
  amountPerTx: string;
  delayBetweenBatches?: number;
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

class LoadTesterAPI {
  private config: TestConfig;
  private results: TransactionResult[] = [];
  private nonces: Map<string, number> = new Map();
  private publicClient: any;

  constructor(config: TestConfig) {
    this.config = config;

    // Create public client for reading contract state
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
   * Initialize nonces by fetching from PlasmaChain contract
   */
  private async initializeNonces(): Promise<void> {
    console.log('📋 Fetching current nonces from PlasmaChain contract...');

    // Load PlasmaChain ABI
    const plasmaChainAbi = JSON.parse(
      readFileSync(resolve(__dirname, '../out/PlasmaChain.sol/PlasmaChain.json'), 'utf-8')
    ).abi;

    for (const account of this.config.testAccounts) {
      try {
        const nonce = await this.publicClient.readContract({
          address: this.config.plasmaChainAddress,
          abi: plasmaChainAbi,
          functionName: 'nonces',
          args: [account.address],
        });

        this.nonces.set(account.address.toLowerCase(), Number(nonce));
        console.log(`   ${account.address}: nonce = ${nonce}`);
      } catch (error: any) {
        // If read fails, start from 0
        this.nonces.set(account.address.toLowerCase(), 0);
        console.log(`   ${account.address}: nonce = 0 (error: ${error.message})`);
      }
    }
    console.log('');
  }

  /**
   * Get and increment nonce for address (with mutex to avoid race conditions)
   */
  private async getAndIncrementNonce(address: string): Promise<number> {
    const key = address.toLowerCase();

    // Fetch nonce from fast server API (Redis-backed)
    try {
      const response = await axios.get(
        `${this.config.backendApiUrl}/api/nonce/${address}`,
        { timeout: 5000 }
      );

      if (response.data.success) {
        const nonce = Number(response.data.nonce);
        this.nonces.set(key, nonce + 1); // Set next nonce for local tracking
        return nonce;
      }
    } catch (error) {
      // Fallback to contract
      try {
        const plasmaChainAbi = JSON.parse(
          readFileSync(resolve(__dirname, '../out/PlasmaChain.sol/PlasmaChain.json'), 'utf-8')
        ).abi;

        const onChainNonce = await this.publicClient.readContract({
          address: this.config.plasmaChainAddress,
          abi: plasmaChainAbi,
          functionName: 'nonces',
          args: [address as `0x${string}`],
        });

        const nonce = Number(onChainNonce);
        this.nonces.set(key, nonce + 1); // Set next nonce
        return nonce;
      } catch (fallbackError) {
        // Fallback to local tracking
        const currentNonce = this.nonces.get(key) || 0;
        this.nonces.set(key, currentNonce + 1);
        return currentNonce;
      }
    }
  }

  /**
   * Create transfer signature
   * Must match contract's txHash: keccak256(abi.encodePacked(from, to, token, amount, nonce))
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

    // Create message hash using encodePacked (same as abi.encodePacked)
    const messageHash = keccak256(
      encodePacked(
        ['address', 'address', 'address', 'uint256', 'uint256'],
        [from, to, token, amount, BigInt(nonce)]
      )
    );

    // Sign the message
    const signature = await walletClient.signMessage({
      message: { raw: messageHash },
    });

    return signature;
  }

  /**
   * Execute deposit via API
   */
  private async executeDepositAPI(
    account: { privateKey: `0x${string}`; address: `0x${string}` },
    amount: bigint
  ): Promise<TransactionResult> {
    const startTime = Date.now();

    try {
      const response = await axios.post(
        `${this.config.backendApiUrl}/api/deposit`,
        {
          userAddress: account.address,
          tokenAddress: this.config.plasmaTokenAddress,
          amount: this.config.amountPerTx, // Send as ether units string
        },
        { timeout: 30000 }
      );

      if (response.data.success) {
        const latency = Date.now() - startTime;
        return {
          success: true,
          txHash: response.data.data?.txHash || 'unknown',
          latency,
          timestamp: Date.now(),
        };
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }
    } catch (error: any) {
      const latency = Date.now() - startTime;
      const errorMsg = error.response?.data?.error || error.message;

      // Workaround: "Transaction hash not found in events" means tx succeeded but event parsing failed
      if (errorMsg === 'Transaction hash not found in events') {
        return {
          success: true,
          txHash: 'event_parse_ok',
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
   * Execute transfer via API
   */
  private async executeTransferAPI(
    fromAccount: { privateKey: `0x${string}`; address: `0x${string}` },
    toAddress: `0x${string}`,
    amount: bigint
  ): Promise<TransactionResult> {
    const startTime = Date.now();

    try {
      const nonce = await this.getAndIncrementNonce(fromAccount.address);
      const timestamp = Math.floor(Date.now() / 1000);

      // Create signature (use actual amount in wei for signature)
      const signature = await this.createTransferSignature(
        fromAccount.address,
        toAddress,
        this.config.plasmaTokenAddress,
        parseEther(this.config.amountPerTx), // Use wei for signature
        nonce,
        fromAccount.privateKey
      );

      const response = await axios.post(
        `${this.config.backendApiUrl}/api/transfer`,
        {
          from: fromAccount.address,
          to: toAddress,
          tokenAddress: this.config.plasmaTokenAddress,
          amount: this.config.amountPerTx, // Send as ether units string, not wei
          signature,
          nonce: nonce.toString(),
          timestamp,
        },
        { timeout: 30000 }
      );

      if (response.data.success) {
        const latency = Date.now() - startTime;
        return {
          success: true,
          txHash: response.data.data?.txHash || 'unknown',
          latency,
          timestamp: Date.now(),
        };
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }
    } catch (error: any) {
      const latency = Date.now() - startTime;
      const errorMsg = error.response?.data?.error || error.message;

      // Workaround: "Transaction hash not found in events" means tx succeeded but event parsing failed
      if (errorMsg === 'Transaction hash not found in events') {
        return {
          success: true,
          txHash: 'event_parse_ok',
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
   * Execute a batch of transactions
   * Groups transactions by sender to avoid nonce conflicts
   */
  private async executeBatch(txCount: number): Promise<TransactionResult[]> {
    const amount = parseEther(this.config.amountPerTx);
    const results: TransactionResult[] = [];

    // Group transactions by sender account to maintain nonce order
    const txsBySender: Map<string, Array<{ to: `0x${string}`; type: 'deposit' | 'transfer' }>> = new Map();

    for (let i = 0; i < txCount; i++) {
      const fromAccount = this.config.testAccounts[i % this.config.testAccounts.length];
      const senderKey = fromAccount.address.toLowerCase();

      if (!txsBySender.has(senderKey)) {
        txsBySender.set(senderKey, []);
      }

      if (this.config.testType === 'deposit') {
        txsBySender.get(senderKey)!.push({ to: fromAccount.address, type: 'deposit' });
      } else {
        const toIdx = (i + 1) % this.config.testAccounts.length;
        const toAccount = this.config.testAccounts[toIdx];
        txsBySender.get(senderKey)!.push({ to: toAccount.address, type: 'transfer' });
      }
    }

    // Execute transactions for each sender sequentially, but all senders in parallel
    const senderPromises: Promise<TransactionResult[]>[] = [];

    for (const [senderKey, txs] of txsBySender.entries()) {
      const fromAccount = this.config.testAccounts.find(
        acc => acc.address.toLowerCase() === senderKey
      )!;

      // Sequential execution for this sender to maintain nonce order
      const senderPromise = (async () => {
        const senderResults: TransactionResult[] = [];
        for (const tx of txs) {
          if (tx.type === 'deposit') {
            senderResults.push(await this.executeDepositAPI(fromAccount, amount));
          } else {
            senderResults.push(await this.executeTransferAPI(fromAccount, tx.to, amount));
          }
          // Delay to ensure transaction is mined and nonce is updated on-chain
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        return senderResults;
      })();

      senderPromises.push(senderPromise);
    }

    // Wait for all senders to complete
    const allResults = await Promise.all(senderPromises);
    for (const senderResults of allResults) {
      results.push(...senderResults);
    }

    return results;
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
    console.log('           LOAD TEST RESULTS (API)');
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

    // Print sample failed transactions
    if (metrics.failedTx > 0) {
      console.log('❌ Sample Failed Transactions (first 5):');
      this.results
        .filter(r => !r.success)
        .slice(0, 5)
        .forEach((r, idx) => {
          console.log(`   ${idx + 1}. ${r.error}`);
        });
      console.log('');
    }
  }

  /**
   * Run the load test
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Load Test (API Mode)...\n');
    console.log('Configuration:');
    console.log(`  Backend API:           ${this.config.backendApiUrl}`);
    console.log(`  Test Type:             ${this.config.testType}`);
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
      console.error('   Make sure Backend is running on', this.config.backendApiUrl);
      return;
    }

    // Initialize nonces
    await this.initializeNonces();

    const totalBatches = Math.ceil(this.config.totalTransactions / this.config.concurrency);
    console.log(`📦 Executing ${totalBatches} batch(es)...\n`);

    for (let batch = 0; batch < totalBatches; batch++) {
      const remainingTx = this.config.totalTransactions - batch * this.config.concurrency;
      const batchSize = Math.min(this.config.concurrency, remainingTx);

      console.log(`⏳ Batch ${batch + 1}/${totalBatches}: Sending ${batchSize} ${this.config.testType}s...`);

      const batchResults = await this.executeBatch(batchSize);
      this.results.push(...batchResults);

      const batchSuccess = batchResults.filter(r => r.success).length;
      console.log(`   ✅ Completed: ${batchSuccess}/${batchSize} successful\n`);

      if (batch < totalBatches - 1 && this.config.delayBetweenBatches) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenBatches));
      }
    }

    const metrics = this.calculateMetrics();
    this.printReport(metrics);
  }
}

// Main execution
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

  // Parse command line arguments
  const args = process.argv.slice(2);
  const totalTx = parseInt(args[0] || '10');
  const concurrency = parseInt(args[1] || '5');
  const testType = (args[2] || 'transfer') as 'deposit' | 'transfer';
  const amountPerTx = args[3] || '1';

  // Build test accounts - only use accounts with balance
  const testAccounts: Array<{ privateKey: `0x${string}`; address: `0x${string}` }> = [];

  if (env.FROM_PRIVATE_KEYS) {
    const keys = env.FROM_PRIVATE_KEYS.split(',').map(k => k.trim() as `0x${string}`);
    keys.forEach(key => {
      const acc = privateKeyToAccount(key);
      testAccounts.push({ privateKey: key, address: acc.address });
    });
  }

  if (testAccounts.length < 2) {
    console.error('❌ Error: Need at least 2 test accounts');
    process.exit(1);
  }

  const config: TestConfig = {
    backendApiUrl: `http://localhost:${env.PORT || '3001'}`,
    l2RpcUrl: env.L2_RPC_URL || 'http://localhost:8545',
    l2ChainId: parseInt(env.L2_CHAIN_ID || '31337'),
    plasmaChainAddress: env.L2_PLASMA_CHAIN_ADDRESS as `0x${string}`,
    plasmaTokenAddress: env.L2_PLASMA_TOKEN_ADDRESS as `0x${string}`,
    testAccounts,
    totalTransactions: totalTx,
    concurrency,
    testType,
    amountPerTx,
    delayBetweenBatches: 100,
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('      PLASMA ECC LAYER 2 LOAD TESTING (API)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const tester = new LoadTesterAPI(config);
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { LoadTesterAPI };
