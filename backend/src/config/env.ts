import { config } from 'dotenv';
import { resolve } from 'path';
import type { Address, Hex } from 'viem';
import type { EnvConfig } from '../types/contracts.js';

// Load .env from project root (parent directory)
config({ path: resolve(process.cwd(), '../.env') });
// Also try current directory
config();

function getEnvVar(key: string, required = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value || '';
}

export const envConfig: EnvConfig = {
  SEPOLIA_RPC_URL: getEnvVar('SEPOLIA_RPC_URL'),
  SEPOLIA_WSS_URL: getEnvVar('SEPOLIA_WSS_URL', false),
  L2_RPC_URL: getEnvVar('L2_RPC_URL', false) || 'http://localhost:8545',
  OPERATOR_PRIVATE_KEY: getEnvVar('OPERATOR_PRIVATE_KEY') as Hex,
  L2_OPERATOR_PRIVATE_KEY: getEnvVar('L2_OPERATOR_PRIVATE_KEY') as Hex,
  ROOT_CHAIN_ADDRESS: getEnvVar('ROOT_CHAIN_ADDRESS') as Address,
  PLASMA_CHAIN_ADDRESS: getEnvVar('PLASMA_CHAIN_ADDRESS', false) as Address,
  PLASMA_TOKEN_ADDRESS: getEnvVar('PLASMA_TOKEN_ADDRESS') as Address,
  L2_PLASMA_CHAIN_ADDRESS: getEnvVar('L2_PLASMA_CHAIN_ADDRESS') as Address,
  L2_PLASMA_TOKEN_ADDRESS: getEnvVar('L2_PLASMA_TOKEN_ADDRESS') as Address,
  PORT: getEnvVar('PORT', false) || '3001',
  // UTXO Contract Addresses
  ROOT_CHAIN_UTXO_ADDRESS: getEnvVar('ROOT_CHAIN_UTXO_ADDRESS', false) as Address,
  PLASMA_CHAIN_UTXO_ADDRESS: getEnvVar('PLASMA_CHAIN_UTXO_ADDRESS', false) as Address,
  PLASMA_CHAIN_UTXO_MERKLE_ADDRESS: getEnvVar('PLASMA_CHAIN_UTXO_MERKLE_ADDRESS', false) as Address,
};

export default envConfig;
