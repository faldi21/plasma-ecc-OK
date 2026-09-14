/**
 * Withdraw Test Script (Viem Version)
 * 
 * Timeline:
 * - T=0: startExit() - User A initiates withdrawal
 * - T=0-4 min: Challenge period OPEN - User B can challenge
 * - T=4-7 min: Challenge period CLOSED - No more challenges allowed
 * - T=7+ min: User A can finalizeExit() and withdraw funds
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract, keccak256, encodePacked, encodeFunctionData } from 'viem';
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
  ROOT_CHAIN_ADDRESS: (process.env.ROOT_CHAIN_ADDRESS || '0x') as `0x${string}`,
  PLASMA_TOKEN_ADDRESS: (process.env.PLASMA_TOKEN_ADDRESS || '0x') as `0x${string}`,
  // User A yang melakukan withdraw (yang punya balance)
  PK_USER_A: process.env.PK_USER_A as `0x${string}`,
  WITHDRAW_AMOUNT: parseEther('10'), // 10 tokens
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentTimestamp(publicClient: any): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function main() {
  try {
    console.log('=== Plasma Withdrawal Test (Viem) ===\n');

    // Validate configuration
    if (!CONFIG.SEPOLIA_RPC_URL) {
      throw new Error('SEPOLIA_RPC_URL not configured in .env');
    }
    if (CONFIG.ROOT_CHAIN_ADDRESS === '0x') {
      throw new Error('ROOT_CHAIN_ADDRESS not configured in .env');
    }

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
    console.log(`Withdraw Amount: ${formatEther(CONFIG.WITHDRAW_AMOUNT)} tokens\n`);

    // Connect to contracts
    const rootChain = getContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      client: publicClient,
    });

    const plasmaToken = getContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      client: publicClient,
    });

    // Step 1: Check balance
    console.log('--- Step 1: Check User Balance ---');
    const balance = await publicClient.readContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    console.log(`Current Balance: ${formatEther(balance as bigint)} tokens`);

    if ((balance as bigint) < CONFIG.WITHDRAW_AMOUNT) {
      console.log('❌ Insufficient balance for withdrawal');
      return;
    }

    // Step 2: Prepare withdrawal - Add tx to accumulator and get witness
    console.log('\n--- Step 2: Prepare Withdrawal (Add to Accumulator) ---');

    const blockNumber = 1n; // L2 block number where withdrawal occurred
    const txHash = '0x16d01d24434d93753346e03db152b930cd7dc49e7bb4ade9238dd5c8606efa95'; // Use the actual tx from backend

    // Add transaction to accumulator
    console.log(`Adding transaction to accumulator: ${txHash}`);
    const addResponse = await fetch('http://localhost:3001/api/accumulator/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    });

    if (!addResponse.ok) {
      throw new Error(`Failed to add tx to accumulator: ${addResponse.statusText}`);
    }

    const addData = await addResponse.json();
    console.log(`✅ Transaction added to accumulator`);
    console.log(`   Accumulator Value: x=${addData.accumulator.x.slice(0, 20)}..., y=${addData.accumulator.y.slice(0, 20)}...`);

    // Get witness for this transaction
    console.log(`\nQuerying witness for transaction: ${txHash}`);
    const witnessResponse = await fetch(`http://localhost:3001/api/witness/${txHash}`);

    if (!witnessResponse.ok) {
      throw new Error(`Failed to get witness: ${witnessResponse.statusText}`);
    }

    const witnessData = await witnessResponse.json();
    const witness = witnessData.witness;

    console.log(`✅ Witness obtained`);
    console.log(`   Witness: x=${witness.x.slice(0, 20)}..., y=${witness.y.slice(0, 20)}...`);

    console.log(`\nCreating exit for:`);
    console.log(`  - Token: ${CONFIG.PLASMA_TOKEN_ADDRESS}`);
    console.log(`  - Amount: ${formatEther(CONFIG.WITHDRAW_AMOUNT)}`);
    console.log(`  - L2 Block: ${blockNumber}`);
    console.log(`  - TX Hash: ${txHash}`);

    // Step 3: Start Exit
    console.log('\n--- Step 3: Initiate Exit (startExit) ---');
    const startTime = await getCurrentTimestamp(publicClient);
    console.log(`Current Time: ${startTime}`);
    console.log(`Challenge Period Ends At: ${startTime + 4 * 60} (in 4 minutes)`);
    console.log(`Exit Period Ends At: ${startTime + 7 * 60} (in 7 minutes)`);

    // Convert witness hex strings to bigints
    const witnessPoint = {
      x: BigInt(witness.x),
      y: BigInt(witness.y),
    };

    const hash1 = await walletClient.writeContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, txHash, witnessPoint],
      gas: 500000n,
    });

    console.log(`📝 Transaction submitted: ${hash1}`);
    console.log(`⏳ Waiting for confirmation...`);

    const receipt1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
    console.log(`✅ Exit started - TX: ${receipt1.transactionHash}`);
    console.log(`   TX Status: ${receipt1.status}`);
    console.log(`   Gas Used: ${receipt1.gasUsed}`);
    
    if (receipt1.status === 'reverted') {
      console.error('❌ startExit transaction REVERTED!');
      throw new Error('startExit call failed');
    }

    // Step 4: Calculate exit ID from transaction data
    // Exit ID = keccak256(abi.encodePacked(user, token, blockNumber, txHash))
    // Note: amount is NOT included in exitId calculation per contract
    console.log('\n--- Step 4: Calculate Exit ID ---');
    
    const exitId = keccak256(
      encodePacked(
        ['address', 'address', 'uint256', 'bytes32'],
        [account.address, CONFIG.PLASMA_TOKEN_ADDRESS, blockNumber, txHash]
      )
    );
    
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
    const currentTime = await getCurrentTimestamp(publicClient);
    console.log(`Current Time: ${currentTime}`);
    console.log(`Exit Period Should Be Over: ${currentTime >= startTime + 7 * 60}`);

    try {
      // First, let's try to call the function and capture any errors
      try {
        const hash2 = await walletClient.writeContract({
          address: CONFIG.ROOT_CHAIN_ADDRESS,
          abi: RootChainABI,
          functionName: 'finalizeExit',
          args: [exitId],
          gas: 500000n,
        });

        console.log(`📝 Transaction submitted: ${hash2}`);
        console.log(`⏳ Waiting for confirmation...`);

        const receipt2 = await publicClient.waitForTransactionReceipt({ hash: hash2 });
        console.log(`✅ Exit finalized - TX: ${receipt2.transactionHash}`);
        console.log(`TX Status: ${receipt2.status}`);
        console.log(`Gas Used: ${receipt2.gasUsed}`);
      } catch (innerError: any) {
        console.error(`❌ Error during finalizeExit: ${innerError.message}`);
        console.error(`Full Error Details:`, innerError);
        
        // Try to get more info by simulating the call
        console.log('\n📋 Attempting to simulate the call for debugging...');
        try {
          const result = await publicClient.call({
            account: account.address,
            to: CONFIG.ROOT_CHAIN_ADDRESS,
            data: encodeFunctionData({
              abi: RootChainABI,
              functionName: 'finalizeExit',
              args: [exitId],
            }),
          });
          console.log('Call result:', result);
        } catch (simError: any) {
          console.error('Simulation error:', simError.message);
          if (simError.data) {
            console.error('Error data:', simError.data);
          }
        }
        
        throw innerError;
      }
      console.log(`Logs Count: ${receipt2.logs.length}`);

      if (receipt2.status === 'reverted') {
        console.log('❌ Transaction reverted! Checking exit state...');
        
        // Check exit state
        const exitRecord = await publicClient.readContract({
          address: CONFIG.ROOT_CHAIN_ADDRESS,
          abi: RootChainABI,
          functionName: 'exits',
          args: [exitId],
        });
        
        const exit = exitRecord as any;
        console.log(`Exit State:`);
        console.log(`  - Owner: ${exit.owner}`);
        console.log(`  - Amount: ${formatEther(exit.amount)}`);
        console.log(`  - Exit Time: ${exit.exitTime}`);
        console.log(`  - Processed: ${exit.processed}`);
        console.log(`  - Token: ${exit.token}`);
        
        return;
      }
    } catch (error) {
      console.error('❌ Finalize Exit Error:', error instanceof Error ? error.message : String(error));
      
      // Try to get more details about the exit
      try {
        const exitRecord = await publicClient.readContract({
          address: CONFIG.ROOT_CHAIN_ADDRESS,
          abi: RootChainABI,
          functionName: 'exits',
          args: [exitId],
        });
        
        const exit = exitRecord as any;
        console.log(`\nExit State:`);
        console.log(`  - Owner: ${exit.owner}`);
        console.log(`  - Amount: ${formatEther(exit.amount)}`);
        console.log(`  - Exit Time: ${exit.exitTime}`);
        console.log(`  - Processed: ${exit.processed}`);
        console.log(`  - Token: ${exit.token}`);
      } catch {}
      
      return;
    };

    // Step 8: Check final balance
    console.log('\n--- Step 7: Check Final Balance ---');
    const finalBalance = await publicClient.readContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    console.log(`Final Balance: ${formatEther(finalBalance as bigint)} tokens`);
    console.log(`Withdrawn Amount: ${formatEther(CONFIG.WITHDRAW_AMOUNT)} tokens`);

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
