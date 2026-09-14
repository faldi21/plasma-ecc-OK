import { createPublicClient, http } from 'viem';
import { localhost } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
  L2_RPC_URL: process.env.L2_RPC_URL || 'http://localhost:8545',
  L2_PLASMA_CHAIN_ADDRESS: (process.env.L2_PLASMA_CHAIN_ADDRESS || '0x') as `0x${string}`,
};

async function main() {
  const publicClient = createPublicClient({
    chain: localhost,
    transport: http(CONFIG.L2_RPC_URL),
  });

  console.log('=== Scanning ALL L2 Transactions to PlasmaChain ===\n');

  const latestBlock = await publicClient.getBlockNumber();
  console.log(`Latest L2 Block: ${latestBlock}\n`);

  console.log(`Scanning ALL blocks from 0 to ${latestBlock}...\n`);

  const allTxs: any[] = [];

  for (let i = 0n; i <= latestBlock; i++) {
    const block = await publicClient.getBlock({
      blockNumber: i,
      includeTransactions: true,
    });

    for (const tx of block.transactions as any[]) {
      if (tx.to?.toLowerCase() === CONFIG.L2_PLASMA_CHAIN_ADDRESS.toLowerCase()) {
        allTxs.push({
          txHash: tx.hash,
          blockNumber: block.number,
          from: tx.from,
          to: tx.to,
          input: tx.input.slice(0, 66), // First 66 chars (function selector + some data)
        });
      }
    }

    // Progress indicator every 10 blocks
    if (i % 10n === 0n && i > 0n) {
      process.stdout.write(`  Scanned ${i} blocks...\r`);
    }
  }

  console.log(`\nFound ${allTxs.length} transactions to PlasmaChain:\n`);

  // Show last 10 transactions
  for (const tx of allTxs.slice(-10)) {
    console.log(`TxHash: ${tx.txHash}`);
    console.log(`  Block: ${tx.blockNumber}`);
    console.log(`  From:  ${tx.from}`);

    // Try to get witness from backend
    try {
      const witnessResp = await fetch(`http://localhost:3001/api/witness/${tx.txHash}`);
      const witnessData = await witnessResp.json();
      if (witnessData.success) {
        console.log(`  ✅ HAS WITNESS in backend! <-- USE THIS ONE`);
      } else {
        console.log(`  ❌ No witness: ${witnessData.error}`);
      }
    } catch (error: any) {
      console.log(`  ⚠️  Error checking witness: ${error.message}`);
    }
    console.log('');
  }
}

main().catch(console.error);
