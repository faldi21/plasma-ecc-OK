/**
 * Test Withdrawal with Transaction #2 from Block 5
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
  PLASMA_TOKEN_ADDRESS: (process.env.PLASMA_TOKEN_ADDRESS || '0x') as `0x${string}`,
  PK_USER_A: process.env.PK_USER_A as `0x${string}`,
  WITHDRAW_AMOUNT: parseEther('2000'),
  // Second transaction from block 5
  TX_HASH: '0x247012effe7ac57510b2b040a8ba9f3583be410776b525958402350daeb6c116' as `0x${string}`,
};

async function main() {
  console.log('=== Testing Withdrawal with Transaction #2 ===\n');

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
  });

  const account = privateKeyToAccount(CONFIG.PK_USER_A);
  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
    account,
  });

  console.log(`TxHash: ${CONFIG.TX_HASH}\n`);

  // Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${CONFIG.TX_HASH}`);
  const witnessData = await witnessResp.json();

  if (!witnessData.success) {
    console.error(`❌ No witness available`);
    return;
  }

  console.log(`Witness X: ${witnessData.witness.x}`);
  console.log(`Witness Y: ${witnessData.witness.y}`);

  const witnessPoint = {
    x: BigInt(witnessData.witness.x),
    y: BigInt(witnessData.witness.y),
  };

  const blockNumber = 5n;

  try {
    const exitTx = await walletClient.writeContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, CONFIG.TX_HASH, witnessPoint],
      gas: 500000n,
    });

    console.log(`\n📝 Exit TX: ${exitTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: exitTx });

    if (receipt.status === 'success') {
      console.log(`\n🎉 SUCCESS!`);
    } else {
      console.log(`\n❌ REVERTED`);
    }

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
  }
}

main().catch(console.error);
