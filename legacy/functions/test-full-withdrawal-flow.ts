/**
 * Complete Withdrawal Test Flow
 * This script performs a full end-to-end test:
 * 1. Makes a deposit
 * 2. Waits for relay to process
 * 3. Waits for backend to create block
 * 4. Gets the txHash from backend
 * 5. Performs withdrawal with proper witness
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
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
  WITHDRAW_AMOUNT: parseEther('100'), // 100 tokens
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== COMPLETE WITHDRAWAL TEST FLOW ===\n');

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

  console.log(`User Address: ${account.address}\n`);

  // Since you already made a deposit, let's skip step 1-3 and go directly to step 4

  console.log('--- Step 1: Get Current Backend Accumulator State ---');
  const accState = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accState.json();
  console.log(`Backend Accumulator Size: ${accData.size}`);
  console.log(`Backend Accumulator Value:`);
  console.log(`  X: ${accData.accumulator.x}`);
  console.log(`  Y: ${accData.accumulator.y}`);

  // Since backend has 3 elements, we need to manually add a new transaction
  // and see what txHash the relay sent

  console.log('\n--- Step 2: Make New Deposit ---');
  console.log('Making 100 token deposit...');

  // Approve tokens
  const approveTx = await walletClient.writeContract({
    address: CONFIG.PLASMA_TOKEN_ADDRESS,
    abi: PlasmaTokenData.abi,
    functionName: 'approve',
    args: [CONFIG.ROOT_CHAIN_ADDRESS, CONFIG.WITHDRAW_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log('✅ Tokens approved');

  // Deposit
  const depositTx = await walletClient.writeContract({
    address: CONFIG.ROOT_CHAIN_ADDRESS,
    abi: RootChainData.abi,
    functionName: 'deposit',
    args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  console.log(`✅ Deposit successful! L1 TxHash: ${depositTx}`);

  console.log('\n--- Step 3: Wait for Relay (70 seconds) ---');
  for (let i = 0; i < 7; i++) {
    await sleep(10000);
    console.log(`  ${(i + 1) * 10} seconds...`);
  }

  console.log('\n--- Step 4: Check Pending Transactions ---');
  const pendingResp = await fetch('http://localhost:3001/api/pending-transactions');
  const pendingData = await pendingResp.json();
  console.log(`Pending Transactions: ${pendingData.count}`);

  if (pendingData.count > 0) {
    console.log('Transactions:');
    pendingData.transactions.forEach((tx: any, idx: number) => {
      console.log(`  ${idx + 1}. TxHash: ${tx.txHash}`);
      console.log(`     Type: ${tx.type}`);
      console.log(`     From: ${tx.from}`);
      console.log(`     To: ${tx.to}`);
      console.log(`     Amount: ${tx.amount}`);
    });

    // Use the FIRST pending transaction txHash
    const targetTxHash = pendingData.transactions[0].txHash;
    console.log(`\n🎯 Target TxHash for withdrawal: ${targetTxHash}`);

    console.log('\n--- Step 5: Wait for Block Creation (auto or manual) ---');
    console.log('Waiting 30 seconds for automatic block creation...');
    await sleep(30000);

    // Check if block was created
    const accState2 = await fetch('http://localhost:3001/api/accumulator/value');
    const accData2 = await accState2.json();

    if (accData2.size > accData.size) {
      console.log(`✅ Block created! Accumulator size: ${accData.size} → ${accData2.size}`);
    } else {
      console.log('⚠️  Block not auto-created, creating manually...');
      const createBlockResp = await fetch('http://localhost:3001/api/create-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const blockData = await createBlockResp.json();
      console.log('Block creation response:', blockData);
    }

    console.log('\n--- Step 6: Get Witness for Transaction ---');
    const witnessResp = await fetch(`http://localhost:3001/api/witness/${targetTxHash}`);
    const witnessData = await witnessResp.json();

    if (!witnessData.success) {
      console.error(`❌ Failed to get witness: ${witnessData.error}`);
      console.log('\nDebugging info:');
      console.log('1. Check if txHash was added to accumulator');
      console.log('2. Backend accumulator size:', accData2.size);
      console.log('3. Try restarting the flow or checking backend logs');
      return;
    }

    console.log(`✅ Witness obtained:`);
    console.log(`  X: ${witnessData.witness.x}`);
    console.log(`  Y: ${witnessData.witness.y}`);

    console.log('\n--- Step 7: Start Exit ---');
    const witnessPoint = {
      x: BigInt(witnessData.witness.x),
      y: BigInt(witnessData.witness.y),
    };

    const blockNumber = 1n; // Using block 1 for simplicity

    const exitTx = await walletClient.writeContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, targetTxHash, witnessPoint],
      gas: 500000n,
    });

    console.log(`📝 Exit transaction submitted: ${exitTx}`);
    const exitReceipt = await publicClient.waitForTransactionReceipt({ hash: exitTx });

    if (exitReceipt.status === 'success') {
      console.log(`✅ EXIT SUCCESSFUL!`);
      console.log(`   Gas Used: ${exitReceipt.gasUsed}`);
      console.log('\n🎉 WITHDRAWAL TEST PASSED! 🎉');
    } else {
      console.log(`❌ EXIT REVERTED`);
      console.log(`   Status: ${exitReceipt.status}`);
    }

  } else {
    console.log('❌ No pending transactions found. Relay may not have processed the deposit yet.');
    console.log('   Try waiting longer or check relay logs.');
  }
}

main().catch(console.error);
