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

const account = privateKeyToAccount('0x873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080' as `0x${string}`);

const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.L1_RPC),
  account,
});

async function quickWithdraw() {
  console.log('=== Quick Withdrawal Test ===\n');

  // Use the deposit tx from backend logs
  const txHash = '0xb9d8a8615cf70301f496b07d9d195433dca59364d90de12261a147eeb713fc67'; // From block 3
  const blockNumber = 3n;
  const amount = parseEther('10');

  console.log('Using deposit tx:', txHash);
  console.log('Block:', blockNumber);
  console.log('Amount:', formatEther(amount));

  // Get witness from backend
  console.log('\nFetching witness from backend...');
  const witnessResponse = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  if (!witnessResponse.ok) {
    throw new Error(`Failed to get witness: ${witnessResponse.statusText}`);
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

  console.log('\nCalling startExit...');
  try {
    const hash = await walletClient.writeContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'startExit',
      args: [
        process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`,
        amount,
        blockNumber,
        txHash as `0x${string}`,
        witnessPoint
      ],
      gas: 500000n,
    } as any);

    console.log(`📝 TX submitted: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`\n✅ Exit started!`);
    console.log(`   Status: ${receipt.status}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);

    if (receipt.status === 'success') {
      console.log('\n✅ SUCCESS! Withdrawal initiated successfully!');
    } else {
      console.log('\n❌ Transaction reverted');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

quickWithdraw().catch(console.error);
