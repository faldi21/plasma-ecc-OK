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

async function checkAccumulator() {
  console.log('=== Checking Accumulator Value ===\n');
  
  try {
    const result = await publicClient.readContract({
      address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
      abi: RootChainABI,
      functionName: 'getAccumulatorValue',
    }) as any;

    console.log('✅ getAccumulatorValue succeeded');
    console.log('Accumulator X:', result.x.toString());
    console.log('Accumulator Y:', result.y.toString());
    console.log('\nHex format:');
    console.log('Accumulator X (hex):', '0x' + BigInt(result.x).toString(16));
    console.log('Accumulator Y (hex):', '0x' + BigInt(result.y).toString(16));
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

checkAccumulator().catch(console.error);
