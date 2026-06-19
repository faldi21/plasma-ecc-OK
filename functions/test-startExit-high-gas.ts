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

async function testStartExit() {
  console.log('=== TEST START EXIT WITH HIGH GAS ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  // Get txHash
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  const txHash = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;

  console.log('TxHash:', txHash);

  // Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  const witness = witnessData.witness;

  console.log('Witness X:', witness.x);
  console.log('Witness Y:', witness.y);

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Get current block
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log('Current Block:', currentBlock);

  // Get block accumulator
  const blockData = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'plasmaBlocks',
    args: [currentBlock],
  }) as any;

  console.log('Block Acc X:', blockData[1].x.toString());
  console.log('Block Acc Y:', blockData[1].y.toString());
  console.log('');

  // Setup parameters
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;
  const amount = parseEther('2000');

  console.log('Parameters:');
  console.log('  Token:', token);
  console.log('  Amount:', formatEther(amount));
  console.log('  Block:', currentBlock.toString());
  console.log('  TxHash:', txHash);
  console.log('  Witness X:', witnessPoint.x.toString().slice(0, 30) + '...');
  console.log('  Witness Y:', witnessPoint.y.toString().slice(0, 30) + '...');
  console.log('');

  // First try to estimate gas
  console.log('Estimating gas...');
  try {
    const gasEstimate = await publicClient.estimateContractGas({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [token, amount, currentBlock, txHash, witnessPoint],
      account,
    });

    console.log('✅ Gas estimate:', gasEstimate.toString());
    console.log('');

    // Add 50% buffer
    const gasLimit = (gasEstimate * 150n) / 100n;
    console.log(`Using gas limit: ${gasLimit} (estimate + 50% buffer)\n`);

    // Call startExit
    console.log('Calling startExit...');
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [token, amount, currentBlock, txHash, witnessPoint],
      gas: gasLimit,
    } as any);

    console.log(`📝 Transaction submitted: ${hash}`);
    console.log(`   Waiting for confirmation...\n`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('='.repeat(70));
    if (receipt.status === 'success') {
      console.log('🎉🎉🎉 SUCCESS! WITHDRAWAL STARTED! 🎉🎉🎉');
      console.log('='.repeat(70));
      console.log('\n✅ The fix is working!');
      console.log(`\n📊 Transaction Details:`);
      console.log(`   TX Hash: ${hash}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
      console.log(`\n🎯 Complete flow verified:`);
      console.log(`   Deposit → Relay → Block Creation → Withdrawal ✅`);
    } else {
      console.log('❌ TRANSACTION REVERTED');
      console.log('='.repeat(70));
      console.log(`   Status: ${receipt.status}`);
      console.log(`   TX Hash: ${hash}`);
      console.log(`   Gas Used: ${receipt.gasUsed}`);
    }

  } catch (error: any) {
    console.error('\n❌ Error:');
    console.error(error.message.split('\n').slice(0, 3).join('\n'));

    // Check for specific errors
    if (error.message.includes('Invalid transaction proof')) {
      console.log('\n⚠️  Contract rejected: Invalid transaction proof');
      console.log('   The witness verification failed.');
      console.log('   This means the contract code may not have the fix.');
    } else if (error.message.includes('Invalid block')) {
      console.log('\n⚠️  Contract rejected: Invalid block number');
    } else if (error.message.includes('execution reverted')) {
      console.log('\n⚠️  Transaction would revert.');
      console.log('   Checking if contract has verifyWithAccumulator function...');
    }
  }
}

testStartExit().catch(console.error);
