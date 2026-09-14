/**
 * Rebuild Backend Accumulator from L1 State
 * Fetches all BlockSubmitted events and rebuilds accumulator
 */

import { createPublicClient, http, decodeAbiParameters, parseAbiParameters } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
  BACKEND_URL: 'http://localhost:3001',
};

async function main() {
  console.log('=== Rebuilding Backend Accumulator from L1 ===\n');

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
  });

  // Get all BlockSubmitted events
  console.log('Fetching BlockSubmitted events from L1...');
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

  console.log(`Found ${logs.length} blocks on L1\n`);

  // For each block, get transaction hashes and add to backend accumulator
  const allTxHashes: string[] = [];

  for (const log of logs) {
    const blockNumber = log.args.blockNumber;
    console.log(`Processing Block #${blockNumber}...`);

    // Get the submitBlock transaction
    const tx = await publicClient.getTransaction({ hash: log.transactionHash });

    // Decode transaction input to get txHashes
    const functionSelector = tx.input.slice(0, 10);
    const params = ('0x' + tx.input.slice(10)) as `0x${string}`;

    try {
      const decoded = decodeAbiParameters(
        parseAbiParameters('(uint256, uint256), uint256, bytes32[]'),
        params
      );

      const transactionHashes = decoded[2];
      console.log(`  Found ${transactionHashes.length} transactions`);

      for (const txHash of transactionHashes) {
        console.log(`    - ${txHash}`);
        allTxHashes.push(txHash);
      }

    } catch (error: any) {
      console.error(`  Error decoding: ${error.message}`);
    }
  }

  console.log(`\nTotal transactions to add: ${allTxHashes.length}\n`);

  // Add each transaction to backend accumulator in order
  for (let i = 0; i < allTxHashes.length; i++) {
    const txHash = allTxHashes[i];
    console.log(`Adding transaction ${i + 1}/${allTxHashes.length}: ${txHash}`);

    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/accumulator/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });

      const data = await response.json();

      if (data.success) {
        console.log(`  ✅ Added (size: ${data.size})`);
      } else {
        console.log(`  ⚠️  ${data.error || 'Failed to add'}`);
      }

    } catch (error: any) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  // Verify final state
  console.log('\n--- Verification ---');
  const backendResp = await fetch(`${CONFIG.BACKEND_URL}/api/accumulator/value`);
  const backendData = await backendResp.json();

  console.log(`Backend Accumulator:`);
  console.log(`  Size: ${backendData.size}`);
  console.log(`  X: ${backendData.accumulator.x}`);
  console.log(`  Y: ${backendData.accumulator.y}`);

  // Get L1 accumulator
  const l1Acc = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log(`\nL1 Accumulator:`);
  console.log(`  X: 0x${l1Acc.x.toString(16)}`);
  console.log(`  Y: 0x${l1Acc.y.toString(16)}`);

  const match = (
    backendData.accumulator.x.toLowerCase() === ('0x' + l1Acc.x.toString(16)).toLowerCase() &&
    backendData.accumulator.y.toLowerCase() === ('0x' + l1Acc.y.toString(16)).toLowerCase()
  );

  if (match) {
    console.log(`\n✅ SUCCESS! Backend and L1 accumulators are IN SYNC!`);
  } else {
    console.log(`\n❌ WARNING: Backend and L1 accumulators are OUT OF SYNC!`);
  }
}

main().catch(console.error);
