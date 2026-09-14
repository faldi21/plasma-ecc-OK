import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function testWitnessOnchain() {
  console.log('=== Testing Witness On-Chain ===\n');

  const txHash = '0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb' as `0x${string}`;

  // Get witness from backend
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();

  if (!witnessData.success) {
    console.log('❌ Cannot get witness');
    return;
  }

  const witness = witnessData.witness;

  console.log('TxHash:', txHash);
  console.log('Witness X:', witness.x);
  console.log('Witness Y:', witness.y);

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Try to call a view function that verifies the witness
  // We can use simulate startExit to see if it would succeed

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  const tokenAddress = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;
  const amount = 2000n * 10n**18n;
  const userAddress = '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as `0x${string}`;

  // Get current block
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log('\nSimulating startExit call...');
  console.log('  Token:', tokenAddress);
  console.log('  Amount:', amount / 10n**18n, 'tokens');
  console.log('  Block:', currentBlock);

  try {
    // Simulate the call
    await publicClient.simulateContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [tokenAddress, amount, currentBlock, txHash, witnessPoint],
      account: userAddress,
    });

    console.log('\n✅ SIMULATION SUCCESSFUL!');
    console.log('   startExit() would succeed if broadcast now!');

  } catch (error: any) {
    console.error('\n❌ SIMULATION FAILED!');
    console.error('   Error:', error.shortMessage || error.message.split('\n')[0]);

    // Try to extract specific error
    if (error.message.includes('Invalid transaction proof')) {
      console.log('\n🔍 Reason: Witness verification failed');
      console.log('   The accumulator on L1 does not match backend');
    } else if (error.message.includes('Invalid block')) {
      console.log('\n🔍 Reason: Block number invalid');
      console.log(`   Block ${currentBlock} may not exist or is greater than current`);
    } else if (error.message.includes('Exit already processed')) {
      console.log('\n🔍 Reason: Exit already exists');
    } else if (error.message.includes('Invalid amount')) {
      console.log('\n🔍 Reason: Amount is zero or invalid');
    } else {
      console.log('\n🔍 Full error:');
      console.log(error);
    }
  }
}

testWitnessOnchain().catch(console.error);
