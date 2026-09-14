/**
 * Debug Script for finalizeExit Issue
 * 
 * Checks:
 * 1. Exit record exists
 * 2. Exit record status
 * 3. Token balance in contract
 * 4. Token allowance
 * 5. Block timestamp vs exit time
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
  fs.readFileSync(path.join(__dirname, '../backend/abi/RootChain.json'), 'utf-8')
);
const RootChainABI = RootChainData.abi || RootChainData;

const PlasmaTokenData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../backend/abi/PlasmaToken.json'), 'utf-8')
);
const PlasmaTokenABI = PlasmaTokenData.abi || PlasmaTokenData;

// Config
const CONFIG = {
  ROOT_CHAIN_ADDRESS: process.env.ROOT_CHAIN_ADDRESS as `0x${string}`,
  PLASMA_TOKEN_ADDRESS: process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`,
  WITHDRAW_AMOUNT: BigInt(process.env.WITHDRAW_AMOUNT || '10'),
  L1_RPC: process.env.L1_RPC,
  PK_USER_A: process.env.PK_USER_A as `0x${string}`,
};

// Create public client for L1
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(CONFIG.L1_RPC),
});

// Get account
const account = privateKeyToAccount(CONFIG.PK_USER_A);

const userAddress = account.address;

console.log('=== Debug finalizeExit Issue ===\n');
console.log('User Address:', userAddress);
console.log('Root Chain:', CONFIG.ROOT_CHAIN_ADDRESS);
console.log('Plasma Token:', CONFIG.PLASMA_TOKEN_ADDRESS);
console.log('Withdraw Amount:', CONFIG.WITHDRAW_AMOUNT.toString(), 'tokens\n');

// Test exit ID from previous run
const exitId = '0xbbe9896c446360390b27f8499fd0905768481057232241a3d434550eb8d74d2b';
console.log('Exit ID:', exitId);

async function debug() {
  try {
    // 1. Check exit record
    console.log('\n--- 1. Check Exit Record ---');
    const exitRecord = await publicClient.readContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'exits',
      args: [exitId],
    });

    console.log('Exit Record:', exitRecord);
    const [owner, token, amount, blockNumber, txHash, exitTime, processed] = exitRecord as any[];
    console.log(`  Owner: ${owner}`);
    console.log(`  Token: ${token}`);
    console.log(`  Amount: ${amount}`);
    console.log(`  Block Number: ${blockNumber}`);
    console.log(`  TX Hash: ${txHash}`);
    console.log(`  Exit Time: ${exitTime}`);
    console.log(`  Processed: ${processed}`);

    // 2. Check current block timestamp
    console.log('\n--- 2. Check Block Timestamp ---');
    const blockData = await publicClient.getBlock();
    console.log(`  Current Block: ${blockData.number}`);
    console.log(`  Current Timestamp: ${blockData.timestamp}`);
    console.log(`  Exit Time: ${exitTime}`);
    console.log(`  Time difference: ${Number(blockData.timestamp) - Number(exitTime)} seconds`);
    console.log(`  Exit ready?: ${blockData.timestamp >= BigInt(exitTime)}`);

    // 3. Check token balance in contract
    console.log('\n--- 3. Check Token Balance ---');
    const contractBalance = await publicClient.readContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      functionName: 'balanceOf',
      args: [CONFIG.ROOT_CHAIN_ADDRESS],
    });
    console.log(`  Contract balance: ${contractBalance} tokens`);

    // 4. Check user balance
    console.log('\n--- 4. Check User Balance ---');
    const userBalance = await publicClient.readContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    console.log(`  User balance: ${userBalance} tokens`);

    // 5. Check contract allowance
    console.log('\n--- 5. Check Contract Allowance ---');
    const allowance = await publicClient.readContract({
      address: CONFIG.PLASMA_TOKEN_ADDRESS,
      abi: PlasmaTokenABI,
      functionName: 'allowance',
      args: [CONFIG.ROOT_CHAIN_ADDRESS, CONFIG.ROOT_CHAIN_ADDRESS],
    });
    console.log(`  Allowance: ${allowance} tokens`);

    // 6. Try to simulate the call
    console.log('\n--- 6. Simulate finalizeExit Call ---');
    try {
      const result = await publicClient.call({
        account: userAddress,
        to: CONFIG.ROOT_CHAIN_ADDRESS,
        data: encodeFunctionData({
          abi: RootChainABI,
          functionName: 'finalizeExit',
          args: [exitId],
        }),
      });
      console.log('✅ Simulation successful:', result);
    } catch (simError: any) {
      console.error('❌ Simulation error:', simError.message);
      if (simError.cause) {
        console.error('Cause:', simError.cause);
      }
      
      // Try to decode error
      if (simError.data) {
        console.error('Raw error data:', simError.data);
        
        // Try common error signatures
        const errorSig = simError.data?.slice(0, 10);
        console.log('Error signature:', errorSig);
        
        // Decode selector
        if (simError.data?.startsWith('0x')) {
          const reasonStart = '0x08c379a0'; // Error(string)
          if (simError.data.startsWith(reasonStart)) {
            console.log('This is a standard Error(string)');
          }
        }
      }
    }

    // 7. Check if exit owner matches
    console.log('\n--- 7. Verify Exit Ownership ---');
    console.log(`  Exit owner: ${owner}`);
    console.log(`  User address: ${userAddress}`);
    console.log(`  Match?: ${owner?.toLowerCase() === userAddress.toLowerCase()}`);

  } catch (error) {
    console.error('Debug error:', error);
  }
}

debug();
