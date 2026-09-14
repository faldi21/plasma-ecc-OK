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

async function syncCheck() {
  console.log('=== SYNC CHECK: Backend vs L1 ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  // Get L1 state
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  const l1Acc = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log('L1 Contract State:');
  console.log('  Current Plasma Block:', currentBlock);
  console.log('  Accumulator X:', '0x' + l1Acc.x.toString(16));
  console.log('  Accumulator Y:', '0x' + l1Acc.y.toString(16));

  // Get backend state
  const backendResp = await fetch('http://localhost:3001/api/accumulator/value');
  const backendData = await backendResp.json();

  console.log('\nBackend State:');
  console.log('  Accumulator Size:', backendData.size);
  console.log('  Accumulator X:', backendData.accumulator.x);
  console.log('  Accumulator Y:', backendData.accumulator.y);

  // Compare
  const l1X = '0x' + l1Acc.x.toString(16);
  const l1Y = '0x' + l1Acc.y.toString(16);
  const backendX = backendData.accumulator.x;
  const backendY = backendData.accumulator.y;

  console.log('\n=== COMPARISON ===');
  console.log('X Match?', l1X === backendX);
  console.log('Y Match?', l1Y === backendY);

  if (l1X === backendX && l1Y === backendY) {
    console.log('\n✅ BACKEND AND L1 ARE IN SYNC!');
    console.log('Witnesses from backend should be valid for L1.');
  } else {
    console.log('\n❌ BACKEND AND L1 ARE OUT OF SYNC!');
    console.log('This is why witness verification fails!');
    console.log('\nPossible reasons:');
    console.log('1. Backend submitted a new block but accumulator update failed');
    console.log('2. Someone else submitted a block to L1');
    console.log('3. Backend restarted and lost accumulator state');

    console.log('\nSOLUTION: Rebuild backend accumulator from L1');
  }

  // Get elements list
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();

  console.log('\nBackend Accumulator Elements:');
  console.log('  Total:', elementsData.size);
  if (elementsData.elements && elementsData.elements.length > 0) {
    console.log('  Elements:');
    elementsData.elements.forEach((el: string, i: number) => {
      console.log(`    [${i}] ${el}`);
    });
  }
}

syncCheck().catch(console.error);
