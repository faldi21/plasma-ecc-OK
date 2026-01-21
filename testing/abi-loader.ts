/**
 * ABI Loader
 * Load contract ABIs for testing framework
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Get contract ABI by name
 */
export function getContractAbi(contractName: string): any[] {
  const abiPaths: Record<string, string> = {
    RootChainUTXO: resolve(process.cwd(), 'backend', 'abi', 'RootChainUTXO.json'),
    PlasmaChainUTXO: resolve(process.cwd(), 'backend', 'abi', 'PlasmaChainUTXO.json'),
  };

  const path = abiPaths[contractName];
  if (!path) {
    throw new Error(`Unknown contract: ${contractName}`);
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const abi = JSON.parse(content);
    return Array.isArray(abi) ? abi : abi.abi || [];
  } catch (error) {
    console.error(`Failed to load ABI for ${contractName} from ${path}`);
    throw error;
  }
}

/**
 * Get all available ABIs
 */
export function getAllAbis(): Record<string, any[]> {
  return {
    RootChainUTXO: getContractAbi('RootChainUTXO'),
    PlasmaChainUTXO: getContractAbi('PlasmaChainUTXO'),
  };
}
