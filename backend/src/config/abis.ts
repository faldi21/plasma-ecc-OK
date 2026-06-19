// Import ABIs from JSON files
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RootChainABI = JSON.parse(readFileSync(join(__dirname, '../../abi/RootChain.json'), 'utf-8'));
const PlasmaChainABI = JSON.parse(readFileSync(join(__dirname, '../../abi/PlasmaChain.json'), 'utf-8'));
const PlasmaTokenABI = JSON.parse(readFileSync(join(__dirname, '../../abi/PlasmaToken.json'), 'utf-8'));

// UTXO ABIs (new contracts)
const rootChainUtxoPath = join(__dirname, '../../abi/RootChainUTXO.json');
const plasmaChainUtxoPath = join(__dirname, '../../abi/PlasmaChainUTXO.json');
const plasmaChainUtxoMerklePath = join(__dirname, '../../abi/PlasmaChainUTXOMerkle.json');

const RootChainUTXOABI = existsSync(rootChainUtxoPath)
  ? JSON.parse(readFileSync(rootChainUtxoPath, 'utf-8'))
  : null;
const PlasmaChainUTXOABI = existsSync(plasmaChainUtxoPath)
  ? JSON.parse(readFileSync(plasmaChainUtxoPath, 'utf-8'))
  : null;
const PlasmaChainUTXOMerkleABI = existsSync(plasmaChainUtxoMerklePath)
  ? JSON.parse(readFileSync(plasmaChainUtxoMerklePath, 'utf-8'))
  : null;

// Extract ABIs
export const rootChainAbi = RootChainABI.abi;
export const plasmaChainAbi = PlasmaChainABI.abi;
export const plasmaTokenAbi = PlasmaTokenABI.abi;

// UTXO ABIs
export const rootChainUtxoAbi = RootChainUTXOABI?.abi || [];
export const plasmaChainUtxoAbi = PlasmaChainUTXOABI?.abi || [];
export const plasmaChainUtxoMerkleAbi = PlasmaChainUTXOMerkleABI?.abi || [];

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
  rootChainUtxoAbi,
  plasmaChainUtxoAbi,
};
