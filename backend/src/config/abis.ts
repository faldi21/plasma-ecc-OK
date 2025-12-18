// Import ABIs from JSON files
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RootChainABI = JSON.parse(readFileSync(join(__dirname, '../../abi/RootChain.json'), 'utf-8'));
const PlasmaChainABI = JSON.parse(readFileSync(join(__dirname, '../../abi/PlasmaChain.json'), 'utf-8'));
const PlasmaTokenABI = JSON.parse(readFileSync(join(__dirname, '../../abi/PlasmaToken.json'), 'utf-8'));

// Extract ABIs
export const rootChainAbi = RootChainABI.abi;
export const plasmaChainAbi = PlasmaChainABI.abi;
export const plasmaTokenAbi = PlasmaTokenABI.abi;

// ERC20 minimal ABI for Transfer events
export const erc20Abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
] as const;

export default {
  rootChainAbi,
  plasmaChainAbi,
  plasmaTokenAbi,
  erc20Abi,
};
