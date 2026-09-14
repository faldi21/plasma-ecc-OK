import { createPublicClient, http, decodeAbiParameters, parseAbiParameters } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
};

async function main() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
  });

  console.log('=== Decoding submitBlock Transaction (Block 5) ===\n');

  // Block 5 submitBlock txHash (from earlier query)
  const submitTxHash = '0x719385e13933508924766b5d689a43dbda61c6afc0c2264ec020f45b8ba475d2' as `0x${string}`;

  // Get transaction
  const tx = await publicClient.getTransaction({ hash: submitTxHash });

  console.log(`Transaction: ${submitTxHash}`);
  console.log(`From: ${tx.from}`);
  console.log(`To: ${tx.to}`);
  console.log(`Block: ${tx.blockNumber}`);

  // Function selector for submitBlock: first 4 bytes (8 hex chars + 0x)
  const functionSelector = tx.input.slice(0, 10);
  console.log(`\nFunction Selector: ${functionSelector}`);

  // Remove function selector, decode parameters
  const params = ('0x' + tx.input.slice(10)) as `0x${string}`;

  // submitBlock parameters: (Point memory accumulatorValue, uint256 transactionCount, bytes32[] memory transactionHashes)
  // Point is a tuple of (uint256 x, uint256 y)

  try {
    const decoded = decodeAbiParameters(
      parseAbiParameters('(uint256, uint256), uint256, bytes32[]'),
      params
    );

    const accumulatorValue = decoded[0];
    const transactionCount = decoded[1];
    const transactionHashes = decoded[2];

    console.log(`\nDecoded Parameters:`);
    console.log(`  Accumulator Value:`);
    console.log(`    X: ${accumulatorValue[0]}`);
    console.log(`    Y: ${accumulatorValue[1]}`);
    console.log(`  Transaction Count: ${transactionCount}`);
    console.log(`  Transaction Hashes (${transactionHashes.length}):`);

    for (let i = 0; i < transactionHashes.length; i++) {
      console.log(`    ${i + 1}. ${transactionHashes[i]}`);

      // Check if this txHash has witness in backend
      try {
        const witnessResp = await fetch(`http://localhost:3001/api/witness/${transactionHashes[i]}`);
        const witnessData = await witnessResp.json();

        if (witnessData.success) {
          console.log(`       ✅ HAS WITNESS - USE THIS FOR WITHDRAWAL!`);
          console.log(`       Witness X: ${witnessData.witness.x}`);
          console.log(`       Witness Y: ${witnessData.witness.y}`);
        } else {
          console.log(`       ❌ No witness: ${witnessData.error}`);
        }
      } catch (e) {
        console.log(`       ⚠️  Error checking witness`);
      }
    }

  } catch (error: any) {
    console.error('\nError decoding parameters:', error.message);
    console.log('\nRaw input data (first 200 chars):');
    console.log(tx.input.slice(0, 200));
  }
}

main().catch(console.error);
