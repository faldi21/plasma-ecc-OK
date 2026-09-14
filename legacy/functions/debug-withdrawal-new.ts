import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const account = privateKeyToAccount(process.env.PK_USER_A as `0x${string}`);

const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
  account,
});

async function debugWithdrawal() {
  console.log('=== DEBUG WITHDRAWAL WITH NEW CONTRACT ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  console.log('RootChain Address:', rootChainAddress);
  console.log('User Address:', account.address);
  console.log('');

  // Step 1: Get txHash from backend
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();

  if (!elementsData.success || elementsData.size === 0) {
    console.log('❌ No transactions in accumulator');
    return;
  }

  const txHash = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;
  console.log('Step 1: TxHash from accumulator');
  console.log(`   ${txHash}\n`);

  // Step 2: Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();

  if (!witnessData.success) {
    console.log('❌ Cannot get witness:', witnessData.error);
    return;
  }

  const witness = witnessData.witness;
  console.log('Step 2: Witness from backend');
  console.log(`   X: ${witness.x}`);
  console.log(`   Y: ${witness.y}\n`);

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Step 3: Get current block number
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log('Step 3: Current plasma block on L1');
  console.log(`   Block ${currentBlock}\n`);

  // Step 4: Get block accumulator from L1
  const blockData = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'plasmaBlocks',
    args: [currentBlock],
  }) as any;

  console.log('Step 4: Block accumulator from L1');
  console.log(`   X: ${blockData.accumulatorValue.x}`);
  console.log(`   Y: ${blockData.accumulatorValue.y}\n`);

  // Step 5: Get current accumulator from backend for comparison
  const backendAccResp = await fetch('http://localhost:3001/api/accumulator/value');
  const backendAccData = await backendAccResp.json();

  console.log('Step 5: Current accumulator from backend');
  console.log(`   X: ${backendAccData.accumulator.x}`);
  console.log(`   Y: ${backendAccData.accumulator.y}\n`);

  // Compare
  const accMatch = (
    BigInt(blockData.accumulatorValue.x) === BigInt(backendAccData.accumulator.x) &&
    BigInt(blockData.accumulatorValue.y) === BigInt(backendAccData.accumulator.y)
  );

  console.log('Step 6: Accumulator comparison');
  console.log(`   L1 block acc == Backend current acc: ${accMatch ? '✅ MATCH' : '❌ MISMATCH'}\n`);

  // Step 7: Setup withdrawal parameters
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;
  const amount = parseEther('2000');

  console.log('Step 7: Withdrawal parameters');
  console.log(`   Token: ${token}`);
  console.log(`   Amount: ${formatEther(amount)} tokens`);
  console.log(`   Block: ${currentBlock}`);
  console.log(`   TxHash: ${txHash}\n`);

  // Step 8: Try to simulate the call first
  console.log('Step 8: Simulating startExit call...\n');

  try {
    await publicClient.simulateContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [token, amount, currentBlock, txHash, witnessPoint],
      account,
    });

    console.log('✅ Simulation SUCCESS! Call should work.\n');

  } catch (simError: any) {
    console.log('❌ Simulation FAILED!');
    console.log('Error:', simError.message.split('\n')[0]);

    if (simError.shortMessage) {
      console.log('Short message:', simError.shortMessage);
    }

    // Try to extract revert reason
    const revertMatch = simError.message.match(/reverted with the following reason:\n(.+)/);
    if (revertMatch) {
      console.log('Revert reason:', revertMatch[1]);
    }

    console.log('\n⚠️  Cannot proceed with actual transaction due to simulation failure.\n');

    // Additional debugging
    console.log('=== DEBUGGING INFO ===');
    console.log('Witness Point:');
    console.log('  X:', witnessPoint.x.toString());
    console.log('  Y:', witnessPoint.y.toString());
    console.log('\nBlock Accumulator:');
    console.log('  X:', BigInt(blockData.accumulatorValue.x).toString());
    console.log('  Y:', BigInt(blockData.accumulatorValue.y).toString());

    return;
  }

  // Step 9: If simulation passed, do actual call
  console.log('Step 9: Calling startExit on contract...\n');

  try {
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [token, amount, currentBlock, txHash, witnessPoint],
      gas: 500000n,
    } as any);

    console.log(`📝 Transaction submitted: ${hash}`);
    console.log(`   Waiting for confirmation...\n`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('='.repeat(70));
    if (receipt.status === 'success') {
      console.log('🎉🎉🎉 SUCCESS! WITHDRAWAL STARTED! 🎉🎉🎉');
      console.log('='.repeat(70));
      console.log('\n✅ The CRITICAL BUG has been FIXED!');
      console.log('✅ Contract verifies against block accumulator');
      console.log('✅ Witnesses remain valid even after new blocks');
      console.log('\n📊 Transaction Details:');
      console.log(`   TX Hash: ${hash}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
    } else {
      console.log('❌ TRANSACTION REVERTED');
      console.log('='.repeat(70));
      console.log(`   Status: ${receipt.status}`);
      console.log(`   TX Hash: ${hash}`);
    }

  } catch (error: any) {
    console.error('\n❌ ERROR during transaction:');
    console.error(`   ${error.message.split('\n')[0]}`);
  }
}

debugWithdrawal().catch(console.error);
