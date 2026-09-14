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

async function verifyWitness() {
  console.log('=== MANUAL WITNESS VERIFICATION ===\n');

  // Get txHash from accumulator
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  const txHash = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;

  console.log(`TxHash: ${txHash}`);

  // Get witness from backend
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  const witness = witnessData.witness;

  console.log(`Backend Witness:`);
  console.log(`  X: ${witness.x}`);
  console.log(`  Y: ${witness.y}`);

  // Get backend accumulator value
  const accResp = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResp.json();

  console.log(`\nBackend Accumulator:`);
  console.log(`  X: ${accData.accumulator.x}`);
  console.log(`  Y: ${accData.accumulator.y}`);

  // Get L1 accumulator value
  const l1Acc = await publicClient.readContract({
    address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log(`\nL1 Accumulator:`);
  console.log(`  X: ${l1Acc.x}`);
  console.log(`  Y: ${l1Acc.y}`);

  // Compare
  const backendX = BigInt(accData.accumulator.x);
  const backendY = BigInt(accData.accumulator.y);
  const l1X = BigInt(l1Acc.x);
  const l1Y = BigInt(l1Acc.y);

  console.log(`\n=== COMPARISON ===`);
  console.log(`Backend X == L1 X? ${backendX === l1X}`);
  console.log(`Backend Y == L1 Y? ${backendY === l1Y}`);

  if (backendX !== l1X || backendY !== l1Y) {
    console.log(`\n❌ ACCUMULATOR MISMATCH!`);
    console.log(`Backend and L1 accumulators are out of sync!`);
    console.log(`\nThis is the root cause of the "Invalid transaction proof" error.`);
  } else {
    console.log(`\n✅ Accumulators are in sync!`);

    // Now test if we can call verify on the contract
    console.log(`\n=== Testing Contract Verification ===`);

    try {
      const witnessPoint = {
        x: BigInt(witness.x),
        y: BigInt(witness.y),
      };

      // This should not revert if everything is correct
      const result = await publicClient.readContract({
        address: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
        abi: RootChainData.abi,
        functionName: 'verifyTransaction',
        args: [txHash, witnessPoint],
      });

      console.log(`Verification result: ${result}`);

      if (result) {
        console.log(`\n✅ Contract verification succeeded!`);
        console.log(`The witness is valid!`);
      } else {
        console.log(`\n❌ Contract verification failed!`);
        console.log(`The witness is invalid even though accumulators match.`);
      }
    } catch (error: any) {
      console.error(`\n❌ Error calling verifyTransaction:`);
      console.error(`   ${error.message}`);
    }
  }
}

verifyWitness().catch(console.error);
