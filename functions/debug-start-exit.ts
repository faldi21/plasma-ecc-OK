/**
 * Debug startExit Revert Reason
 * 
 * Checks all requirements in startExit function
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract, keccak256, encodePacked, encodeFunctionData, decodeErrorResult } from 'viem';
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

console.log('=== Debug startExit Revert ===\n');
console.log('User Address:', userAddress);
console.log('Root Chain:', CONFIG.ROOT_CHAIN_ADDRESS);
console.log('Plasma Token:', CONFIG.PLASMA_TOKEN_ADDRESS, '\n');

// Test values from witness script
const blockNumber = 1n;
const txHash = '0x16d01d24434d93753346e03db152b930cd7dc49e7bb4ade9238dd5c8606efa95' as `0x${string}`;
const witnessX = '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const witnessY = '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';

const witness = {
  x: BigInt(witnessX),
  y: BigInt(witnessY),
};

async function debug() {
  try {
    console.log('--- 1. Check Block Number ---');
    const currentPlasmaBlock = await publicClient.readContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'currentPlasmaBlock',
    });
    console.log(`  Current Plasma Block: ${currentPlasmaBlock}`);
    console.log(`  Block Number to use: ${blockNumber}`);
    console.log(`  Valid?: ${blockNumber <= BigInt(currentPlasmaBlock)}`);

    console.log('\n--- 2. Check Accumulator ---');
    console.log(`  TX Hash: ${txHash}`);
    console.log(`  Witness X: ${witness.x}`);
    console.log(`  Witness Y: ${witness.y}`);

    console.log('\n--- 3. Try Simulation ---');
    try {
      const result = await publicClient.call({
        account: userAddress,
        to: CONFIG.ROOT_CHAIN_ADDRESS,
        data: encodeFunctionData({
          abi: RootChainABI,
          functionName: 'startExit',
          args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, txHash, witness],
        }),
      });
      console.log('✅ Simulation successful:', result);
    } catch (simError: any) {
      console.error('❌ Simulation failed');
      console.error('  Error:', simError.message);
      
      // Extract revert reason
      if (simError.data) {
        console.log('\n  Raw error data:', simError.data);
        
        // Try to decode
        const errorSig = simError.data.slice(0, 10);
        if (errorSig === '0x08c379a0') {
          // Standard Error(string)
          const decodedError = decodeErrorResult({
            abi: RootChainABI,
            data: simError.data,
          });
          console.log('  Decoded reason:', decodedError.args?.[0]);
        }
      }
      
      // Show full cause
      if (simError.cause?.message) {
        console.error('  Cause:', simError.cause.message);
      }
    }

    console.log('\n--- 4. Check Exit Record Before ---');
    const exitIdBefore = keccak256(
      encodePacked(
        ['address', 'address', 'uint256', 'bytes32'],
        [userAddress, CONFIG.PLASMA_TOKEN_ADDRESS, blockNumber, txHash]
      )
    );
    console.log(`  Exit ID would be: ${exitIdBefore}`);
    
    const exitRecordBefore = await publicClient.readContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainABI,
      functionName: 'exits',
      args: [exitIdBefore],
    });
    
    const [ownerBefore] = exitRecordBefore as any[];
    console.log(`  Exit already exists?: ${ownerBefore !== '0x0000000000000000000000000000000000000000'}`);

  } catch (error) {
    console.error('Debug error:', error);
  }
}

debug();
