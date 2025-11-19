import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Address, Hex } from 'viem';
import type { RelayConfig } from './types.js';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Force load .env from project root
const envPath = resolve(__dirname, '../../.env');
config({ path: envPath });

function getEnvVar(key: string, required = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value || '';
}

/**
 * Load and validate relay configuration from environment variables
 */
export function loadConfig(): RelayConfig {
  return {
    // L1 (Sepolia)
    sepoliaRpcUrl: getEnvVar('SEPOLIA_RPC_URL'),
    sepoliaWssUrl: getEnvVar('SEPOLIA_WSS_URL', false),
    rootChainAddress: getEnvVar('ROOT_CHAIN_ADDRESS') as Address,
    plasmaTokenAddress: getEnvVar('PLASMA_TOKEN_ADDRESS') as Address,
    operatorPrivateKey: getEnvVar('OPERATOR_PRIVATE_KEY') as Hex,

    // L2 (Local)
    l2RpcUrl: getEnvVar('L2_RPC_URL', false) || 'http://localhost:8545',
    l2PlasmaChainAddress: getEnvVar('L2_PLASMA_CHAIN_ADDRESS') as Address,
    l2PlasmaTokenAddress: getEnvVar('L2_PLASMA_TOKEN_ADDRESS') as Address,
    l2OperatorPrivateKey: getEnvVar('L2_OPERATOR_PRIVATE_KEY') as Hex,

    // Relay settings
    l1FromBlock: BigInt(getEnvVar('L1_FROM_BLOCK', false) || '0'),
    relayTransactionsPerBlock: parseInt(getEnvVar('RELAY_TRANSACTIONS_PER_BLOCK', false) || '10'),
    relayBlockTimeout: parseInt(getEnvVar('RELAY_BLOCK_TIMEOUT', false) || '60000'),

    // Optional
    l2ApiUrl: getEnvVar('L2_API_URL', false) || 'http://localhost:3001',
  };
}

/**
 * Print configuration summary
 */
export function printConfig(config: RelayConfig): void {
  console.log('🚀 Plasma ECC Relay Service - L1↔L2 Bridge');
  console.log('================================================');
  console.log('Function: Monitor L1 Deposits → Relay to L2 → Submit to L1');
  console.log('================================================');
  console.log('L1 Network:              Sepolia Testnet');
  console.log('L1 RootChain:           ', config.rootChainAddress);
  console.log('L1 PlasmaToken:         ', config.plasmaTokenAddress);
  console.log('L1 RPC:                 ', config.sepoliaRpcUrl.slice(0, 50) + '...');
  if (config.sepoliaWssUrl) {
    console.log('L1 WebSocket:           ', 'Enabled');
  }
  console.log('');
  console.log('L2 Network:              Local Anvil');
  console.log('L2 PlasmaChain:         ', config.l2PlasmaChainAddress);
  console.log('L2 PlasmaToken:         ', config.l2PlasmaTokenAddress);
  console.log('L2 RPC:                 ', config.l2RpcUrl);
  console.log('');
  console.log('Relay Settings:');
  console.log(`  Block Submission:      Every ${config.relayTransactionsPerBlock} transactions`);
  console.log(`  Timeout:               ${config.relayBlockTimeout / 1000} seconds`);
  console.log(`  Starting from block:   ${config.l1FromBlock}`);
  console.log('================================================\n');
}

export default loadConfig;
