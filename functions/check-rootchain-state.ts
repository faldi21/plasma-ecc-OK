import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const RootChainData = JSON.parse(
  fs.readFileSync('./backend/abi/RootChain.json', 'utf8')
);

const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
};

async function main() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
  });

  console.log('=== RootChain State Check ===\n');

  // Check currentPlasmaBlock
  const currentBlock = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  });

  console.log(`Current Plasma Block: ${currentBlock}`);

  // Check accumulator value
  const accValue = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log(`\nAccumulator Value:`);
  console.log(`  X: ${accValue.x}`);
  console.log(`  Y: ${accValue.y}`);

  // Check if it's still the generator point (not updated)
  const generatorX = BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const generatorY = BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8');

  const isGenerator = (accValue.x === generatorX && accValue.y === generatorY);
  console.log(`\nIs Generator Point (not updated)? ${isGenerator}`);

  if (isGenerator) {
    console.log('\n⚠️  PROBLEM: Accumulator is still at generator point!');
    console.log('This means submitBlock has NOT been called yet or accumulator was not updated.');
  } else {
    console.log('\n✅ Accumulator has been updated from generator point');
  }
}

main().catch(console.error);
