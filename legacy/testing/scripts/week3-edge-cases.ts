/**
 * Week 3: Edge Cases & Error Scenario Testing
 * Test various failure conditions and error handling
 *
 * Scenarios:
 * 1. Insufficient balance in sender account
 * 2. Invalid recipient addresses
 * 3. Very large transaction values
 * 4. Rapid nonce increments
 * 5. Transaction reverts
 * 6. State inconsistency
 * 7. Double-spend attempts
 * 8. Duplicate transactions
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { getTimestamp, getDateString } from './utils.ts';

// Load .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

interface EdgeCaseTest {
  name: string;
  description: string;
  expectedResult: 'success' | 'failure';
}

interface EdgeCaseResult {
  testName: string;
  description: string;
  expectedResult: string;
  actualResult: string;
  passed: boolean;
  error?: string;
  timestamp: string;
}

const EDGE_CASES: EdgeCaseTest[] = [
  {
    name: 'insufficient-balance',
    description: 'Attempt transfer with insufficient balance',
    expectedResult: 'failure',
  },
  {
    name: 'invalid-address',
    description: 'Transfer to invalid address format',
    expectedResult: 'failure',
  },
  {
    name: 'large-value',
    description: 'Transfer extremely large value',
    expectedResult: 'failure',
  },
  {
    name: 'rapid-nonce',
    description: 'Rapid nonce increments in quick succession',
    expectedResult: 'success',
  },
  {
    name: 'zero-value',
    description: 'Transfer zero amount',
    expectedResult: 'success',
  },
  {
    name: 'same-sender-receiver',
    description: 'Transfer from address to itself',
    expectedResult: 'success',
  },
];

interface Config {
  l2RpcUrl: string;
  senderPrivateKey: string;
  receiverAddress: string;
}

function loadConfig(): Config {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const senderPrivateKey = process.env.PRIVATE_KEY_L2 || process.env.SENDER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02b3865fb97a73d';
  const receiverAddress = process.env.RECEIVER_ADDRESS || '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';

  return {
    l2RpcUrl,
    senderPrivateKey: senderPrivateKey.startsWith('0x') ? senderPrivateKey : `0x${senderPrivateKey}`,
    receiverAddress: receiverAddress.startsWith('0x') ? (receiverAddress as `0x${string}`) : (`0x${receiverAddress}` as `0x${string}`),
  };
}

async function testInsufficientBalance(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    // Try to send amount larger than balance (realistic account with limited funds)
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);
    const balance = await publicClient.getBalance({ address: account.address });

    // Attempt to send 10x the balance
    const excessiveAmount = balance * BigInt(10);

    await walletClient.sendTransaction({
      to: config.receiverAddress,
      value: excessiveAmount,
      account,
    });

    return {
      testName: 'insufficient-balance',
      description: 'Attempt transfer with insufficient balance',
      expectedResult: 'failure',
      actualResult: 'success',
      passed: false, // Expected failure but succeeded
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'insufficient-balance',
      description: 'Attempt transfer with insufficient balance',
      expectedResult: 'failure',
      actualResult: 'failure',
      passed: true, // Failed as expected
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function testInvalidAddress(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);

    // Try invalid address format
    await walletClient.sendTransaction({
      to: '0xinvalid' as `0x${string}`,
      value: BigInt(100),
      account,
    });

    return {
      testName: 'invalid-address',
      description: 'Transfer to invalid address format',
      expectedResult: 'failure',
      actualResult: 'success',
      passed: false,
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'invalid-address',
      description: 'Transfer to invalid address format',
      expectedResult: 'failure',
      actualResult: 'failure',
      passed: true,
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function testLargeValue(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);

    // Try to send max uint256
    const maxUint256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

    await walletClient.sendTransaction({
      to: config.receiverAddress,
      value: maxUint256,
      account,
    });

    return {
      testName: 'large-value',
      description: 'Transfer extremely large value',
      expectedResult: 'failure',
      actualResult: 'success',
      passed: false,
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'large-value',
      description: 'Transfer extremely large value',
      expectedResult: 'failure',
      actualResult: 'failure',
      passed: true,
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function testRapidNonce(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);

    // Send 5 transactions in rapid succession
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        walletClient.sendTransaction({
          to: config.receiverAddress,
          value: BigInt(10),
          account,
        })
      );
    }

    await Promise.all(promises);

    return {
      testName: 'rapid-nonce',
      description: 'Rapid nonce increments in quick succession',
      expectedResult: 'success',
      actualResult: 'success',
      passed: true,
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'rapid-nonce',
      description: 'Rapid nonce increments in quick succession',
      expectedResult: 'success',
      actualResult: 'failure',
      passed: false,
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function testZeroValue(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);

    const hash = await walletClient.sendTransaction({
      to: config.receiverAddress,
      value: BigInt(0),
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return {
      testName: 'zero-value',
      description: 'Transfer zero amount',
      expectedResult: 'success',
      actualResult: 'success',
      passed: true,
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'zero-value',
      description: 'Transfer zero amount',
      expectedResult: 'success',
      actualResult: 'failure',
      passed: false,
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function testSelfTransfer(
  config: Config,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<EdgeCaseResult> {
  try {
    const account = privateKeyToAccount(config.senderPrivateKey as `0x${string}`);

    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: BigInt(100),
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return {
      testName: 'same-sender-receiver',
      description: 'Transfer from address to itself',
      expectedResult: 'success',
      actualResult: 'success',
      passed: true,
      timestamp: getTimestamp(),
    };
  } catch (error) {
    return {
      testName: 'same-sender-receiver',
      description: 'Transfer from address to itself',
      expectedResult: 'success',
      actualResult: 'failure',
      passed: false,
      error: error instanceof Error ? error.message.substring(0, 100) : String(error),
      timestamp: getTimestamp(),
    };
  }
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    const publicClient = createPublicClient({ transport: http(config.l2RpcUrl) });
    const walletClient = createWalletClient({ transport: http(config.l2RpcUrl) });

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║       WEEK 3: EDGE CASES & ERROR TESTING           ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('🔍 Configuration:');
    console.log(`   L2 RPC: ${config.l2RpcUrl}`);
    console.log(`   Sender: ${privateKeyToAccount(config.senderPrivateKey as `0x${string}`).address}\n`);

    const results: EdgeCaseResult[] = [];

    console.log('🧪 Running edge case tests...\n');

    // Run all tests
    console.log('Test 1: Insufficient Balance');
    results.push(await testInsufficientBalance(config, publicClient, walletClient));

    console.log('Test 2: Invalid Address');
    results.push(await testInvalidAddress(config, publicClient, walletClient));

    console.log('Test 3: Large Value');
    results.push(await testLargeValue(config, publicClient, walletClient));

    console.log('Test 4: Rapid Nonce');
    results.push(await testRapidNonce(config, publicClient, walletClient));

    console.log('Test 5: Zero Value');
    results.push(await testZeroValue(config, publicClient, walletClient));

    console.log('Test 6: Self Transfer');
    results.push(await testSelfTransfer(config, publicClient, walletClient));

    // Save results
    const timestamp = getDateString();
    const resultsPath = resolve(process.cwd(), 'data', 'research', 'benchmarks', `edge-cases-${timestamp}.json`);
    mkdirSync(resolve(process.cwd(), 'data', 'research', 'benchmarks'), { recursive: true });

    writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          timestamp: getTimestamp(),
          totalTests: results.length,
          passedTests: results.filter((r) => r.passed).length,
          failedTests: results.filter((r) => !r.passed).length,
          results,
        },
        null,
        2
      )
    );

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║              📊 EDGE CASE SUMMARY                 ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const passedCount = results.filter((r) => r.passed).length;
    console.log(`✅ Passed: ${passedCount}/${results.length}`);
    console.log(`❌ Failed: ${results.length - passedCount}/${results.length}\n`);

    for (const result of results) {
      const status = result.passed ? '✓' : '✗';
      console.log(`${status} ${result.testName}: ${result.actualResult}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }

    console.log(`\n📁 Results saved: ${resultsPath}\n`);
  } catch (error) {
    console.error('❌ Edge case testing failed:', error);
    process.exit(1);
  }
}

main();
