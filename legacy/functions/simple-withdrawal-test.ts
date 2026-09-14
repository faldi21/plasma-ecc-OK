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

async function simpleWithdrawalTest() {
  console.log('=== Simple Withdrawal Test ===\n');
  console.log('User:', account.address);

  // Step 1: Get accumulator size from backend
  console.log('\nStep 1: Checking backend accumulator...');
  const accResponse = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResponse.json();

  console.log(`   Backend accumulator size: ${accData.size}`);

  if (accData.size === 0) {
    console.log('❌ No transactions in backend accumulator. Make a deposit first.');
    return;
  }

  // Step 2: Read BlockSubmitted events to get txHashes
  console.log('\nStep 2: Reading BlockSubmitted events from L1...');
  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  const blockEvents = await publicClient.getContractEvents({
    address: rootChainAddress,
    abi: RootChainABI,
    eventName: 'BlockSubmitted',
    fromBlock: 'earliest',
  });

  console.log(`   Found ${blockEvents.length} blocks submitted`);

  if (blockEvents.length === 0) {
    console.log('❌ No blocks submitted yet. Wait for backend to submit a block.');
    return;
  }

  const latestBlockEvent = blockEvents[blockEvents.length - 1];
  const blockNumber = latestBlockEvent.args.blockNumber as bigint;

  console.log(`   Latest block: ${blockNumber}`);

  // Step 3: Get Deposit event to find our txHash and amount
  console.log('\nStep 3: Getting deposit information...');
  const depositEvents = await publicClient.getContractEvents({
    address: rootChainAddress,
    abi: RootChainABI,
    eventName: 'Deposit',
    args: {
      user: account.address,
    },
    fromBlock: 'earliest',
  });

  console.log(`   Found ${depositEvents.length} deposits for this user`);

  if (depositEvents.length === 0) {
    console.log('❌ No deposits found for this user');
    return;
  }

  const latestDeposit = depositEvents[depositEvents.length - 1];
  const token = latestDeposit.args.token as `0x${string}`;
  const amount = latestDeposit.args.amount as bigint;

  console.log(`   Token: ${token}`);
  console.log(`   Amount: ${formatEther(amount)}`);

  // Step 4: Get the deposit tx hash (L1 tx hash)
  const depositTxHash = latestDeposit.transactionHash;
  console.log(`   Deposit L1 TxHash: ${depositTxHash}`);

  // Step 5: Ask backend for the L2 txHash that corresponds to this deposit
  // For now, let's manually construct it or get it from relay logs
  // The L2 updateBalance creates a txHash that gets added to accumulator

  console.log('\nStep 4: We need the L2 updateBalance txHash...');
  console.log('   Checking if backend has witness for deposit txHash...');

  // Try using the deposit txHash first
  let txHashToUse = depositTxHash;
  let witnessResponse = await fetch(`http://localhost:3001/api/witness/${txHashToUse}`);

  if (!witnessResponse.ok) {
    console.log(`   Deposit txHash not in accumulator (expected)`);
    console.log(`   The actual txHash in accumulator is the L2 updateBalance txHash`);
    console.log('\n   Reading relay logs to find L2 txHash...');

    // We need to get this from somewhere
    // Let's just ask the user or check l2-addresses.json
    const l2AddressesPath = path.join(__dirname, '../l2-addresses.json');
    if (fs.existsSync(l2AddressesPath)) {
      const l2Data = JSON.parse(fs.readFileSync(l2AddressesPath, 'utf-8'));
      console.log('   L2 data:', l2Data);
    }

    console.log('\n⚠️  Cannot automatically find L2 txHash');
    console.log('   Please provide the txHash from backend accumulator manually');
    console.log('   You can get it from backend logs or by calling:');
    console.log('   curl http://localhost:3001/api/blocks/latest');
    return;
  }

  console.log(`✅ Found witness for txHash: ${txHashToUse}`);

  const witnessData = await witnessResponse.json();
  const witness = witnessData.witness;

  console.log(`   X: ${witness.x.slice(0, 20)}...`);
  console.log(`   Y: ${witness.y.slice(0, 20)}...`);

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Step 6: Call startExit
  console.log('\nStep 5: Calling startExit...');
  console.log(`   Token: ${token}`);
  console.log(`   Amount: ${formatEther(amount)}`);
  console.log(`   Block: ${blockNumber}`);
  console.log(`   TxHash: ${txHashToUse}`);

  try {
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: RootChainABI,
      functionName: 'startExit',
      args: [
        token,
        amount,
        blockNumber,
        txHashToUse as `0x${string}`,
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

    if (receipt.status === 'success') {
      console.log('\n🎉 SUCCESS! WITHDRAWAL INITIATED!');
      console.log('   The ECC fix is working!');
    } else {
      console.log('\n❌ Transaction reverted');
    }
  } catch (error: any) {
    console.error('\n❌ Error:');
    console.error('   ', error.message);
  }
}

simpleWithdrawalTest().catch(console.error);
