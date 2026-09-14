/**
 * Final Withdrawal Test
 * Uses the correct txHash that has witness in backend
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));
const PlasmaTokenData = JSON.parse(fs.readFileSync('./backend/abi/PlasmaToken.json', 'utf8'));

const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
  PLASMA_TOKEN_ADDRESS: (process.env.PLASMA_TOKEN_ADDRESS || '0x') as `0x${string}`,
  PK_USER_A: process.env.PK_USER_A as `0x${string}`,
  WITHDRAW_AMOUNT: parseEther('2000'), // 2000 tokens (matching the deposit)
  // TxHash from latest accumulator - will be fetched dynamically
  TX_HASH: '' as `0x${string}`,
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== FINAL WITHDRAWAL TEST ===\n');

  // First, get txHash from accumulator
  console.log('--- Getting txHash from backend accumulator ---');
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();

  if (!elementsData.success || elementsData.size === 0) {
    console.error('❌ No transactions in accumulator');
    return;
  }

  // Use the latest txHash
  CONFIG.TX_HASH = elementsData.elements[elementsData.elements.length - 1];
  console.log(`✅ Using latest txHash from accumulator: ${CONFIG.TX_HASH}`);
  console.log(`   Total transactions in accumulator: ${elementsData.size}\n`);

  // Setup clients
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

  console.log(`User Address: ${account.address}`);
  console.log(`Root Chain: ${CONFIG.ROOT_CHAIN_ADDRESS}`);
  console.log(`Plasma Token: ${CONFIG.PLASMA_TOKEN_ADDRESS}`);
  console.log(`Withdraw Amount: ${formatEther(CONFIG.WITHDRAW_AMOUNT)} tokens`);
  console.log(`TxHash: ${CONFIG.TX_HASH}\n`);

  // Step 1: Get witness from backend
  console.log('--- Step 1: Get Witness from Backend ---');
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${CONFIG.TX_HASH}`);
  const witnessData = await witnessResp.json();

  if (!witnessData.success) {
    console.error(`❌ Failed to get witness: ${witnessData.error}`);
    return;
  }

  console.log(`✅ Witness obtained:`);
  console.log(`   X: ${witnessData.witness.x}`);
  console.log(`   Y: ${witnessData.witness.y}`);

  const witnessPoint = {
    x: BigInt(witnessData.witness.x),
    y: BigInt(witnessData.witness.y),
  };

  // Step 2: Check current L1 accumulator
  console.log('\n--- Step 2: Check L1 Accumulator ---');
  const currentBlock = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  const accValue = await publicClient.readContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log(`Current Plasma Block on L1: ${currentBlock}`);
  console.log(`L1 Accumulator Value:`);
  console.log(`   X: ${accValue.x}`);
  console.log(`   Y: ${accValue.y}`);

  // Step 3: Start Exit
  console.log('\n--- Step 3: Start Exit ---');
  const blockNumber = currentBlock; // Use current plasma block

  console.log(`Calling startExit with:`);
  console.log(`  Token: ${CONFIG.PLASMA_TOKEN_ADDRESS}`);
  console.log(`  Amount: ${formatEther(CONFIG.WITHDRAW_AMOUNT)}`);
  console.log(`  Block Number: ${blockNumber}`);
  console.log(`  TxHash: ${CONFIG.TX_HASH}`);
  console.log(`  Witness X: ${witnessPoint.x.toString().slice(0, 20)}...`);
  console.log(`  Witness Y: ${witnessPoint.y.toString().slice(0, 20)}...`);

  try {
    const exitTx = await walletClient.writeContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, CONFIG.TX_HASH, witnessPoint],
      gas: 500000n,
    });

    console.log(`\n📝 Exit transaction submitted: ${exitTx}`);
    console.log(`⏳ Waiting for confirmation...`);

    const exitReceipt = await publicClient.waitForTransactionReceipt({ hash: exitTx });

    console.log(`\n--- Result ---`);
    console.log(`TX Status: ${exitReceipt.status}`);
    console.log(`Gas Used: ${exitReceipt.gasUsed}`);

    if (exitReceipt.status === 'success') {
      console.log(`\n🎉🎉🎉 EXIT SUCCESSFUL! 🎉🎉🎉`);
      console.log(`\nWithdrawal initiated successfully!`);

      // Calculate exit ID
      const exitId = keccak256(
        encodePacked(
          ['address', 'address', 'uint256', 'bytes32'],
          [account.address, CONFIG.PLASMA_TOKEN_ADDRESS, blockNumber, CONFIG.TX_HASH]
        )
      );

      console.log(`\nExit ID: ${exitId}`);
      console.log(`\nNext steps:`);
      console.log(`1. Wait for challenge period (4 minutes)`);
      console.log(`2. Wait for exit period (7 minutes total)`);
      console.log(`3. Call finalizeExit(${exitId}) to withdraw funds`);

    } else {
      console.log(`\n❌ EXIT REVERTED`);
      console.log(`Please check the contract state and transaction details.`);
    }

  } catch (error: any) {
    console.error(`\n❌ Error during startExit: ${error.message}`);
    if (error.cause) {
      console.error(`Cause: ${error.cause}`);
    }
  }
}

main().catch(console.error);
