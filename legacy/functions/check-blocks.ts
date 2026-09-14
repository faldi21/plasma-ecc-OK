import { createPublicClient, http } from 'viem';
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

async function checkBlocks() {
  console.log('=== Check Blocks in Contract ===\n');

  const currentBlock = await publicClient.readContract({
    address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
    abi: RootChainABI,
    functionName: 'currentPlasmaBlock',
  });

  console.log(`Current block number: ${currentBlock}`);

  for (let i = 1n; i <= currentBlock; i++) {
    const block = await publicClient.readContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'plasmaBlocks',
      args: [i],
    });
    
    const blockData = block as any;
    console.log(`\nBlock ${i}:`);
    console.log(`  Accumulator X: ${blockData.accumulatorValue.x}`);
    console.log(`  Accumulator Y: ${blockData.accumulatorValue.y}`);
    console.log(`  Timestamp: ${blockData.timestamp}`);
    console.log(`  TX Count: ${blockData.transactionCount}`);
  }
}

checkBlocks().catch(console.error);
