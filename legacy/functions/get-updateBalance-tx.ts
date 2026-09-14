import { createPublicClient, http } from 'viem';
import { localhost } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
  L2_RPC_URL: process.env.L2_RPC_URL || 'http://localhost:8545',
  L2_PLASMA_CHAIN_ADDRESS: (process.env.L2_PLASMA_CHAIN_ADDRESS || '0x') as `0x${string}`,
  USER_ADDRESS: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as `0x${string}`,
};

async function main() {
  const publicClient = createPublicClient({
    chain: localhost,
    transport: http(CONFIG.L2_RPC_URL),
  });

  console.log('=== Getting updateBalance Transactions ===\n');

  // Get all transactions to PlasmaChain contract
  const latestBlock = await publicClient.getBlockNumber();
  console.log(`Latest L2 Block: ${latestBlock}\n`);

  // Get last 10 blocks and find updateBalance transactions
  const startBlock = latestBlock - 20n < 0n ? 0n : latestBlock - 20n;

  console.log(`Scanning blocks ${startBlock} to ${latestBlock}...\n`);

  const updateBalanceTxs: any[] = [];

  for (let i = startBlock; i <= latestBlock; i++) {
    const block = await publicClient.getBlock({
      blockNumber: i,
      includeTransactions: true,
    });

    for (const tx of block.transactions as any[]) {
      if (tx.to?.toLowerCase() === CONFIG.L2_PLASMA_CHAIN_ADDRESS.toLowerCase()) {
        // Check if it's updateBalance (function selector: first 4 bytes)
        const functionSelector = tx.input.slice(0, 10);

        // updateBalance signature: 0x2ab50c93
        if (functionSelector === '0x2ab50c93') {
          updateBalanceTxs.push({
            txHash: tx.hash,
            blockNumber: block.number,
            from: tx.from,
            input: tx.input,
          });
        }
      }
    }
  }

  console.log(`Found ${updateBalanceTxs.length} updateBalance transactions:\n`);

  for (const tx of updateBalanceTxs.slice(-5)) { // Last 5
    console.log(`TxHash: ${tx.txHash}`);
    console.log(`  Block: ${tx.blockNumber}`);
    console.log(`  From:  ${tx.from}`);

    // Try to get witness from backend
    const witnessResp = await fetch(`http://localhost:3001/api/witness/${tx.txHash}`).catch(() => null);
    if (witnessResp) {
      const witnessData = await witnessResp.json();
      if (witnessData.success) {
        console.log(`  ✅ HAS WITNESS in backend!`);
      } else {
        console.log(`  ❌ No witness`);
      }
    }
    console.log('');
  }

  if (updateBalanceTxs.length > 0) {
    const latestTx = updateBalanceTxs[updateBalanceTxs.length - 1];
    console.log(`\n🎯 Latest updateBalance TxHash: ${latestTx.txHash}`);
    console.log(`   Use this for withdrawal test!`);

    // Test witness
    const witnessResp = await fetch(`http://localhost:3001/api/witness/${latestTx.txHash}`);
    const witnessData = await witnessResp.json();

    if (witnessData.success) {
      console.log(`\n✅ Witness available!`);
      console.log(`   X: ${witnessData.witness.x}`);
      console.log(`   Y: ${witnessData.witness.y}`);
    } else {
      console.log(`\n❌ No witness available: ${witnessData.error}`);
    }
  }
}

main().catch(console.error);
