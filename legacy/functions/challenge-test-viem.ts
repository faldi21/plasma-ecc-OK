/**
 * Challenge Withdrawal Test Script (Viem Version)
 * 
 * Scenario: User B challenges User A's withdrawal
 * 
 * Timeline:
 * - T=0: User A calls startExit()
 * - T=0-4 min: User B can challenge (OPEN)
 * - T=4-7 min: Cannot challenge anymore (CLOSED)
 * - T=7+ min: User A can finalize if no challenge
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getContract,
  PublicClient,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Contract ABIs
const RootChainData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/abi/RootChain.json'), 'utf8')
);
const PlasmaTokenData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/abi/PlasmaToken.json'), 'utf8')
);
const RootChainABI = RootChainData.abi || RootChainData;
const PlasmaTokenABI = PlasmaTokenData.abi || PlasmaTokenData;

// Configuration from .env
const CONFIG = {
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL || '',
  SEPOLIA_WSS_URL: process.env.SEPOLIA_WSS_URL || '',
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
  PLASMA_TOKEN_ADDRESS: (process.env.PLASMA_TOKEN_ADDRESS || '0x') as `0x${string}`,
  USER_A_ADDRESS: (process.env.USER_A_ADDRESS || '0x') as `0x${string}`, // User yang withdraw
  PK_USER_B: process.env.PK_USER_B as `0x${string}`, // User B (challenger)
  CHALLENGE_AFTER_MINUTES: 2, // Challenge after 2 minutes (within 4-min window)
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentTimestamp(publicClient: PublicClient): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function watchExitStarted(
  publicClient: PublicClient,
  userAddress: `0x${string}`
): Promise<{ exitId: string; user: string; amount: bigint }> {
  return new Promise(async (resolve, reject) => {
    try {
      // Set timeout
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for ExitStarted event (2 minutes)'));
      }, 120000);

      // Poll for recent blocks
      const interval = setInterval(async () => {
        try {
          const logs = await publicClient.getLogs({
            address: CONFIG.ROOT_CHAIN_ADDRESS,
            event: RootChainABI.find((item: any) => item.name === 'ExitStarted'),
            fromBlock: 'latest',
            toBlock: 'latest',
          });

          if (logs.length > 0) {
            clearInterval(interval);
            clearTimeout(timeout);

            const log = logs[0];
            const topics = log.topics;
            const data = log.data;

            // Parse event data
            const exitId = topics[1];
            const user = `0x${topics[2].slice(-40)}`;
            const amount = BigInt(data);

            console.log(`\n📡 Detected ExitStarted event:`);
            console.log(`   Exit ID: ${exitId}`);
            console.log(`   User: ${user}`);
            console.log(`   Amount: ${formatEther(amount)}`);

            resolve({ exitId: String(exitId), user, amount });
          }
        } catch (error) {
          console.error('Error polling logs:', error);
        }
      }, 5000); // Poll every 5 seconds
    } catch (error) {
      reject(error);
    }
  });
}

async function main() {
  try {
    console.log('=== Plasma Challenge Withdrawal Test (Viem) ===\n');

    // Validate configuration
    if (!CONFIG.SEPOLIA_RPC_URL) {
      throw new Error('SEPOLIA_RPC_URL not configured in .env');
    }
    if (CONFIG.ROOT_CHAIN_ADDRESS === '0x') {
      throw new Error('ROOT_CHAIN_ADDRESS not configured in .env');
    }

    // Setup clients for challenger (User B)
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CONFIG.SEPOLIA_RPC_URL),
    });

    const challengerAccount = privateKeyToAccount(CONFIG.PK_USER_B);
    const walletClient = createWalletClient({
      chain: sepolia,
      transport: http(CONFIG.SEPOLIA_RPC_URL),
      account: challengerAccount,
    });

    console.log(`User B Address (Challenger): ${challengerAccount.address}`);
    console.log(`User A Address (Withdrawer): ${CONFIG.USER_A_ADDRESS}`);
    console.log(`Root Chain: ${CONFIG.ROOT_CHAIN_ADDRESS}\n`);

    console.log('--- Setup Event Listeners ---');
    console.log('Waiting for ExitStarted event from User A...\n');

    // Wait for User A to start exit
    const exitData = await watchExitStarted(publicClient, CONFIG.USER_A_ADDRESS);
    const { exitId, user, amount } = exitData;

    // Get current exit state
    console.log('\n--- Checking Exit State ---');
    const exitRecord = await publicClient.readContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'exits',
      args: [exitId],
    });

    const exit = exitRecord as any;
    console.log(`Exit Status:`);
    console.log(`  - Owner: ${exit.owner}`);
    console.log(`  - Amount: ${formatEther(exit.amount)}`);
    console.log(`  - Exit Time: ${exit.exitTime}`);
    console.log(`  - Challenged: ${exit.challenged}`);

    const currentTime = await getCurrentTimestamp(publicClient);
    const exitTime = Number(exit.exitTime);
    const challengePeriodEnd = exitTime + 4 * 60; // 4 minutes from start
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
    const timeBeforeChallenge = await getCurrentTimestamp(publicClient);
    const windowRemaining = challengePeriodEnd - timeBeforeChallenge;

    console.log(`Current Time: ${timeBeforeChallenge}`);
    console.log(`Time Until Window Closes: ${windowRemaining} seconds`);

    if (windowRemaining <= 0) {
      console.log('❌ Challenge window closed! Too late to challenge.');
      return;
    }

    console.log('✅ Still within challenge window\n');

    // Step 3: Submit challenge
    console.log('--- Step 3: Submit Challenge ---');

    const fraudProof = '0x'; // Placeholder - would be actual fraud proof
    const conflictingTxIndex = 0n; // Index showing conflict

    console.log(`Submitting challenge for Exit ID: ${exitId}`);
    console.log(`Challenger: ${challengerAccount.address}`);

    const hash = await walletClient.writeContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'challengeExit',
      args: [exitId, conflictingTxIndex, fraudProof],
      gas: 500000n,
    });

    console.log(`📝 Transaction submitted: ${hash}`);
    console.log(`⏳ Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Challenge submitted - TX: ${receipt.transactionHash}`);

    // Step 4: Verify exit is now challenged
    console.log('\n--- Step 4: Verify Exit State ---');
    const updatedExitRecord = await publicClient.readContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'exits',
      args: [exitId],
    });

    const updatedExit = updatedExitRecord as any;
    console.log(`Exit Challenged: ${updatedExit.challenged}`);

    if (updatedExit.challenged) {
      console.log('✅ Exit successfully challenged! User A cannot withdraw.');
      console.log('\nChallenge Details:');
      console.log(`  - Original Amount: ${formatEther(updatedExit.amount)}`);
      console.log(`  - Challenger: ${challengerAccount.address}`);
    } else {
      console.log('⚠️  Challenge may have failed or exit already finalized');
    }

    // Step 5: Attempt to finalize (should fail)
    console.log('\n--- Step 5: Test - Attempt to Finalize (should fail) ---');
    console.log('Waiting for exit period to complete...');

    const remainingWait = 7 * 60 - (await getCurrentTimestamp(publicClient) - exitTime);
    for (let i = 0; i < Math.ceil(remainingWait / 60); i++) {
      console.log(`⏳ Waiting... ${i + 1}/${Math.ceil(remainingWait / 60)} minutes`);
      await sleep(60000);
    }

    console.log('\nAttempting to finalize exit...');
    try {
      const finalizeTx = await walletClient.writeContract({
        address: CONFIG.ROOT_CHAIN_ADDRESS,
        abi: RootChainABI,
        functionName: 'finalizeExit',
        args: [exitId],
        gas: 500000n,
      });

      await publicClient.waitForTransactionReceipt({ hash: finalizeTx });
      console.log('⚠️  Exit finalized (may have been valid despite challenge)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✅ Finalization blocked (as expected): ${message}`);
    }

    console.log('\n=== Challenge Test Complete ===');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
