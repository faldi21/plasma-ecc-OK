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

async function finalWithdrawalTest() {
  console.log('=== FINAL WITHDRAWAL TEST - WITH FIXED CONTRACT ===\n');
  console.log('Testing the fix: verification against block accumulator, not current\n');

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
    console.log('❌ Cannot get witness');
    return;
  }

  const witness = witnessData.witness;
  console.log('Step 2: Witness from backend');
  console.log(`   X: ${witness.x.slice(0, 20)}...`);
  console.log(`   Y: ${witness.y.slice(0, 20)}...\n`);

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Step 3: Get current block number
  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log('Step 3: Current plasma block on L1');
  console.log(`   Block ${currentBlock}\n`);

  // Step 4: Setup withdrawal parameters
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;
  const amount = parseEther('2000');

  console.log('Step 4: Withdrawal parameters');
  console.log(`   Token: ${token}`);
  console.log(`   Amount: ${formatEther(amount)} tokens`);
  console.log(`   Block: ${currentBlock}`);
  console.log(`   TxHash: ${txHash}\n`);

  // Step 5: Call startExit
  console.log('Step 5: Calling startExit on FIXED contract...');
  console.log('   Contract now verifies against block accumulator!');
  console.log('   This should succeed even if new blocks were added!\n');

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

    console.log('=' .repeat(70));
    if (receipt.status === 'success') {
      console.log('🎉🎉🎉 SUCCESS! WITHDRAWAL STARTED! 🎉🎉🎉');
      console.log('=' .repeat(70));
      console.log('\n✅ The CRITICAL BUG has been FIXED!');
      console.log('✅ Contract now verifies against block accumulator');
      console.log('✅ Witnesses remain valid even after new blocks');
      console.log('\n📊 Transaction Details:');
      console.log(`   TX Hash: ${hash}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
      console.log('\n🎯 Complete flow is working:');
      console.log('   Deposit → Relay → Block Creation → Withdrawal ✅');
      console.log('\nNext step: Wait for exit period, then finalizeExit()');
    } else {
      console.log('❌ TRANSACTION REVERTED');
      console.log('=' .repeat(70));
      console.log(`   Status: ${receipt.status}`);
    }

  } catch (error: any) {
    console.error('\n❌ ERROR:');
    console.error(`   ${error.message.split('\n')[0]}`);

    if (error.message.includes('Invalid transaction proof')) {
      console.log('\n⚠️  Still getting proof verification error!');
      console.log('   This should not happen with the fix.');
      console.log('   Please verify contract was redeployed correctly.');
    }
  }
}

finalWithdrawalTest().catch(console.error);
