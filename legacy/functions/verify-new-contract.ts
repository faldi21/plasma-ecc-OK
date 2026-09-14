import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function verifyContract() {
  const address = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  console.log('Verifying contract at:', address);

  const code = await publicClient.getBytecode({ address });

  if (!code || code === '0x') {
    console.log('❌ NO CONTRACT at this address!');
    console.log('   The address may be wrong or contract not deployed.');
    return;
  }

  console.log('✅ Contract exists');
  console.log(`   Bytecode size: ${code.length} bytes`);

  // Try to call a function to see if it works
  try {
    const currentBlock = await publicClient.readContract({
      address,
      abi: [{
        name: 'currentPlasmaBlock',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
      }],
      functionName: 'currentPlasmaBlock',
    });

    console.log(`✅ Contract is functional`);
    console.log(`   Current Plasma Block: ${currentBlock}`);

  } catch (error: any) {
    console.log('❌ Error calling contract function:', error.message.split('\n')[0]);
  }
}

verifyContract().catch(console.error);
