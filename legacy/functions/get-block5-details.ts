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

  console.log('=== Getting Block 5 Details ===\n');

  // Get BlockSubmitted event for block 5
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

  const block5Log = logs.find(log => log.args.blockNumber === 5n);

  if (!block5Log) {
    console.log('Block 5 not found!');
    return;
  }

  console.log(`Block #5 Details:`);
  console.log(`  Transaction Hash: ${block5Log.transactionHash}`);
  console.log(`  Accumulator X: ${block5Log.args.accumulatorValue?.x}`);
  console.log(`  Accumulator Y: ${block5Log.args.accumulatorValue?.y}`);

  // Get the transaction to see input data
  const tx = await publicClient.getTransaction({ hash: block5Log.transactionHash });
  console.log(`\nTransaction Details:`);
  console.log(`  From: ${tx.from}`);
  console.log(`  Block Number: ${tx.blockNumber}`);
  console.log(`  Gas Used: ${tx.gas}`);

  // Decode the input to get transaction hashes
  console.log(`\nTransaction Input Data (first 200 chars):`);
  console.log(tx.input.slice(0, 200));

  // Try to parse the submitBlock call
  const decoded = await publicClient.call({
    to: CONFIG.ROOT_CHAIN_ADDRESS,
    data: tx.input,
  }).catch(() => null);

  console.log(`\n✅ Block 5 was submitted successfully!`);
  console.log(`\nTo find the transaction hashes, we need to check backend logs or L2 events.`);
}

main().catch(console.error);
