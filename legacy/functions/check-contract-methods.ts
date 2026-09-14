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

async function checkMethods() {
  const address = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  console.log('Checking contract at:', address);
  console.log('');

  // Check bytecode
  const code = await publicClient.getBytecode({ address });
  console.log('Bytecode size:', code?.length || 0, 'bytes');

  // List all functions in ABI
  const functions = RootChainData.abi.filter((item: any) => item.type === 'function');
  console.log('\nFunctions in ABI:', functions.length);
  console.log('');

  // Check specific functions
  const criticalFunctions = [
    'startExit',
    'finalizeExit',
    'submitBlock',
    'currentPlasmaBlock',
    'plasmaBlocks'
  ];

  console.log('Critical functions:');
  criticalFunctions.forEach(name => {
    const fn = functions.find((f: any) => f.name === name);
    if (fn) {
      console.log(`  ✅ ${name}`);
      if (name === 'startExit') {
        console.log(`     Inputs: ${fn.inputs.map((i: any) => i.type).join(', ')}`);
      }
    } else {
      console.log(`  ❌ ${name} - NOT FOUND`);
    }
  });

  // Try to read current block
  console.log('\nTrying to call currentPlasmaBlock...');
  try {
    const currentBlock = await publicClient.readContract({
      address,
      abi: RootChainData.abi,
      functionName: 'currentPlasmaBlock',
    });
    console.log('✅ Current block:', currentBlock);
  } catch (error: any) {
    console.log('❌ Error:', error.message.split('\n')[0]);
  }

  // Try to read block data
  console.log('\nTrying to read plasmaBlocks(2)...');
  try {
    const blockData = await publicClient.readContract({
      address,
      abi: RootChainData.abi,
      functionName: 'plasmaBlocks',
      args: [2n],
    });
    console.log('✅ Block 2 data:', blockData);
  } catch (error: any) {
    console.log('❌ Error:', error.message.split('\n')[0]);
  }
}

checkMethods().catch(console.error);
