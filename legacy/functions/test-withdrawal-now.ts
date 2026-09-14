import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load ABIs
const RootChainData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/abi/RootChain.json'), 'utf-8')
);
const RootChainABI = RootChainData.abi || RootChainData;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.L1_RPC),
});

const account = privateKeyToAccount(process.env.PK_USER_A as `0x${string}`);

const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.L1_RPC),
  account,
});

async function testWithdrawal() {
  console.log('=== Testing Withdrawal with Fixed Contracts ===\n');

  // Step 1: Get blocks from L1 contract
  console.log('Step 1: Reading submitted blocks from L1...');
  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  const currentBlockNumber = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainABI,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log(`   Current plasma block on L1: ${currentBlockNumber}`);

  if (currentBlockNumber === 0n) {
    console.log('❌ No blocks submitted yet. Run deposit first.');
    return;
  }

  // Get the latest block
  const latestBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainABI,
    functionName: 'plasmaBlocks',
    args: [currentBlockNumber],
  }) as any;

  console.log(`\nLatest block (${currentBlockNumber}):`);
  console.log(`   Root: ${latestBlock.root}`);
  console.log(`   Timestamp: ${latestBlock.timestamp}`);

  // Step 2: Use the block root as our txHash
  // In Plasma ECC, the root is actually the accumulator value
  // We need to get a real transaction from the backend

  console.log('\nStep 2: Fetching accumulator state from backend...');
  const accResponse = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResponse.json();

  console.log(`   Backend accumulator size: ${accData.size}`);

  if (accData.size === 0) {
    console.log('❌ No transactions in backend accumulator');
    return;
  }

  // For testing, we'll use a known txHash from the deposit
  // Let's get deposit events from L1
  console.log('\nStep 3: Reading deposit events from L1...');

  const depositEvents = await publicClient.getContractEvents({
    address: rootChainAddress,
    abi: RootChainABI,
    eventName: 'DepositCreated',
    fromBlock: 'earliest',
  });

  console.log(`   Found ${depositEvents.length} deposit events`);

  if (depositEvents.length === 0) {
    console.log('❌ No deposits found');
    return;
  }

  // Get the most recent deposit
  const latestDeposit = depositEvents[depositEvents.length - 1];
  const txHash = latestDeposit.args.txHash as `0x${string}`;
  const amount = latestDeposit.args.amount as bigint;

  console.log(`\nUsing latest deposit:`);
  console.log(`   TxHash: ${txHash}`);
  console.log(`   Amount: ${formatEther(amount)} tokens`);
  console.log(`   Block: ${currentBlockNumber}`);

  // Step 4: Get witness from backend
  console.log('\nStep 4: Fetching witness from backend...');
  const witnessResponse = await fetch(`http://localhost:3001/api/witness/${txHash}`);

  if (!witnessResponse.ok) {
    const errorText = await witnessResponse.text();
    console.log(`❌ Failed to get witness: ${errorText}`);
    return;
  }

  const witnessData = await witnessResponse.json();
  const witness = witnessData.witness;

  console.log(`✅ Witness obtained`);
  console.log(`   X: ${witness.x.slice(0, 20)}...`);
  console.log(`   Y: ${witness.y.slice(0, 20)}...`);

  // Convert to bigint
  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Step 5: Call startExit
  console.log('\nStep 5: Calling startExit...');
  console.log(`   Token: ${process.env.PLASMA_TOKEN_ADDRESS}`);
  console.log(`   Amount: ${formatEther(amount)}`);
  console.log(`   Block: ${currentBlockNumber}`);
  console.log(`   TxHash: ${txHash}`);

  try {
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: RootChainABI,
      functionName: 'startExit',
      args: [
        process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`,
        amount,
        currentBlockNumber,
        txHash,
        witnessPoint
      ],
      gas: 500000n,
    } as any);

    console.log(`\n📝 Transaction submitted: ${hash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`\n✅ Transaction mined!`);
    console.log(`   Status: ${receipt.status}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    if (receipt.status === 'success') {
      console.log('\n🎉 SUCCESS! WITHDRAWAL INITIATED SUCCESSFULLY!');
      console.log('   The ECC accumulator fix is working!');
      console.log('   No more "Invalid transaction proof" error!');
    } else {
      console.log('\n❌ Transaction reverted');
      console.log('   Status:', receipt.status);
    }
  } catch (error: any) {
    console.error('\n❌ Error calling startExit:');
    console.error('   ', error.message);

    if (error.message.includes('Invalid transaction proof')) {
      console.log('\n⚠️  Still getting proof verification error');
      console.log('   Backend and contract accumulators may still be out of sync');
    }
  }
}

testWithdrawal().catch(console.error);
