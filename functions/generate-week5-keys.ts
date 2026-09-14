#!/usr/bin/env tsx

/**
 * Generate 10 new private keys for Week 5 testing
 * Derives addresses and updates .env file
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║          WEEK 5: Generate 10 Private Keys & Addresses         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const keys: Array<{ index: number; privateKey: string; address: string }> = [];

console.log('Generating 10 new private keys...\n');

for (let i = 0; i < 10; i++) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  keys.push({
    index: i + 1,
    privateKey,
    address: account.address,
  });

  console.log(`[${i + 1}] Address: ${account.address}`);
  console.log(`    Private Key: ${privateKey}\n`);
}

// Update .env file
const envPath = resolve(process.cwd(), '.env');
let envContent = '';

try {
  envContent = readFileSync(envPath, 'utf-8');
} catch {
  console.log('⚠️  .env file not found, will be created');
}

// Remove old PRIVATE_KEYS and WEEK5_ADDRESSES if exist
envContent = envContent
  .split('\n')
  .filter(line => !line.startsWith('PRIVATE_KEYS=') && !line.startsWith('WEEK5_ADDRESSES='))
  .join('\n');

// Add new keys
const privateKeysLine = `PRIVATE_KEYS=${keys.map(k => k.privateKey).join(',')}`;
const addressesLine = `WEEK5_ADDRESSES=${keys.map(k => k.address).join(',')}`;

envContent += '\n' + privateKeysLine + '\n' + addressesLine + '\n';

writeFileSync(envPath, envContent);

console.log('✅ .env file updated!\n');

// Print summary
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                    GENERATED KEYS SUMMARY                      ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log('WEEK5_ADDRESSES (for reference):');
console.log(`${keys.map(k => k.address).join(',')}\n`);

console.log('Updated .env with:');
console.log(`✓ PRIVATE_KEYS (10 keys)`);
console.log(`✓ WEEK5_ADDRESSES (10 addresses)\n`);

console.log('Next steps:');
console.log('1. Transfer ETH to these addresses from anvil default');
console.log('   npx tsx functions/week5-transfer-eth.ts');
console.log('');
console.log('2. Deposit ETH to Plasma for all 10 addresses');
console.log('   npx tsx functions/week5-deposit-plasma.ts');
console.log('');
console.log('3. Run Week 5 test');
console.log('   ./RUN-WEEK5-QUICK.sh\n');
