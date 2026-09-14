#!/usr/bin/env tsx

/**
 * Deposit ETH to Plasma for all 10 Week 5 test addresses
 * Creates initial UTXOs for each address
 */

import { createPublicClient, createWalletClient, http, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: resolve(process.cwd(), '.env') });

const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const PLASMA_CHAIN_UTXO_ADDRESS = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as Address;
const PRIVATE_KEYS = (process.env.PRIVATE_KEYS || '').split(',').map(k => k.trim()).filter(k => k);
const WEEK5_ADDRESSES = (process.env.WEEK5_ADDRESSES || '').split(',').map(a => a.trim()).filter(a => a);

const DEPOSIT_AMOUNT = parseEther('100'); // 100 ETH per address

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║     WEEK 5: Deposit ETH to Plasma (Create UTXOs)              ║');
console.log('║             100 ETH per address (10 addresses)                ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

if (PRIVATE_KEYS.length === 0 || WEEK5_ADDRESSES.length === 0) {
  console.error('❌ Error: PRIVATE_KEYS or WEEK5_ADDRESSES not found in .env');
  console.error('Run: npx tsx functions/generate-week5-keys.ts');
  process.exit(1);
}

console.log(`Total addresses: ${WEEK5_ADDRESSES.length}`);
console.log(`Amount per deposit: 100 ETH`);
console.log(`Total ETH to deposit: ${100 * WEEK5_ADDRESSES.length} ETH\n`);

// Load Plasma contract ABI
const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(process.cwd(), 'backend/abi/PlasmaChainUTXO.json'), 'utf-8')
).abi;

const publicClient = createPublicClient({ transport: http(L2_RPC_URL) });

async function depositForAddress(
  index: number,
  address: Address,
  privateKey: string
): Promise<{ address: Address; success: boolean; error?: string }> {
  try {
    const account = privateKeyToAccount(`0x${privateKey.replace('0x', '')}` as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      transport: http(L2_RPC_URL),
    });

    console.log(`[${index + 1}/10] Depositing for ${address.slice(0, 10)}...`);

    const hash = await walletClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'deposit',
      args: [address],
      value: DEPOSIT_AMOUNT,
    });

    console.log(`      ✓ TX: ${hash.slice(0, 20)}...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log(`      ✓ Confirmed - UTXO created\n`);
      return { address, success: true };
    } else {
      return { address, success: false, error: 'Transaction reverted' };
    }
  } catch (error) {
    console.log(`      ❌ Error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`);
    return {
      address,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function depositAll() {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < WEEK5_ADDRESSES.length; i++) {
    const result = await depositForAddress(i, WEEK5_ADDRESSES[i] as Address, PRIVATE_KEYS[i]);

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      DEPOSIT SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Successful: ${successCount}/${WEEK5_ADDRESSES.length}`);
  console.log(`Failed: ${failCount}/${WEEK5_ADDRESSES.length}`);
  console.log(`Total deposited: ${100 * successCount} ETH\n`);

  if (failCount === 0) {
    console.log('✅ All addresses deposited to Plasma successfully!\n');
    console.log('All 10 addresses now have UTXOs and are ready for Week 5 testing.\n');
    console.log('Run Week 5 test:');
    console.log('./RUN-WEEK5-QUICK.sh\n');
  } else {
    console.log('⚠️  Some deposits failed. Check the errors above.\n');
  }
}

depositAll().catch(console.error);
