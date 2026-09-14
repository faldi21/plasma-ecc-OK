/**
 * Withdraw Test Script
 * 
 * Timeline:
 * - T=0: startExit() - User A initiates withdrawal
 * - T=0-4 min: Challenge period OPEN - User B can challenge
 * - T=4-7 min: Challenge period CLOSED - No more challenges allowed
 * - T=7+ min: User A can finalizeExit() and withdraw funds
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// Contract ABIs
const RootChainABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/abi/RootChain.json'), 'utf8'));
const PlasmaTokenABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/abi/PlasmaToken.json'), 'utf8'));

// Configuration
const CONFIG = {
  L1_RPC: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY', // or use Anvil for local
  ROOT_CHAIN_ADDRESS: process.env.ROOT_CHAIN_ADDRESS || '0x...', // from .env
  PLASMA_TOKEN_ADDRESS: process.env.PLASMA_TOKEN_ADDRESS || '0x...',
  USER_A_PRIVATE_KEY: process.env.USER_A_PRIVATE_KEY || '0x...', // User doing withdrawal
  WITHDRAW_AMOUNT: ethers.parseEther('10'), // 10 tokens
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentTimestamp(provider) {
  const block = await provider.getBlock('latest');
  return block.timestamp;
}

async function main() {
  try {
    console.log('=== Plasma Withdrawal Test ===\n');

    // Setup providers and signers
    const provider = new ethers.JsonRpcProvider(CONFIG.L1_RPC);
    const userA = new ethers.Wallet(CONFIG.USER_A_PRIVATE_KEY, provider);

    console.log(`User A Address: ${userA.address}`);
    console.log(`Root Chain: ${CONFIG.ROOT_CHAIN_ADDRESS}`);
    console.log(`Withdraw Amount: ${ethers.formatEther(CONFIG.WITHDRAW_AMOUNT)} tokens\n`);

    // Connect to contracts
    const rootChain = new ethers.Contract(CONFIG.ROOT_CHAIN_ADDRESS, RootChainABI, userA);
    const plasmaToken = new ethers.Contract(CONFIG.PLASMA_TOKEN_ADDRESS, PlasmaTokenABI, userA);

    // Step 1: Check balance
    console.log('--- Step 1: Check User A Balance ---');
    const balance = await plasmaToken.balanceOf(userA.address);
    console.log(`Current Balance: ${ethers.formatEther(balance)} tokens`);

    if (balance < CONFIG.WITHDRAW_AMOUNT) {
      console.log('❌ Insufficient balance for withdrawal');
      return;
    }

    // Step 2: Create transaction proof (simplified - in real scenario, need valid proof from L2)
    console.log('\n--- Step 2: Create Withdrawal Request ---');
    
    // In real scenario:
    // 1. Get transaction from L2 PlasmaChain
    // 2. Create Merkle proof using ECC accumulator
    // 3. Pass actual transaction proof to startExit()
    
    const blockNumber = 1;  // L2 block number where withdrawal occurred
    const txIndex = 0;      // Transaction index in block
    const proof = '0x'; // Placeholder - would be actual ECC proof
    
    console.log(`Creating exit for:`);
    console.log(`  - L2 Block: ${blockNumber}`);
    console.log(`  - TX Index: ${txIndex}`);
    console.log(`  - Amount: ${ethers.formatEther(CONFIG.WITHDRAW_AMOUNT)}`);

    // Step 3: Start Exit
    console.log('\n--- Step 3: Initiate Exit (startExit) ---');
    const startTime = await getCurrentTimestamp(provider);
    console.log(`Current Time: ${startTime}`);
    console.log(`Challenge Period Ends At: ${startTime + 4 * 60} (in 4 minutes)`);
    console.log(`Exit Period Ends At: ${startTime + 7 * 60} (in 7 minutes)`);

    let tx = await rootChain.startExit(
      blockNumber,
      txIndex,
      CONFIG.WITHDRAW_AMOUNT,
      proof,
      { gasLimit: 500000 }
    );

    const receipt = await tx.wait();
    console.log(`✅ Exit started - TX: ${receipt.hash}`);

    // Step 4: Get exit ID
    const exitId = receipt.logs[0]?.topics[1]; // ExitStarted event
    console.log(`Exit ID: ${exitId}`);

    // Step 5: Wait for challenge period to close
    console.log('\n--- Step 4: Wait for Challenge Period (4 minutes) ---');
    for (let i = 0; i < 4; i++) {
      console.log(`⏳ Waiting... ${i + 1}/4 minutes`);
      await sleep(60000); // Wait 1 minute
    }

    // Step 6: Wait for exit period to complete
    console.log('\n--- Step 5: Wait for Exit Period (3 more minutes) ---');
    for (let i = 0; i < 3; i++) {
      console.log(`⏳ Waiting... ${i + 1}/3 minutes`);
      await sleep(60000); // Wait 1 minute
    }

    // Step 7: Finalize Exit
    console.log('\n--- Step 6: Finalize Exit (finalizeExit) ---');
    const currentTime = await getCurrentTimestamp(provider);
    console.log(`Current Time: ${currentTime}`);
    console.log(`Exit Period Should Be Over: ${currentTime >= startTime + 7 * 60}`);

    tx = await rootChain.finalizeExit(exitId, { gasLimit: 500000 });
    const finalizeReceipt = await tx.wait();
    console.log(`✅ Exit finalized - TX: ${finalizeReceipt.hash}`);

    // Step 8: Check final balance
    console.log('\n--- Step 7: Check Final Balance ---');
    const finalBalance = await plasmaToken.balanceOf(userA.address);
    console.log(`Final Balance: ${ethers.formatEther(finalBalance)} tokens`);
    console.log(`Withdrawn Amount: ${ethers.formatEther(CONFIG.WITHDRAW_AMOUNT)} tokens`);

    const expectedBalance = balance + CONFIG.WITHDRAW_AMOUNT;
    if (finalBalance === expectedBalance) {
      console.log('✅ Withdrawal successful!');
    } else {
      console.log('⚠️  Balance mismatch');
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.reason) console.error('Reason:', error.reason);
    process.exit(1);
  }
}

main();
