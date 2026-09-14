import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function checkRevert() {
  const txHash = '0x94ef5b2b4ebb8fa63d868891ecd1901604026e5b08db3c8ead7db2c0c0c05c10' as `0x${string}`;

  console.log('Checking reverted transaction:', txHash);
  console.log('');

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

    console.log('Transaction Receipt:');
    console.log('  Status:', receipt.status);
    console.log('  Gas Used:', receipt.gasUsed);
    console.log('  Gas Limit:', receipt.cumulativeGasUsed);

    if (receipt.status === 'reverted') {
      console.log('\n❌ Transaction REVERTED\n');

      // Get the transaction to simulate it
      const tx = await publicClient.getTransaction({ hash: txHash });

      console.log('Simulating transaction to get revert reason...\n');

      try {
        await publicClient.call({
          to: tx.to!,
          data: tx.input,
          from: tx.from,
          value: tx.value,
          gas: tx.gas,
        });
      } catch (error: any) {
        console.log('Revert Details:');

        if (error.shortMessage) {
          console.log('  Short:', error.shortMessage);
        }

        // Extract contract error
        const causeMsg = error.cause?.message || error.message;
        console.log('\nFull error message:');
        console.log(causeMsg);

        // Try to find specific revert reason
        if (causeMsg.includes('Invalid transaction proof')) {
          console.log('\n🔍 Revert Reason: Invalid transaction proof');
          console.log('   The witness verification failed in the contract.');
        } else if (causeMsg.includes('Invalid block')) {
          console.log('\n🔍 Revert Reason: Invalid block');
        } else if (causeMsg.includes('Invalid amount')) {
          console.log('\n🔍 Revert Reason: Invalid amount');
        }
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

checkRevert().catch(console.error);
