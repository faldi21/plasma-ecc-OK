#!/usr/bin/env tsx

/**
 * Transfer ETH from Anvil default account to 10 Week 5 test addresses
 * Provides seed funding for each address to cover gas fees
 */

import { createPublicClient, createWalletClient, http, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: resolve(process.cwd(), '.env') });

// Anvil default account (hardhat account 0)
const ANVIL_DEFAULT_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb476caded732d4dff72ef700a0a';
const ANVIL_DEFAULT_ACCOUNT = privateKeyToAccount(ANVIL_DEFAULT_PK);

const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const WEEK5_ADDRESSES = (process.env.WEEK5_ADDRESSES || '').split(',').filter(a => a.trim());
const ETH_PER_ADDRESS = parseEther('50'); // 50 ETH per address

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║     WEEK 5: Transfer ETH to 10 Test Addresses                 ║');
console.log('║        From Anvil Default Account (50 ETH each)               ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

if (WEEK5_ADDRESSES.length === 0) {
  console.error('❌ Error: WEEK5_ADDRESSES not found in .env');
  console.error('Run: npx tsx functions/generate-week5-keys.ts');
  process.exit(1);
}

console.log(`Source: ${ANVIL_DEFAULT_ACCOUNT.address}`);
console.log(`Recipients: ${WEEK5_ADDRESSES.length} addresses`);
console.log(`Amount per address: 50 ETH`);
console.log(`Total ETH: ${50 * WEEK5_ADDRESSES.length} ETH\n`);

const publicClient = createPublicClient({ transport: http(L2_RPC_URL) });
const walletClient = createWalletClient({
  account: ANVIL_DEFAULT_ACCOUNT,
  transport: http(L2_RPC_URL),
});

async function transferEth() {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < WEEK5_ADDRESSES.length; i++) {
    const address = WEEK5_ADDRESSES[i].trim() as Address;

    try {
      console.log(`[${i + 1}/10] Transferring to ${address.slice(0, 10)}...`);

      const hash = await walletClient.sendTransaction({
        to: address,
        value: ETH_PER_ADDRESS,
      });

      console.log(`      ✓ TX: ${hash.slice(0, 20)}...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`      ✓ Confirmed\n`);
        successCount++;
      } else {
        console.log(`      ❌ Failed\n`);
        failCount++;
      }
    } catch (error) {
      console.log(`      ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
      failCount++;
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      TRANSFER SUMMARY                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Successful: ${successCount}/${WEEK5_ADDRESSES.length}`);
  console.log(`Failed: ${failCount}/${WEEK5_ADDRESSES.length}`);
  console.log(`Total transferred: ${50 * successCount} ETH\n`);

  if (failCount === 0) {
    console.log('✅ All addresses funded successfully!\n');
    console.log('Next step: Deposit ETH to Plasma');
    console.log('npx tsx functions/week5-deposit-plasma.ts\n');
  } else {
    console.log('⚠️  Some transfers failed. Check the errors above.\n');
  }
}

transferEth().catch(console.error);
