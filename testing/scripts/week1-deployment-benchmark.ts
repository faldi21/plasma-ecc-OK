/**
 * Week 1: Deployment Benchmarking
 * Measure gas costs and execution time for contract deployments
 *
 * Deployment Flow:
 * 1. Deploy RootChainUTXO to L1 (Sepolia)
 * 2. Deploy PlasmaChainUTXO to L2 (Anvil)
 * 3. Record gas usage and execution time
 * 4. Save benchmark data
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getContractAbi } from '../abi-loader.ts';
import DataCollector from './data-collector.ts';
import { measureTime, getTimestamp, sleep, printBenchmarkSummary } from './utils.ts';
import type { DeploymentBenchmark, TransactionBenchmark } from './types.ts';

/**
 * Configuration from .env
 */
function loadConfig() {
  const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
  const operatorPrivateKey = process.env.L2_OPERATOR_PRIVATE_KEY as `0x${string}`;

  if (!sepoliaRpcUrl || !deployerPrivateKey || !operatorPrivateKey) {
    throw new Error('Missing required environment variables: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, L2_OPERATOR_PRIVATE_KEY');
  }

  return {
    sepoliaRpcUrl,
    l2RpcUrl,
    deployerPrivateKey,
    operatorPrivateKey,
  };
}

/**
 * Deploy contract and measure gas
 */
async function deployContract(
  rpcUrl: string,
  privateKey: `0x${string}`,
  contractName: string,
  chainId: 'l1' | 'l2'
): Promise<TransactionBenchmark & { contractAddress?: string }> {
  const account = privateKeyToAccount(privateKey);

  // Create wallet and public clients
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  console.log(`\n📝 Deploying ${contractName} to ${chainId.toUpperCase()}...`);
  console.log(`   Account: ${account.address}`);

  try {
    // Get contract ABI and bytecode
    // For this benchmark, we'll use mock bytecode
    // In production, load actual contract bytecode
    const bytecode = await getContractBytecode(contractName);

    const startTime = Date.now();

    // Deploy contract
    const hash = await walletClient.deployContract({
      account,
      abi: [],
      bytecode: bytecode as `0x${string}`,
      args: [],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const executionTime = Date.now() - startTime;

    console.log(`✅ ${contractName} deployed!`);
    console.log(`   Hash: ${hash}`);
    console.log(`   Address: ${receipt.contractAddress}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Execution Time: ${executionTime}ms`);

    return {
      timestamp: getTimestamp(),
      txHash: hash,
      txType: 'deposit' as const, // placeholder
      gasUsed: receipt.gasUsed,
      gasPrice: receipt.effectiveGasPrice,
      gasCost: receipt.gasUsed * receipt.effectiveGasPrice,
      submissionTime: 0,
      blockTime: 0,
      latency: executionTime,
      inputSize: bytecode.length / 2, // hex string, so divide by 2
      outputSize: 0,
      stateRootBefore: '',
      stateRootAfter: '',
      success: true,
      environment: 'anvil' as const,
      contractAddress: receipt.contractAddress,
    };
  } catch (error: any) {
    console.error(`❌ Deployment failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get contract bytecode (placeholder - will load actual bytecode)
 */
async function getContractBytecode(contractName: string): Promise<string> {
  // In production, load actual compiled bytecode from artifacts
  // For now, return placeholder
  const bytecodes: Record<string, string> = {
    RootChainUTXO: '0x60806040',
    PlasmaChainUTXO: '0x60806040',
  };
  return bytecodes[contractName] || '0x60806040';
}

/**
 * Main benchmark function
 */
async function runDeploymentBenchmark(): Promise<void> {
  const config = loadConfig();
  const collector = new DataCollector();

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    WEEK 1: DEPLOYMENT BENCHMARKING - PHASE START  ║');
  console.log('╚════════════════════════════════════════════════════╝');

  console.log('\n🔍 Configuration:');
  console.log(`   L1 RPC: ${config.sepoliaRpcUrl.slice(0, 50)}...`);
  console.log(`   L2 RPC: ${config.l2RpcUrl}`);

  try {
    // Deploy L1 contract (RootChainUTXO)
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('PHASE 1: L1 DEPLOYMENT (Sepolia)');
    console.log('═══════════════════════════════════════════════════════');

    const l1Result = await measureTime(async () => {
      return deployContract(config.sepoliaRpcUrl, config.deployerPrivateKey, 'RootChainUTXO', 'l1');
    });

    // Deploy L2 contract (PlasmaChainUTXO)
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('PHASE 2: L2 DEPLOYMENT (Anvil)');
    console.log('═══════════════════════════════════════════════════════');

    const l2Result = await measureTime(async () => {
      return deployContract(config.l2RpcUrl, config.operatorPrivateKey, 'PlasmaChainUTXO', 'l2');
    });

    // Create benchmark report
    const benchmark: DeploymentBenchmark = {
      timestamp: getTimestamp(),
      environment: 'anvil' as const,
      l1Deployment: {
        contractName: 'RootChainUTXO',
        gasUsed: l1Result.result.gasUsed,
        txHash: l1Result.result.txHash,
        blockNumber: 0, // Will get from actual deployment
        contractAddress: l1Result.result.contractAddress || '',
        executionTime: l1Result.time,
      },
      l2Deployment: {
        contractName: 'PlasmaChainUTXO',
        gasUsed: l2Result.result.gasUsed,
        txHash: l2Result.result.txHash,
        blockNumber: 0, // Will get from actual deployment
        contractAddress: l2Result.result.contractAddress || '',
        executionTime: l2Result.time,
      },
    };

    // Save benchmark
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('RESULTS & STORAGE');
    console.log('═══════════════════════════════════════════════════════');

    collector.saveDeploymentBenchmark(benchmark);

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║              📊 DEPLOYMENT SUMMARY               ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('✅ L1 Deployment (RootChainUTXO):');
    console.log(`   Gas Used: ${(l1Result.result.gasUsed / 1000n).toString()}K`);
    console.log(`   Execution Time: ${l1Result.time}ms`);
    console.log(`   Contract: ${l1Result.result.contractAddress}\n`);

    console.log('✅ L2 Deployment (PlasmaChainUTXO):');
    console.log(`   Gas Used: ${(l2Result.result.gasUsed / 1000n).toString()}K`);
    console.log(`   Execution Time: ${l2Result.time}ms`);
    console.log(`   Contract: ${l2Result.result.contractAddress}\n`);

    console.log('📁 Data saved to:');
    console.log(`   ${collector.getDataDir()}/benchmarks/deployment-*.json\n`);

    console.log('✨ Week 1, Phase 1 Complete!\n');
  } catch (error: any) {
    console.error('\n❌ Benchmark failed:', error.message);
    process.exit(1);
  }
}

// Run benchmark
runDeploymentBenchmark().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
