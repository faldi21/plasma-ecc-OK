/**
 * Week 2: Load Testing
 * Test network behavior under higher load with multiple concurrent accounts
 *
 * Test Flow:
 * 1. Create N test accounts
 * 2. Fund each account with initial balance
 * 3. Execute M concurrent transfers from each account
 * 4. Measure TPS, latency under load, failure rates
 * 5. Identify bottlenecks and limits
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import DataCollector from './data-collector.ts';
import {
  calculatePerformanceMetrics,
  measureTime,
  getTimestamp,
  sleep,
  getDateString,
  printBenchmarkSummary,
} from './utils.ts';
import type { TransactionBenchmark, BenchmarkReport, PerformanceMetrics } from './types.ts';

interface LoadTestConfig {
  l2RpcUrl: string;
  l1RpcUrl: string;
  senderPrivateKey: `0x${string}`;
  accountCount: number;
  transactionsPerAccount: number;
  amountPerTransfer: bigint;
  concurrency: number; // How many transfers run in parallel
}

interface LoadTestResult {
  totalAccounts: number;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalDuration: number;
  peakTPS: number;
  averageTPS: number;
  minLatency: number;
  maxLatency: number;
  averageLatency: number;
  totalGasUsed: bigint;
  averageGasPerTx: bigint;
  errors: Array<{
    accountIndex: number;
    txIndex: number;
    error: string;
  }>;
}

/**
 * Load configuration from .env
 */
