#!/usr/bin/env tsx

/**
 * Finalize Exit Script
 *
 * Finalize a pending exit after the challenge period has passed.
 * This transfers the tokens from the Plasma contract back to the user on L1.
 *
 * Usage:
 *   npx tsx functions/7-finalize-exit.ts <USER> [EXIT_UTXO_ID]
 *
 * If EXIT_UTXO_ID is not provided, the script will list all pending exits for the user.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

// Environment
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;
const ROOT_CHAIN_UTXO_ADDRESS = process.env.ROOT_CHAIN_UTXO_ADDRESS as Address;
const PLASMA_TOKEN_ADDRESS = process.env.PLASMA_TOKEN_ADDRESS as Address;

// Load ABIs
const rootChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/RootChainUTXO.json'), 'utf-8')
).abi;

const plasmaTokenAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaToken.json'), 'utf-8')
).abi;

// User wallets
const USER_WALLETS: Record<string, { address: Address; privateKey: Hex }> = {
  A: {
    address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76',
    privateKey: '0x873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080',
  },
  B: {
    address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda',
    privateKey: '0x79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1',
  },
  C: {
    address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab',
    privateKey: '0x070d8f7d287854522182733db1f2f5fc4609480167dced6a1e93213b22694aa3',
  },
};

interface ExitInfo {
  exitor: Address;
  utxoId: Hex;
  token: Address;
  amount: bigint;
  bondAmount: bigint;
  exitTime: bigint;
  finalized: boolean;
  challenged: boolean;
}

/**
 * Get exit info from L1 contract
 */
async function getExitInfo(l1Client: any, exitId: Hex): Promise<ExitInfo | null> {
  try {
    const result = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'exits',
      args: [exitId],
    })) as [Address, Hex, Address, bigint, bigint, bigint, boolean, boolean];

    return {
      exitor: result[0],
      utxoId: result[1],
      token: result[2],
      amount: result[3],
      bondAmount: result[4],
      exitTime: result[5],
      finalized: result[6],
      challenged: result[7],
    };
  } catch {
    return null;
  }
}

/**
 * Get L1 token balance
 */
