#!/usr/bin/env tsx

/**
 * Test Environment Variables Loading
 *
 * Script untuk verifikasi bahwa .env terbaca dengan benar
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Force load .env from project root
const envPath = resolve(__dirname, '../.env');
console.log('📁 Loading .env from:', envPath);
console.log('');

const result = config({ path: envPath });

if (result.error) {
  console.error('❌ Error loading .env:', result.error);
  process.exit(1);
}

console.log('✅ .env loaded successfully!\n');

// Check important variables
const requiredVars = {
  'SEPOLIA_RPC_URL': process.env.SEPOLIA_RPC_URL,
  'L2_RPC_URL': process.env.L2_RPC_URL,
  'ROOT_CHAIN_ADDRESS': process.env.ROOT_CHAIN_ADDRESS,
  'PLASMA_TOKEN_ADDRESS': process.env.PLASMA_TOKEN_ADDRESS,
  'L2_PLASMA_CHAIN_ADDRESS': process.env.L2_PLASMA_CHAIN_ADDRESS,
  'L2_PLASMA_TOKEN_ADDRESS': process.env.L2_PLASMA_TOKEN_ADDRESS,
};

console.log('🔍 Environment Variables Check:\n');
console.log('━'.repeat(80));

let allFound = true;

for (const [key, value] of Object.entries(requiredVars)) {
  const status = value ? '✅' : '❌';
  const displayValue = value
    ? (value.length > 50 ? value.slice(0, 47) + '...' : value)
    : 'NOT FOUND';

  console.log(`${status} ${key.padEnd(30)} = ${displayValue}`);

  if (!value) {
    allFound = false;
  }
}

console.log('━'.repeat(80));
console.log('');

if (allFound) {
  console.log('✅ All required environment variables found!');
  console.log('✅ Scripts are ready to use!');
} else {
  console.log('❌ Some environment variables are missing!');
  console.log('   Please check your .env file in project root.');
  process.exit(1);
}
