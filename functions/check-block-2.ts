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

async function checkBlock2() {
  console.log('=== Checking Block 2 Accumulator ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  // Get block 2 data
  const block2Data = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'plasmaBlocks',
    args: [2n],
  }) as any;

  console.log('Block 2 Data:');
  console.log('  Block Number:', block2Data[0] || block2Data.blockNumber);
  console.log('  Accumulator:');
  const accX = block2Data[1]?.x || block2Data[1]?.[0] || block2Data.accumulatorValue?.x;
  const accY = block2Data[1]?.y || block2Data[1]?.[1] || block2Data.accumulatorValue?.y;
  console.log('    X:', '0x' + (typeof accX === 'bigint' ? accX.toString(16) : accX));
  console.log('    Y:', '0x' + (typeof accY === 'bigint' ? accY.toString(16) : accY));
  console.log('  Timestamp:', block2Data[2] || block2Data.timestamp);
  console.log('  Operator:', block2Data[3] || block2Data.operator);
  console.log('  Transaction Count:', (block2Data[4] || block2Data.transactionCount)?.toString());

  // Now test if witness + tx = block2 accumulator
  const txHash = '0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb';
  const witnessX = BigInt('0x73e7751db38d33fdcb72609c018812b5c7c5a900d14939715220390b174b2f26');
  const witnessY = BigInt('0x7839cfacec818101bc4a2635996b8400ae549e0eaed0f2810c274046068758e9');

  console.log('\nTxHash:', txHash);
  console.log('Witness X:', '0x' + witnessX.toString(16));
  console.log('Witness Y:', '0x' + witnessY.toString(16));

  console.log('\nExpected: witness + txHash*G = block2.accumulator');
}

checkBlock2().catch(console.error);
