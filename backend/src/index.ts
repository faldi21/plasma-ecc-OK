#!/usr/bin/env node
/**
 * Plasma ECC Backend - Auto-detect Mode
 *
 * Automatically detects whether to run in UTXO mode or Legacy mode
 * based on the presence of ROOT_CHAIN_UTXO_ADDRESS in .env
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (parent of backend folder)
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const useUtxoMode = !!process.env.ROOT_CHAIN_UTXO_ADDRESS;

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('             PLASMA ECC BACKEND');
console.log('═══════════════════════════════════════════════════════');
console.log(`Mode: ${useUtxoMode ? 'UTXO (Plasma Cash)' : 'Legacy (Balance-based)'}`);
console.log('═══════════════════════════════════════════════════════');
console.log('');

if (useUtxoMode) {
  // Import and run UTXO server
  import('./server-utxo.js');
} else {
  // Import and run legacy server
  import('./server.js');
}
