import { createPublicClient, createWalletClient, http, getAccount } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RootChainData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/abi/RootChain.json'), 'utf-8')
);
const RootChainABI = RootChainData.abi || RootChainData;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.L1_RPC),
});

const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.L1_RPC),
});

const operatorAccount = getAccount(process.env.OPERATOR_PRIVATE_KEY!);

async function checkLastBlock() {
  console.log('=== Checking Last Block Submission ===\n');

  const currentBlock = (await publicClient.readContract({
    address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
    abi: RootChainABI,
    functionName: 'currentPlasmaBlock',
  })) as bigint;

  console.log(`Current block number: ${currentBlock}\n`);

  // Get last block data
  if (currentBlock > 0n) {
    const blockNum = currentBlock;
    const block = (await publicClient.readContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'plasmaBlocks',
      args: [blockNum],
    })) as any;

    console.log(`Block ${blockNum}:`);
    console.log(`  blockNumber: ${block.blockNumber}`);
    console.log(`  accumulatorValue.x: ${block.accumulatorValue.x}`);
    console.log(`  accumulatorValue.y: ${block.accumulatorValue.y}`);
    console.log(`  timestamp: ${block.timestamp}`);
    console.log(`  operator: ${block.operator}`);
    console.log(`  transactionCount: ${block.transactionCount}\n`);

    // Try to get accumulator value from contract (if public getter exists)
    try {
      const result = (await publicClient.call({
        account: operatorAccount.address,
        to: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
        data: '0x4aa4a4fb', // selector for accumulator() if it's public
      })) as any;
      
      if (result.data && result.data !== '0x') {
        console.log(`\nAccumulator getter result: ${result.data}`);
      } else {
        console.log('\n⚠️  Accumulator is private, cannot read directly');
      }
    } catch (e) {
      console.log('\n⚠️  Cannot read accumulator (private)');
    }
  }

  console.log('\n=== Test submitBlock with dummy data ===\n');

  // Try to submit a test block with dummy accumulator
  const dummyAccumulator = [
    BigInt('0x1111111111111111111111111111111111111111111111111111111111111111'),
    BigInt('0x2222222222222222222222222222222222222222222222222222222222222222'),
  ];

  try {
    console.log('Estimating gas for submitBlock...');
    const gasEst = (await publicClient.estimateContractGas({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'submitBlock',
      args: [dummyAccumulator, 1n, ['0x0000000000000000000000000000000000000000000000000000000000000001']],
      account: operatorAccount,
    })) as bigint;

    console.log(`✅ Gas estimate: ${gasEst.toString()}`);

    console.log('\nSubmitting test block...');
    const hash = await walletClient.writeContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'submitBlock',
      args: [dummyAccumulator, 1n, ['0x0000000000000000000000000000000000000000000000000000000000000001']],
      account: operatorAccount,
    } as any);

    console.log(`✅ Transaction submitted: ${hash}`);

    console.log('\nWaiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`\n✅ Transaction confirmed!`);
    console.log(`   Status: ${receipt.status}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    // Check block after submission
    console.log('\n=== After submitBlock ===');
    const newBlock = (await publicClient.readContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'currentPlasmaBlock',
    })) as bigint;

    console.log(`Current block now: ${newBlock}`);
  } catch (error: any) {
    console.error(`❌ Error:`, error.message);
  }
}

checkLastBlock().catch(console.error);
