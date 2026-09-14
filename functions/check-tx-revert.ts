import { createPublicClient, http, decodeErrorResult } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function checkTxRevert() {
  const txHash = '0xe27de5ce60245d9e5720ab7bfd3a563711ba7f9ac6a3fa062875c6c7dbff7ac0' as `0x${string}`;

  console.log('Checking transaction:', txHash);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  console.log('Status:', receipt.status);
  console.log('Gas used:', receipt.gasUsed);

  if (receipt.status === 'reverted') {
    console.log('\nTransaction reverted. Trying to get revert reason...');

    try {
      const tx = await publicClient.getTransaction({ hash: txHash });
      console.log('\nTransaction data:');
      console.log('  From:', tx.from);
      console.log('  To:', tx.to);
      console.log('  Value:', tx.value);
      console.log('  Gas:', tx.gas);

      // Try to simulate the transaction to get the error
      try {
        await publicClient.call({
          to: tx.to!,
          data: tx.input,
          from: tx.from,
          value: tx.value,
          gas: tx.gas,
        });
      } catch (error: any) {
        console.log('\nRevert reason:');
        console.log(error.message);

        if (error.data) {
          try {
            const decoded = decodeErrorResult({
              abi: RootChainData.abi,
              data: error.data,
            });
            console.log('Decoded error:', decoded);
          } catch (e) {
            console.log('Could not decode error data');
          }
        }
      }
    } catch (e: any) {
      console.error('Error getting tx details:', e.message);
    }
  }
}

checkTxRevert().catch(console.error);
