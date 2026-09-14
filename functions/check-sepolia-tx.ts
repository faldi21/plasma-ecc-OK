import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function checkTx() {
  const txHash = '0xa429c5dbaefa49811a28e707d2c00d82b5a345cd78d4695f0225f638defb418e' as `0x${string}`;

  console.log('Checking transaction:', txHash);
  console.log('');

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

    console.log('Transaction Receipt:');
    console.log('  Status:', receipt.status);
    console.log('  Block:', receipt.blockNumber);
    console.log('  Gas Used:', receipt.gasUsed);
    console.log('  From:', receipt.from);
    console.log('  To:', receipt.to);

    if (receipt.status === 'reverted') {
      console.log('\n❌ Transaction REVERTED');

      // Try to get the transaction to simulate it
      const tx = await publicClient.getTransaction({ hash: txHash });

      console.log('\nAttempting to simulate transaction to get revert reason...');

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
        if (error.shortMessage) {
          console.log('  ', error.shortMessage);
        }
        if (error.message) {
          console.log('  ', error.message.split('\n')[0]);
        }

        // Try to extract the actual error
        const errorMatch = error.message.match(/reverted with reason string '([^']+)'/);
        if (errorMatch) {
          console.log('\n🔍 Contract Error:', errorMatch[1]);
        }
      }
    } else {
      console.log('\n✅ Transaction SUCCESS!');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

checkTx().catch(console.error);