async function getL1TokenBalance(l1Client: any, address: Address): Promise<bigint> {
  try {
    return (await l1Client.readContract({
      address: PLASMA_TOKEN_ADDRESS,
      abi: plasmaTokenAbi,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString();
}

/**
 * Calculate time remaining
 */
function getTimeRemaining(exitTime: bigint): { seconds: number; canFinalize: boolean } {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const remaining = Number(exitTime - now);
  return {
    seconds: remaining,
    canFinalize: remaining <= 0,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('='.repeat(60));
    console.log('         FINALIZE EXIT');
    console.log('='.repeat(60));
    console.log('');
    console.log('Finalize a pending exit after the challenge period.');
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx functions/7-finalize-exit.ts <USER> [EXIT_UTXO_ID]');
    console.log('');
    console.log('Arguments:');
    console.log('  USER         = A, B, or C');
    console.log('  EXIT_UTXO_ID = The Exit UTXO ID (optional - shows status if omitted)');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx functions/7-finalize-exit.ts A');
    console.log('  npx tsx functions/7-finalize-exit.ts A 0xddd65e87aaf...');
    console.log('');
    console.log('Users:');
    console.log('  A: 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76');
    console.log('  B: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda');
    console.log('  C: 0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab');
    console.log('='.repeat(60));
    process.exit(1);
  }

  const userKey = args[0].toUpperCase();
  const exitUtxoId = args[1] as Hex | undefined;

  const userWallet = USER_WALLETS[userKey];
  if (!userWallet) {
    console.error('Invalid user. Use A, B, or C.');
    process.exit(1);
  }

  // Setup clients
  const userAccount = privateKeyToAccount(userWallet.privateKey);

  const l1Client = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l1WalletClient = createWalletClient({
    account: userAccount,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  console.log('='.repeat(60));
  console.log('         FINALIZE EXIT');
  console.log('='.repeat(60));
  console.log('');
  console.log(`User: ${userKey} (${userWallet.address})`);
  console.log(`RootChainUTXO: ${ROOT_CHAIN_UTXO_ADDRESS}`);
  console.log('='.repeat(60));

  try {
    // Get initial balance
    const initialBalance = await getL1TokenBalance(l1Client, userWallet.address);
    console.log(`\nCurrent L1 PLASMA Balance: ${formatEther(initialBalance)}`);

    if (!exitUtxoId) {
      // No exit ID provided - just show help
      console.log('\nNo EXIT_UTXO_ID provided.');
      console.log('Please provide the Exit UTXO ID from your startExit transaction.');
      console.log('\nExample:');
      console.log('  npx tsx functions/7-finalize-exit.ts A 0xddd65e87aaf46ab52aba3fb4eb4ce1de48af6ff0826dc839730ec050f03dbc63');
      process.exit(0);
    }

    // Get exit info
    console.log(`\nChecking exit status for: ${exitUtxoId.slice(0, 30)}...`);
    const exitInfo = await getExitInfo(l1Client, exitUtxoId);

    if (!exitInfo || exitInfo.exitor === '0x0000000000000000000000000000000000000000') {
      console.error('\nExit not found. Make sure you used the correct Exit UTXO ID.');
      console.error('The Exit UTXO ID is logged during the startExit step.');
      process.exit(1);
    }

    console.log('\nExit Details:');
    console.log(`  Exitor:     ${exitInfo.exitor}`);
    console.log(`  UTXO ID:    ${exitInfo.utxoId.slice(0, 30)}...`);
    console.log(`  Token:      ${exitInfo.token}`);
    console.log(`  Amount:     ${formatEther(exitInfo.amount)} PLASMA`);
    console.log(`  Exit Time:  ${formatTimestamp(exitInfo.exitTime)}`);
    console.log(`  Finalized:  ${exitInfo.finalized}`);
    console.log(`  Challenged: ${exitInfo.challenged}`);

    // Check if already finalized
    if (exitInfo.finalized) {
      console.log('\nThis exit has already been finalized!');
      process.exit(0);
    }

    // Check if challenged
    if (exitInfo.challenged) {
      console.error('\nThis exit has been challenged and cannot be finalized.');
      process.exit(1);
    }

    // Check if owned by user
    if (exitInfo.exitor.toLowerCase() !== userWallet.address.toLowerCase()) {
      console.error(`\nThis exit belongs to ${exitInfo.exitor}, not ${userWallet.address}`);
      process.exit(1);
    }

    // Check time remaining
    const { seconds, canFinalize } = getTimeRemaining(exitInfo.exitTime);

    if (!canFinalize) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      console.log(`\nChallenge period not over yet!`);
      console.log(`Time remaining: ${minutes}m ${secs}s`);
      console.log(`Can finalize at: ${formatTimestamp(exitInfo.exitTime)}`);
      console.log('\nRun this script again after the challenge period ends.');
      process.exit(0);
    }

    // Finalize exit
    console.log('\nFinalizing exit...');

    const finalizeHash = await l1WalletClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'finalizeExit',
      args: [exitUtxoId],
    });

    console.log(`  TX Hash: ${finalizeHash}`);
    console.log('  Waiting for confirmation...');

    const receipt = await l1Client.waitForTransactionReceipt({
      hash: finalizeHash,
      timeout: 120_000, // 2 minutes timeout
    });

    console.log(`  Block: ${receipt.blockNumber}`);
    console.log(`  Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`);

    if (receipt.status !== 'success') {
      console.error('\nFinalize transaction failed!');
      process.exit(1);
    }

    // Get final balance
    const finalBalance = await getL1TokenBalance(l1Client, userWallet.address);
    const received = finalBalance - initialBalance;

    console.log('\n' + '='.repeat(60));
    console.log('         EXIT FINALIZED!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Balance Changes:');
    console.log(`  Before: ${formatEther(initialBalance)} PLASMA`);
    console.log(`  After:  ${formatEther(finalBalance)} PLASMA`);
    console.log(`  Change: +${formatEther(received)} PLASMA`);
    console.log('');
    console.log(`Transaction: ${finalizeHash}`);
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('\nFinalize failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
    process.exit(1);
  }
}

main();
