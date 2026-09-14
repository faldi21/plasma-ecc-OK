#!/usr/bin/env tsx

/**
 * UTXO Transfer Script
 *
 * Transfer PLASMA tokens on L2 using UTXO model:
 * - Spend existing UTXO(s)
 * - Create new UTXO for recipient
 * - Create change UTXO for sender (if needed)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  keccak256,
  encodePacked,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_CHAIN_UTXO_ADDRESS = process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address;
const L2_PLASMA_TOKEN_ADDRESS = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// L2 Chain config
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [L2_RPC_URL] },
    public: { http: [L2_RPC_URL] },
  },
} as const;

// Load ABI
const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaChainUTXO.json'), 'utf-8')
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

interface UTXO {
  utxoId: Hex;
  owner: Address;
  token: Address;
  amount: bigint;
  spent: boolean;
}

/**
 * Get user's UTXOs directly from L2 contract
 */
async function getUnspentUtxos(publicClient: any, address: Address): Promise<Hex[]> {
  try {
    const utxoIds = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [address],
    })) as Hex[];
    return utxoIds;
  } catch (error: any) {
    console.error(`Error getting UTXOs for ${address}:`, error.message);
    return [];
  }
}

/**
 * Get UTXO details from L2 contract
 */
async function getUtxoDetails(
  publicClient: any,
  utxoId: Hex
): Promise<UTXO | null> {
  try {
    const result = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId],
    })) as [Hex, Address, Address, bigint, bigint, boolean];

    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      spent: result[5],
    };
  } catch (error: any) {
    console.error(`Error getting UTXO ${utxoId.slice(0, 20)}...:`, error.message);
    return null;
  }
}

/**
 * Select UTXOs to cover the transfer amount
 */
function selectUtxos(
  utxos: UTXO[],
  targetAmount: bigint
): { selected: UTXO[]; total: bigint } {
  const unspent = utxos.filter((u) => !u.spent);
  const sorted = unspent.sort((a, b) => (b.amount > a.amount ? 1 : -1));

  const selected: UTXO[] = [];
  let total = 0n;

  for (const utxo of sorted) {
    if (total >= targetAmount) break;
    selected.push(utxo);
    total += utxo.amount;
  }

  return { selected, total };
}

/**
 * Sign transfer message
 */
