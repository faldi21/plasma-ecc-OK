/**
 * Simulate startExit to get detailed error
 */

import { createPublicClient, http, parseEther, encodeFunctionData } from 'viem';
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
  TX_HASH: '0x867b57a3b34dec9e340b9da2ad24f57d85734b6cbcfc47aaedc8e8abb41243af' as `0x${string}`,
  WITHDRAW_AMOUNT: parseEther('2000'),
};

async function main() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.SEPOLIA_RPC_URL),
  });

  const account = privateKeyToAccount(CONFIG.PK_USER_A);

  console.log('=== Simulating startExit Call ===\n');

  // Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${CONFIG.TX_HASH}`);
  const witnessData = await witnessResp.json();

  const witnessPoint = {
    x: BigInt(witnessData.witness.x),
    y: BigInt(witnessData.witness.y),
  };

  const blockNumber = 5n;

  console.log('Parameters:');
  console.log(`  Token: ${CONFIG.PLASMA_TOKEN_ADDRESS}`);
  console.log(`  Amount: ${CONFIG.WITHDRAW_AMOUNT}`);
  console.log(`  Block Number: ${blockNumber}`);
  console.log(`  TxHash: ${CONFIG.TX_HASH}`);
  console.log(`  Witness X: ${witnessPoint.x}`);
  console.log(`  Witness Y: ${witnessPoint.y}`);

  // Try to simulate the call
  try {
    console.log('\nSimulating call...');

    const result = await publicClient.simulateContract({
      address: CONFIG.ROOT_CHAIN_ADDRESS,
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, CONFIG.TX_HASH, witnessPoint],
      account: account.address,
    });

    console.log('\n✅ Simulation SUCCESS!');
    console.log('Result:', result);

  } catch (error: any) {
    console.log('\n❌ Simulation FAILED');
    console.error('Error:', error.message);

    if (error.cause) {
      console.error('\nCause:', error.cause);
    }

    // Try to extract revert reason
    if (error.data) {
      console.error('\nError Data:', error.data);
    }

    // Extract error from message
    const match = error.message.match(/reverted with the following reason:\s*(.+)/);
    if (match) {
      console.error(`\n⚠️  Revert Reason: ${match[1]}`);
    }

    const matchCustom = error.message.match(/The contract function "([^"]+)" reverted/);
    if (matchCustom) {
      console.error(`\n⚠️  Function reverted: ${matchCustom[1]}`);
    }
  }

  // Additionally, try direct eth_call
  console.log('\n--- Trying direct eth_call ---');

  try {
    const data = encodeFunctionData({
      abi: RootChainData.abi,
      functionName: 'startExit',
      args: [CONFIG.PLASMA_TOKEN_ADDRESS, CONFIG.WITHDRAW_AMOUNT, blockNumber, CONFIG.TX_HASH, witnessPoint],
    });

    const callResult = await publicClient.call({
      to: CONFIG.ROOT_CHAIN_ADDRESS,
      from: account.address,
      data,
    });

    console.log('Call result:', callResult);

  } catch (callError: any) {
    console.error('Call error:', callError.message);

    // Try to decode error
    if (callError.data) {
      console.log('\nError data (hex):', callError.data);

      // Try to decode as string
      try {
        const errorText = Buffer.from(callError.data.slice(2), 'hex').toString();
        console.log('Error text:', errorText);
      } catch {}
    }
  }
}

main().catch(console.error);
