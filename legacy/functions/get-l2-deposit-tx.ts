import { createPublicClient, http } from 'viem';
import { localhost } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const PlasmaChainData = JSON.parse(
  fs.readFileSync('./backend/abi/PlasmaChain.json', 'utf8')
);

const PlasmaTokenData = JSON.parse(
  fs.readFileSync('./backend/abi/PlasmaToken.json', 'utf8')
);

const CONFIG = {
  L2_RPC_URL: process.env.L2_RPC_URL || 'http://localhost:8545',
  L2_PLASMA_CHAIN_ADDRESS: (process.env.L2_PLASMA_CHAIN_ADDRESS || '0x') as `0x${string}`,
  L2_PLASMA_TOKEN_ADDRESS: (process.env.L2_PLASMA_TOKEN_ADDRESS || '0x') as `0x${string}`,
  USER_ADDRESS: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as `0x${string}`, // User A
};

async function main() {
  const publicClient = createPublicClient({
    chain: localhost,
    transport: http(CONFIG.L2_RPC_URL),
  });

  console.log('=== Getting L2 Deposit Transactions ===\n');

  // Check BalanceUpdated events on PlasmaChain
  try {
    const balanceEvents = await publicClient.getLogs({
      address: CONFIG.L2_PLASMA_CHAIN_ADDRESS,
      event: {
        type: 'event',
        name: 'BalanceUpdated',
        inputs: [
          { type: 'address', indexed: true, name: 'user' },
          { type: 'address', indexed: true, name: 'token' },
          { type: 'uint256', indexed: false, name: 'newBalance' }
        ]
      },
      fromBlock: 0n,
      toBlock: 'latest',
    });

    console.log(`Found ${balanceEvents.length} BalanceUpdated events\n`);

    for (const event of balanceEvents.slice(-5)) { // Last 5 events
      console.log(`Event:`);
      console.log(`  User: ${event.args.user}`);
      console.log(`  Token: ${event.args.token}`);
      console.log(`  New Balance: ${event.args.newBalance}`);
      console.log(`  TxHash: ${event.transactionHash}`);
      console.log(`  Block: ${event.blockNumber}`);
      console.log('');
    }
  } catch (error: any) {
    console.log('Error getting BalanceUpdated events:', error.message);
  }

  // Check Transfer events on PlasmaToken (minting)
  try {
    const transferEvents = await publicClient.getLogs({
      address: CONFIG.L2_PLASMA_TOKEN_ADDRESS,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { type: 'address', indexed: true, name: 'from' },
          { type: 'address', indexed: true, name: 'to' },
          { type: 'uint256', indexed: false, name: 'value' }
        ]
      },
      args: {
        to: CONFIG.USER_ADDRESS, // Transfers TO user
      },
      fromBlock: 0n,
      toBlock: 'latest',
    });

    console.log(`\nFound ${transferEvents.length} Transfer events to User A\n`);

    for (const event of transferEvents.slice(-5)) { // Last 5 events
      console.log(`Transfer Event:`);
      console.log(`  From: ${event.args.from}`);
      console.log(`  To: ${event.args.to}`);
      console.log(`  Value: ${event.args.value}`);
      console.log(`  TxHash: ${event.transactionHash}`);
      console.log(`  Block: ${event.blockNumber}`);
      console.log('');
    }

    // Get the latest transfer txHash
    if (transferEvents.length > 0) {
      const latestTx = transferEvents[transferEvents.length - 1];
      console.log(`\n🎯 Latest deposit TxHash on L2: ${latestTx.transactionHash}`);
      console.log(`   Use this TxHash for withdrawal!`);
    }
  } catch (error: any) {
    console.log('Error getting Transfer events:', error.message);
  }
}

main().catch(console.error);