async function signTransfer(
  walletClient: any,
  account: any,
  inputUtxoIds: Hex[],
  outputOwners: Address[],
  outputAmounts: bigint[],
  nonce: bigint
): Promise<Hex> {
  // Create message hash matching contract's expectation
  const messageHash = keccak256(
    encodePacked(
      ['bytes32[]', 'address[]', 'uint256[]', 'uint256'],
      [inputUtxoIds, outputOwners, outputAmounts, nonce]
    )
  );

  // Sign the message
  const signature = await walletClient.signMessage({
    account,
    message: { raw: messageHash },
  });

  return signature;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('='.repeat(60));
    console.log('         UTXO TRANSFER');
    console.log('='.repeat(60));
    console.log('');
    console.log('Usage: npx tsx functions/4-transfer-utxo.ts <FROM> <TO> <AMOUNT>');
    console.log('');
    console.log('Arguments:');
    console.log('  FROM   = A, B, or C (sender user)');
    console.log('  TO     = A, B, or C (recipient user)');
    console.log('  AMOUNT = Amount in PLASMA tokens');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx functions/4-transfer-utxo.ts A B 100');
    console.log('  npx tsx functions/4-transfer-utxo.ts A C 50');
    console.log('');
    console.log('Users:');
    console.log('  A: 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76');
    console.log('  B: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda');
    console.log('  C: 0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab');
    console.log('='.repeat(60));
    process.exit(1);
  }

  const fromKey = args[0].toUpperCase();
  const toKey = args[1].toUpperCase();
  const amount = parseEther(args[2]);

  const fromWallet = USER_WALLETS[fromKey];
  const toWallet = USER_WALLETS[toKey];

  if (!fromWallet || !toWallet) {
    console.error('Invalid user. Use A, B, or C.');
    process.exit(1);
  }

  if (fromKey === toKey) {
    console.error('Cannot transfer to yourself.');
    process.exit(1);
  }

  // Setup clients
  const account = privateKeyToAccount(fromWallet.privateKey);
  if (account.address.toLowerCase() !== fromWallet.address.toLowerCase()) {
    console.error('Sender private key does not match the configured address.');
    console.error(`  Expected: ${fromWallet.address}`);
    console.error(`  Derived:  ${account.address}`);
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  console.log('='.repeat(60));
  console.log('         UTXO TRANSFER');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  L2 RPC:           ${L2_RPC_URL}`);
  console.log(`  PlasmaChainUTXO:  ${PLASMA_CHAIN_UTXO_ADDRESS}`);
  console.log(`  Token:            ${L2_PLASMA_TOKEN_ADDRESS}`);
  console.log('');
  console.log('Transfer:');
  console.log(`  From: User ${fromKey} (${fromWallet.address})`);
  console.log(`  To:   User ${toKey} (${toWallet.address})`);
  console.log(`  Amount: ${formatEther(amount)} PLASMA`);
  console.log('='.repeat(60));

  try {
    // 1. Get sender's unspent UTXOs
    console.log('\n[1/5] Fetching unspent UTXOs...');
    const utxoIds = await getUnspentUtxos(publicClient, fromWallet.address);

    if (utxoIds.length === 0) {
      console.error('No unspent UTXOs found for sender.');
      console.error('Make sure you have deposited tokens first.');
      process.exit(1);
    }

    console.log(`  Found ${utxoIds.length} UTXO(s)`);

    // 2. Get UTXO details
    console.log('\n[2/5] Getting UTXO details...');
    const utxos: UTXO[] = [];

    for (const utxoId of utxoIds) {
      const details = await getUtxoDetails(publicClient, utxoId as Hex);
      if (details && !details.spent) {
        utxos.push(details);
        console.log(`  UTXO: ${utxoId.slice(0, 20)}... = ${formatEther(details.amount)} PLASMA`);
      }
    }

    // 3. Select UTXOs for transfer
    console.log('\n[3/5] Selecting UTXOs...');
    const { selected, total } = selectUtxos(utxos, amount);

    if (total < amount) {
      console.error(`Insufficient balance. Have ${formatEther(total)}, need ${formatEther(amount)}`);
      process.exit(1);
    }

    console.log(`  Selected ${selected.length} UTXO(s), total: ${formatEther(total)} PLASMA`);

    const inputUtxoIds = selected.map((u) => u.utxoId);
    const change = total - amount;

    // Prepare outputs
    const outputOwners: Address[] = [toWallet.address];
    const outputAmounts: bigint[] = [amount];

    if (change > 0n) {
      outputOwners.push(fromWallet.address);
      outputAmounts.push(change);
      console.log(`  Change: ${formatEther(change)} PLASMA back to sender`);
    }

    // 4. Get nonce and sign
    console.log('\n[4/5] Signing transaction...');

    const nonce = (await publicClient.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'nonces',
      args: [fromWallet.address],
    })) as bigint;

    console.log(`  Nonce: ${nonce}`);

    const signature = await signTransfer(
      walletClient,
      account,
      inputUtxoIds,
      outputOwners,
      outputAmounts,
      nonce
    );

    console.log(`  Signature: ${signature.slice(0, 20)}...`);

    // 5. Execute transfer
    console.log('\n[5/5] Executing transfer on L2...');

    const hash = await walletClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'transferUtxo',
      args: [inputUtxoIds, outputOwners, outputAmounts, signature],
    });

    console.log(`  TX Hash: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const succeeded = receipt.status === 'success' || receipt.status === 1n;
    console.log(`  Block: ${receipt.blockNumber}`);
    console.log(`  Status: ${receipt.status}`);
    console.log(`  Gas used: ${receipt.gasUsed}`);
    if (!succeeded) {
      throw new Error('Transfer transaction reverted');
    }

    // Parse TransferExecuted event to get output UTXO IDs
    let outputUtxoIds: Hex[] = [];
    for (const log of receipt.logs) {
      try {
        // TransferExecuted event signature: TransferExecuted(bytes32 txHash, address sender, bytes32[] inputUtxoIds, bytes32[] outputUtxoIds)
        const eventSignature = keccak256(
          encodePacked(['string'], ['TransferExecuted(bytes32,address,bytes32[],bytes32[])'])
        );
        if (log.topics[0] === eventSignature) {
          // Decode the event data
          const { decodeAbiParameters } = await import('viem');
          const decoded = decodeAbiParameters(
            [
              { name: 'inputUtxoIds', type: 'bytes32[]' },
              { name: 'outputUtxoIds', type: 'bytes32[]' },
            ],
            log.data
          );
          outputUtxoIds = decoded[1] as Hex[];
          console.log(`  Output UTXOs: ${outputUtxoIds.length}`);
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Parse events
    console.log('\n' + '='.repeat(60));
    console.log('         TRANSFER SUCCESSFUL!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`  Spent UTXOs: ${inputUtxoIds.length}`);
    console.log(`  Created UTXOs: ${outputOwners.length}`);
    if (outputUtxoIds.length > 0) {
      console.log(`  Output UTXO IDs:`);
      outputUtxoIds.forEach((id, i) => {
        console.log(`    ${i + 1}. ${id}`);
      });
    }
    console.log(`  - ${formatEther(amount)} PLASMA to User ${toKey}`);
    if (change > 0n) {
      console.log(`  - ${formatEther(change)} PLASMA change to User ${fromKey}`);
    }
    console.log('');
    console.log('Verify with:');
    console.log(`  npx tsx functions/3-check-balance-utxo.ts --detailed`);
    console.log('='.repeat(60));

    // Notify backend for each output UTXO
    for (const outputUtxoId of outputUtxoIds) {
      try {
        await fetch(`${BACKEND_URL}/api/transactions/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'UTXO_TRANSFER',
            utxoId: outputUtxoId,
            txHash: hash,
            from: fromWallet.address,
            to: toWallet.address,
            amount: amount.toString(),
          }),
        });
      } catch {
        // Ignore notification errors
      }
    }

  } catch (error: any) {
    console.error('\nTransfer failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
    process.exit(1);
  }
}

main();
