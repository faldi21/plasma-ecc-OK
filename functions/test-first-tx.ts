import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
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

async function testFirstTx() {
  const txHash = '0x263eb894ab25147e2de5a6a68cf7d59e9d0cee2eed545e24180cd3c2ff8aace1' as `0x${string}`;

  console.log('Testing withdrawal with FIRST txHash:', txHash);

  // Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();

  if (!witnessData.success) {
    console.log('❌ Cannot get witness:', witnessData.error);
    return;
  }

  const witness = witnessData.witness;
  console.log('✅ Got witness');

  const witnessPoint = {
    x: BigInt(witness.x),
    y: BigInt(witness.y),
  };

  // Get current block
  const currentBlock = await publicClient.readContract({
    address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log(`Current block: ${currentBlock}`);

  // Call startExit
  const hash = await walletClient.writeContract({
    address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
    abi: RootChainData.abi,
    functionName: 'startExit',
    args: [
      process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`,
      parseEther('2000'),
      currentBlock,
      txHash,
      witnessPoint
    ],
    gas: 500000n,
  } as any);

  console.log('TX submitted:', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log('Status:', receipt.status);

  if (receipt.status === 'success') {
    console.log('\n🎉 SUCCESS!');
  } else {
    console.log('\n❌ REVERTED');
  }
}

testFirstTx().catch(console.error);
