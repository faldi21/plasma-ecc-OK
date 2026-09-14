/**
 * Challenge Withdrawal Test Script
 * 
 * Scenario: User B challenges User A's withdrawal
 * 
 * Timeline:
 * - T=0: User A calls startExit()
 * - T=0-4 min: User B can challenge (OPEN)
 * - T=4-7 min: Cannot challenge anymore (CLOSED)
 * - T=7+ min: User A can finalize if no challenge
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
  ROOT_CHAIN_ADDRESS: process.env.ROOT_CHAIN_ADDRESS || '0x...',
  PLASMA_TOKEN_ADDRESS: process.env.PLASMA_TOKEN_ADDRESS || '0x...',
  USER_A_ADDRESS: process.env.USER_A_ADDRESS || '0x...', // Withdrawing user
  USER_B_PRIVATE_KEY: process.env.USER_B_PRIVATE_KEY || '0x...', // Challenging user
  CHALLENGE_AFTER_MINUTES: 2, // Challenge after 2 minutes (within 4-min window)
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentTimestamp(provider) {
  const block = await provider.getBlock('latest');
  return block.timestamp;
}

async function waitForExitStartedEvent(rootChain, userAAddress) {
  return new Promise((resolve) => {
    const filter = rootChain.filters.ExitStarted(userAAddress);
    rootChain.once(filter, (exitId, user, amount, event) => {
      console.log(`\n📡 Detected ExitStarted event:`);
      console.log(`   Exit ID: ${exitId}`);
      console.log(`   User: ${user}`);
      console.log(`   Amount: ${ethers.formatEther(amount)}`);
      resolve({ exitId, user, amount });
    });
  });
}

async function main() {
  try {
    console.log('=== Plasma Challenge Withdrawal Test ===\n');

    // Setup providers and signers
    const provider = new ethers.JsonRpcProvider(CONFIG.L1_RPC);
    const userB = new ethers.Wallet(CONFIG.USER_B_PRIVATE_KEY, provider);

    console.log(`User B Address (Challenger): ${userB.address}`);
    console.log(`User A Address (Withdrawer): ${CONFIG.USER_A_ADDRESS}`);
    console.log(`Root Chain: ${CONFIG.ROOT_CHAIN_ADDRESS}\n`);

    // Connect to contracts
    const rootChain = new ethers.Contract(CONFIG.ROOT_CHAIN_ADDRESS, RootChainABI, userB);
    const plasmaToken = new ethers.Contract(CONFIG.PLASMA_TOKEN_ADDRESS, PlasmaTokenABI, userB);

    console.log('--- Setup Event Listeners ---');
    console.log('Waiting for ExitStarted event from User A...\n');

    // Wait for User A to start exit (this runs separately)
    // In practice, run withdraw-test.js in another terminal
    const exitData = await Promise.race([
      waitForExitStartedEvent(rootChain, CONFIG.USER_A_ADDRESS),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout waiting for ExitStarted event')), 120000)
      )
    ]);

    const { exitId, user, amount } = exitData;

    // Get current exit state
    console.log('\n--- Checking Exit State ---');
    const exitRecord = await rootChain.exits(exitId);
    console.log(`Exit Status:`);
    console.log(`  - Owner: ${exitRecord.owner}`);
    console.log(`  - Amount: ${ethers.formatEther(exitRecord.amount)}`);
    console.log(`  - Exit Time: ${exitRecord.exitTime}`);
    console.log(`  - Challenged: ${exitRecord.challenged}`);

    const currentTime = await getCurrentTimestamp(provider);
    const challengePeriodEnd = exitRecord.exitTime + 4 * 60; // 4 minutes from start
    const timeUntilChallengeClose = challengePeriodEnd - currentTime;

    console.log(`\nCurrent Time: ${currentTime}`);
    console.log(`Challenge Period Ends At: ${challengePeriodEnd}`);
    console.log(`Time Until Challenge Window Closes: ${timeUntilChallengeClose} seconds`);

    // Check if challenge window is still open
    if (timeUntilChallengeClose <= 0) {
      console.log('\n❌ Challenge period already closed! Cannot challenge.');
      return;
    }

    // Step 1: Wait before challenging
    console.log(`\n--- Step 1: Wait ${CONFIG.CHALLENGE_AFTER_MINUTES} minutes before challenging ---`);
    for (let i = 0; i < CONFIG.CHALLENGE_AFTER_MINUTES; i++) {
      console.log(`⏳ Waiting... ${i + 1}/${CONFIG.CHALLENGE_AFTER_MINUTES} minutes`);
      await sleep(60000);
    }

    // Step 2: Verify still in challenge window
    console.log('\n--- Step 2: Verify Challenge Window Still Open ---');
    const timeBeforeChallenge = await getCurrentTimestamp(provider);
    const windowRemaining = challengePeriodEnd - timeBeforeChallenge;
    
    console.log(`Current Time: ${timeBeforeChallenge}`);
    console.log(`Time Until Window Closes: ${windowRemaining} seconds`);
    
    if (windowRemaining <= 0) {
      console.log('❌ Challenge window closed! Too late to challenge.');
      return;
    }

    console.log('✅ Still within challenge window\n');

    // Step 3: Submit challenge
    // In real scenario, include:
    // - Fraud proof showing User A's exit is invalid
    // - Conflicting transaction or state reference
    console.log('--- Step 3: Submit Challenge ---');
    
    const fraudProof = '0x'; // Placeholder - would be actual fraud proof
    const conflictingTxIndex = 0; // Index showing conflict
    
    console.log(`Submitting challenge for Exit ID: ${exitId}`);
    console.log(`Challenger: ${userB.address}`);

    const tx = await rootChain.challengeExit(
      exitId,
      conflictingTxIndex,
      fraudProof,
      { gasLimit: 500000 }
    );

    const receipt = await tx.wait();
    console.log(`✅ Challenge submitted - TX: ${receipt.hash}`);

    // Step 4: Verify exit is now challenged
    console.log('\n--- Step 4: Verify Exit State ---');
    const updatedExitRecord = await rootChain.exits(exitId);
    console.log(`Exit Challenged: ${updatedExitRecord.challenged}`);

    if (updatedExitRecord.challenged) {
      console.log('✅ Exit successfully challenged! User A cannot withdraw.');
      console.log('\nChallenge Details:');
      console.log(`  - Original Amount: ${ethers.formatEther(updatedExitRecord.amount)}`);
      console.log(`  - Challenger: ${userB.address}`);
      
      // Check User B's reward (if applicable)
      const challengerBalance = await plasmaToken.balanceOf(userB.address);
      console.log(`  - Challenger Balance: ${ethers.formatEther(challengerBalance)}`);
    } else {
      console.log('⚠️  Challenge may have failed or exit already finalized');
    }

    // Step 5: Attempt to finalize (should fail)
    console.log('\n--- Step 5: Test - Attempt to Finalize (should fail) ---');
    console.log('Waiting for exit period to complete...');
    
    const remainingWait = 7 * 60 - (await getCurrentTimestamp(provider) - exitRecord.exitTime);
    for (let i = 0; i < Math.ceil(remainingWait / 60); i++) {
      console.log(`⏳ Waiting... ${i + 1}/${Math.ceil(remainingWait / 60)} minutes`);
      await sleep(60000);
    }

    console.log('\nAttempting to finalize exit...');
    try {
      const finalizeTx = await rootChain.finalizeExit(exitId, { gasLimit: 500000 });
      await finalizeTx.wait();
      console.log('⚠️  Exit finalized (may have been valid despite challenge)');
    } catch (error) {
      console.log(`✅ Finalization blocked (as expected): ${error.reason || error.message}`);
    }

    console.log('\n=== Challenge Test Complete ===');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.reason) console.error('Reason:', error.reason);
    process.exit(1);
  }
}

main();