function loadConfig(): LoadTestConfig {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const l1RpcUrl = process.env.L1_RPC_URL || 'https://sepolia.infura.io/v3/8d3bb3446dad413c87e02f1dc98a17b5';
  const senderPrivateKey = process.env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`;
  const accountCount = parseInt(process.env.TEST_LOAD_ACCOUNTS || '5');
  const transactionsPerAccount = parseInt(process.env.TEST_LOAD_TX_PER_ACCOUNT || '10');
  const amountPerTransfer = BigInt(process.env.TEST_TRANSFER_AMOUNT || '1'); // 1 wei default (minimize gas cost impact)
  const concurrency = parseInt(process.env.TEST_CONCURRENCY || '3');

  if (!senderPrivateKey) {
    throw new Error('Missing required env var: L2_OPERATOR_PRIVATE_KEY');
  }

  return {
    l2RpcUrl,
    l1RpcUrl,
    senderPrivateKey,
    accountCount,
    transactionsPerAccount,
    amountPerTransfer,
    concurrency,
  };
}

/**
 * Create test accounts
 */
function createTestAccounts(count: number): Array<{ privateKey: `0x${string}`; address: string }> {
  const accounts = [];
  for (let i = 0; i < count; i++) {
    const privateKey = generatePrivateKey() as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    accounts.push({
      privateKey,
      address: account.address,
    });
  }
  return accounts;
}

/**
 * Fund test accounts from sender
 */
async function fundAccounts(
  config: LoadTestConfig,
  accounts: Array<{ privateKey: `0x${string}`; address: string }>,
  fundAmount: bigint
): Promise<{ successCount: number; failureCount: number; totalTime: number }> {
  const sender = privateKeyToAccount(config.senderPrivateKey);

  const walletClient = createWalletClient({
    account: sender,
    transport: http(config.l2RpcUrl),
  });

  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  // Use walletClient for signing, not publicClient
  const signingClient = walletClient;

  console.log(`\n🔄 Funding ${accounts.length} test accounts...`);
  console.log(`   Amount per account: ${fundAmount} wei`);
  console.log(`   Sender: ${sender.address}\n`);

  // Check sender balance first
  try {
    const senderBalance = await publicClient.getBalance({ account: sender.address });
    const totalNeeded = fundAmount * BigInt(accounts.length);
    console.log(`   Sender balance: ${senderBalance.toString()} wei`);
    console.log(`   Total needed: ${totalNeeded.toString()} wei`);

    if (senderBalance < totalNeeded) {
      console.warn(`   ⚠️  WARNING: Insufficient sender balance! (has ${senderBalance.toString()}, needs ${totalNeeded.toString()})\n`);
    }
  } catch (err) {
    console.warn(`   ⚠️  Could not check sender balance\n`);
  }

  let successCount = 0;
  let failureCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < accounts.length; i++) {
    try {
      // Ensure address is properly formatted
      const toAddress = accounts[i].address;
      if (!toAddress.startsWith('0x') || toAddress.length !== 42) {
        throw new Error(`Invalid address format: ${toAddress}`);
      }

      const hash = await walletClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: fundAmount,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Verify funding worked by checking the account balance
      const balance = await publicClient.getBalance({ account: accounts[i].address });
      if (balance >= fundAmount) {
        successCount++;
        if ((i + 1) % 5 === 0 || i === accounts.length - 1) {
          console.log(`   ✓ Funded ${i + 1}/${accounts.length} accounts (balance: ${balance.toString()})`);
        }
      } else {
        throw new Error(`Balance ${balance.toString()} < funded amount ${fundAmount.toString()}`);
      }
    } catch (error) {
      failureCount++;
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.error(`   ✗ Failed to fund account ${i}: ${errorMsg}`);
    }
  }

  const totalTime = Date.now() - startTime;

  console.log(`\n✅ Funding complete: ${successCount} success, ${failureCount} failed in ${totalTime}ms`);

  if (failureCount > 0) {
    console.log(`⚠️  WARNING: Not all accounts were funded! Only ${successCount}/${accounts.length} accounts have funds.\n`);
  }

  return { successCount, failureCount, totalTime };
}

/**
 * Execute transfers from an account
 */
async function executeAccountTransfers(
  config: LoadTestConfig,
  account: { privateKey: `0x${string}`; address: string },
  accountIndex: number,
  recipientAddress: string
): Promise<{
  benchmarks: TransactionBenchmark[];
  errors: Array<{ txIndex: number; error: string }>;
}> {
  const sender = privateKeyToAccount(account.privateKey);
  const publicClient = createPublicClient({
    transport: http(config.l2RpcUrl),
  });

  // Check account balance before executing
  if (accountIndex === 0) {
    try {
      const balance = await publicClient.getBalance({ account: sender.address });
      console.log(`\n   DEBUG: Account 0 balance before transfers: ${balance.toString()} wei`);
    } catch (err) {
      console.log(`   DEBUG: Could not check account balance`);
    }
  }

  const walletClient = createWalletClient({
    account: sender,
    transport: http(config.l2RpcUrl),
  });

  const benchmarks: TransactionBenchmark[] = [];
  const errors: Array<{ txIndex: number; error: string }> = [];

  for (let i = 0; i < config.transactionsPerAccount; i++) {
    try {
      const startTime = Date.now();

      const hash = await walletClient.sendTransaction({
        to: recipientAddress as `0x${string}`,
        value: config.amountPerTransfer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const latency = Date.now() - startTime;

      benchmarks.push({
        timestamp: getTimestamp(),
        environment: 'anvil' as const,
        txIndex: i,
        txHash: hash,
        txType: 'transfer' as const,
        gasUsed: receipt.gasUsed,
        gasPrice: receipt.effectiveGasPrice || 0n,
        executionTime: latency,
        blockNumber: receipt.blockNumber,
        from: sender.address,
        to: recipientAddress,
        value: config.amountPerTransfer,
        status: receipt.status === 'success' ? 'success' : 'failed',
      });
    } catch (error) {
      errors.push({
        txIndex: i,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { benchmarks, errors };
}

/**
 * Run load test with concurrent transfers
 */
async function runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    WEEK 2: LOAD TESTING - PHASE START              ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('🔍 Configuration:');
  console.log(`   L2 RPC: ${config.l2RpcUrl}`);
  console.log(`   Test Accounts: ${config.accountCount}`);
  console.log(`   TX per Account: ${config.transactionsPerAccount}`);
  console.log(`   Concurrency: ${config.concurrency}`);
  console.log(`   Total TX Expected: ${config.accountCount * config.transactionsPerAccount}\n`);

  // Create test accounts
  const testAccounts = createTestAccounts(config.accountCount);

  // Fund accounts with enough for gas + value
  // Estimate: 21000 gas * transferCount * gas price, plus transfer value
  // On Anvil, use generous amount to ensure enough for all transfers
  const fundAmount = BigInt(1000000000); // 1 billion wei (~1 ETH) per account
  const fundResult = await fundAccounts(config, testAccounts, fundAmount);

  // Use operator as fixed recipient for all transfers
  const sender = privateKeyToAccount(config.senderPrivateKey);
  const recipientAddresses = testAccounts.map(() => sender.address);

  // Execute transfers with concurrency control
  console.log(`\n🚀 Executing ${config.accountCount * config.transactionsPerAccount} transfers with concurrency=${config.concurrency}...\n`);

  const overallStartTime = Date.now();
  let allBenchmarks: TransactionBenchmark[] = [];
  let allErrors: Array<{ accountIndex: number; txIndex: number; error: string }> = [];
  let successCount = 0;
  let failureCount = 0;

  // Process accounts in batches respecting concurrency
  for (let accountBatch = 0; accountBatch < config.accountCount; accountBatch += config.concurrency) {
    const batchAccounts = testAccounts.slice(accountBatch, Math.min(accountBatch + config.concurrency, config.accountCount));

    const batchPromises = batchAccounts.map((account, batchIndex) =>
      executeAccountTransfers(
        config,
        account,
        accountBatch + batchIndex,
        recipientAddresses[accountBatch + batchIndex]
      )
    );

    const batchResults = await Promise.all(batchPromises);

    for (let i = 0; i < batchResults.length; i++) {
      const { benchmarks, errors } = batchResults[i];
      allBenchmarks = allBenchmarks.concat(benchmarks);
      successCount += benchmarks.length;

      if (errors.length > 0) {
        allErrors = allErrors.concat(
          errors.map((e) => ({
            accountIndex: accountBatch + i,
            txIndex: e.txIndex,
            error: e.error,
          }))
        );
        failureCount += errors.length;
      }
    }

    console.log(`   ✓ Batch ${Math.ceil((accountBatch + config.concurrency) / config.concurrency)}/${Math.ceil(config.accountCount / config.concurrency)} complete (${successCount + failureCount}/${config.accountCount * config.transactionsPerAccount} transfers)`);
  }

  const totalDuration = Date.now() - overallStartTime;

  // Calculate metrics
  const executionTimes = allBenchmarks.map((b) => b.executionTime);
  const minLatency = Math.min(...executionTimes);
  const maxLatency = Math.max(...executionTimes);
  const averageLatency = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;

  const totalGasUsed = allBenchmarks.reduce((sum, b) => sum + b.gasUsed, 0n);
  const averageGasPerTx = successCount > 0 ? totalGasUsed / BigInt(successCount) : 0n;

  const totalTPS = successCount / (totalDuration / 1000);
  const peakTPS = 1000 / minLatency; // Best case TPS based on fastest TX

  return {
    totalAccounts: config.accountCount,
    totalTransactions: config.accountCount * config.transactionsPerAccount,
    successfulTransactions: successCount,
    failedTransactions: failureCount,
    totalDuration,
    peakTPS,
    averageTPS: totalTPS,
    minLatency,
    maxLatency,
    averageLatency,
    totalGasUsed,
    averageGasPerTx,
    errors: allErrors,
  };
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const result = await runLoadTest(config);

    // Save results
    const collector = new DataCollector();

    // Convert to JSON-serializable format
    const reportResult: LoadTestResult = {
      ...result,
      totalGasUsed: result.totalGasUsed,
      averageGasPerTx: result.averageGasPerTx,
    };

    const reportPath = collector.saveLoadTestResult(reportResult);

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║              📊 LOAD TEST SUMMARY                 ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('📈 Load Test Results:');
    console.log(`   Total Accounts: ${result.totalAccounts}`);
    console.log(`   Total Transactions: ${result.totalTransactions}`);
    console.log(`   Successful: ${result.successfulTransactions}`);
    console.log(`   Failed: ${result.failedTransactions}`);
    console.log(`   Success Rate: ${((result.successfulTransactions / result.totalTransactions) * 100).toFixed(2)}%\n`);

    console.log('⏱️  Performance:');
    console.log(`   Total Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Average TPS: ${result.averageTPS.toFixed(2)}`);
    console.log(`   Peak TPS: ${result.peakTPS.toFixed(2)}`);
    console.log(`   Min Latency: ${result.minLatency.toFixed(2)}ms`);
    console.log(`   Avg Latency: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`   Max Latency: ${result.maxLatency.toFixed(2)}ms\n`);

    console.log('⛽ Gas:');
    console.log(`   Total Gas: ${result.totalGasUsed.toString()}`);
    console.log(`   Avg per TX: ${result.averageGasPerTx.toString()}\n`);

    if (result.errors.length > 0) {
      console.log('⚠️  Errors:');
      result.errors.slice(0, 10).forEach((err) => {
        const errorMsg = err.error.split('\n')[0]; // First line of error
        console.log(`   Account ${err.accountIndex}, TX ${err.txIndex}: ${errorMsg}`);
      });
      if (result.errors.length > 10) {
        console.log(`   ... and ${result.errors.length - 10} more errors`);
      }
      console.log();
    }

    console.log(`📁 Report saved: ${reportPath}\n`);
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

main();
