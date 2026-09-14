import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

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

  console.log('=== Getting Submitted Blocks from L1 ===\n');

  // Get current block number
  const currentBlock = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log(`Current Plasma Block: ${currentBlock}\n`);

  // Get BlockSubmitted events
  const logs = await publicClient.getLogs({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    event: {
      type: 'event',
      name: 'BlockSubmitted',
      inputs: [
        { type: 'uint256', indexed: true, name: 'blockNumber' },
        { type: 'tuple', indexed: false, name: 'accumulatorValue', components: [
          { type: 'uint256', name: 'x' },
          { type: 'uint256', name: 'y' }
        ]}
      ]
    },
    fromBlock: 'earliest',
    toBlock: 'latest',
  });

  console.log(`Found ${logs.length} BlockSubmitted events:\n`);

  for (const log of logs) {
    console.log(`Block #${log.args.blockNumber}`);
    console.log(`  Transaction Hash: ${log.transactionHash}`);
    console.log(`  Accumulator X: ${log.args.accumulatorValue?.x}`);
    console.log(`  Accumulator Y: ${log.args.accumulatorValue?.y}`);

    // Get transaction details to see what txHashes were included
    const tx = await publicClient.getTransaction({ hash: log.transactionHash });
    console.log(`  Block Time: ${new Date(Number((await publicClient.getBlock({blockNumber: log.blockNumber})).timestamp) * 1000).toISOString()}`);
    console.log('');
  }

  // Try to read individual blocks from contract
  console.log('\n=== Reading Block Details from Contract ===\n');

  for (let i = 1n; i <= currentBlock; i++) {
    try {
      const blockData = await publicClient.readContract({
        address: CONFIG.ROOT_CHAIN_ADDRESS,
        abi: RootChainData.abi,
        functionName: 'plasmaBlocks',
        args: [i],
      }) as any;

      console.log(`Block ${i}:`);
      console.log(`  Block Number: ${blockData.blockNumber}`);
      console.log(`  Transaction Count: ${blockData.transactionCount}`);
      console.log(`  Timestamp: ${blockData.timestamp}`);
      console.log(`  Operator: ${blockData.operator}`);
      console.log(`  Accumulator X: ${blockData.accumulatorValue.x}`);
      console.log(`  Accumulator Y: ${blockData.accumulatorValue.y}`);
      console.log('');
    } catch (error: any) {
      console.log(`  Error reading block ${i}: ${error.message}`);
    }
  }
}

main().catch(console.error);
