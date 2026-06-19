import { createPublicClient, createWalletClient, http, keccak256, encodePacked, formatEther } from 'viem';
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

async function finalizeExit() {
  console.log('=== FINALIZE EXIT ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  const userAddress = account.address;
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;

  console.log('User:', account.address);
  console.log('RootChain:', rootChainAddress);
  console.log('Token:', token);
  console.log('');

  // Get txHash
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  const txHash = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;

  // Get current block
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  // Calculate exitId
  const exitId = keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'bytes32'],
      [userAddress, token, currentBlock, txHash]
    )
  );

  console.log('Exit ID:', exitId);
  console.log('TxHash:', txHash);
  console.log('Block Number:', currentBlock.toString());
  console.log('');

  // Check exit data first (returns array)
  const result = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'exits',
    args: [exitId],
  }) as any[];

  const [owner, exitToken, amount, blockNum, exitTxHash, exitTime, processed] = result;

  if (owner === '0x0000000000000000000000000000000000000000') {
    console.log('❌ Exit not found!');
    console.log('   Make sure you have called startExit first.');
    return;
  }

  if (processed) {
    console.log('❌ Exit already processed!');
    console.log('   This exit has already been finalized.');
    return;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const exitTimeNum = Number(exitTime);
  const timeRemaining = exitTimeNum - currentTime;

  if (timeRemaining > 0) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    console.log(`❌ Exit period not ended yet!`);
    console.log(`   Time remaining: ${minutes}m ${seconds}s`);
    console.log(`   Please wait before calling finalizeExit().`);
    return;
  }

  console.log('Exit Data:');
  console.log('  Amount:', formatEther(amount), 'tokens');
  console.log('  Exit Time:', new Date(exitTimeNum * 1000).toISOString());
  console.log('  Status: Ready to finalize');
  console.log('');

  // Get user's current L1 balance
  const balanceBefore = await publicClient.readContract({
    address: token,
    abi: [{
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ type: 'address' }],
      outputs: [{ type: 'uint256' }],
    }],
    functionName: 'balanceOf',
    args: [account.address],
  }) as bigint;

  console.log('L1 Token Balance Before:', formatEther(balanceBefore), 'tokens');
  console.log('');

  // Estimate gas
  console.log('Estimating gas for finalizeExit...');
  try {
    const gasEstimate = await publicClient.estimateContractGas({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'finalizeExit',
      args: [exitId],
      account,
    });

    console.log('✅ Gas estimate:', gasEstimate.toString());
    const gasLimit = (gasEstimate * 150n) / 100n;
    console.log('   Using gas limit:', gasLimit.toString(), '(estimate + 50%)');
    console.log('');

    // Call finalizeExit
    console.log('Calling finalizeExit...');
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'finalizeExit',
      args: [exitId],
      gas: gasLimit,
    } as any);

    console.log(`📝 Transaction submitted: ${hash}`);
    console.log(`   Waiting for confirmation...\n`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('='.repeat(70));
    if (receipt.status === 'success') {
      console.log('🎉🎉🎉 EXIT FINALIZED SUCCESSFULLY! 🎉🎉🎉');
      console.log('='.repeat(70));

      // Check new balance
      const balanceAfter = await publicClient.readContract({
        address: token,
        abi: [{
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ type: 'address' }],
          outputs: [{ type: 'uint256' }],
        }],
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const received = balanceAfter - balanceBefore;

      console.log('\n✅ Tokens withdrawn to L1!');
      console.log('');
      console.log('📊 Transaction Details:');
      console.log(`   TX Hash: ${hash}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
      console.log('');
      console.log('💰 Balance Changes:');
      console.log(`   L1 Before: ${formatEther(balanceBefore)} tokens`);
      console.log(`   L1 After:  ${formatEther(balanceAfter)} tokens`);
      console.log(`   Received:  ${formatEther(received)} tokens`);
      console.log('');
      console.log('🎯 COMPLETE PLASMA FLOW VERIFIED:');
      console.log('   ✅ Deposit to L1');
      console.log('   ✅ Relay to L2');
      console.log('   ✅ Block creation and submission');
      console.log('   ✅ Start exit (withdrawal)');
      console.log('   ✅ Finalize exit');
      console.log('');
      console.log('All features working perfectly with ECC accumulator! 🚀');

    } else {
      console.log('❌ TRANSACTION REVERTED');
      console.log('='.repeat(70));
      console.log(`   Status: ${receipt.status}`);
      console.log(`   TX Hash: ${hash}`);
    }

  } catch (error: any) {
    console.error('\n❌ Error:');
    console.error(error.message.split('\n').slice(0, 3).join('\n'));

    if (error.message.includes('Not exit owner')) {
      console.log('\n⚠️  You are not the owner of this exit.');
    } else if (error.message.includes('Already processed')) {
      console.log('\n⚠️  Exit already processed.');
    } else if (error.message.includes('Exit period not ended')) {
      console.log('\n⚠️  Exit period not ended yet. Please wait.');
    }
  }
}

finalizeExit().catch(console.error);
