import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function checkContract() {
  const address = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  console.log('Checking contract at:', address);

  const code = await publicClient.getBytecode({ address });

  if (!code || code === '0x') {
    console.log('❌ No contract deployed at this address!');
    console.log('   User may have provided wrong address or contract is not deployed.');
  } else {
    console.log('✅ Contract is deployed');
    console.log(`   Bytecode size: ${code.length} bytes`);
  }
}

checkContract().catch(console.error);
