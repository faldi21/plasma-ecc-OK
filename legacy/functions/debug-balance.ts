#!/usr/bin/env node
import { createPublicClient, http, type Address, formatEther, parseEther } from 'viem';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
    public: { http: ['http://localhost:8545'] },
  },
} as const;

const plasmaChainAbi = [
  {
    type: 'function',
    name: 'getBalance',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balances',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function main() {
  const plasmaChainAddress = process.env.L2_PLASMA_CHAIN_ADDRESS as Address;
  const plasmaTokenAddress = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;
  const fromAddress = '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address;

  const publicClient = createPublicClient({
    chain: l2Chain,
    transport: http('http://localhost:8545'),
  });

  console.log('Debug Balance Check');
  console.log('===================\n');
  console.log('PlasmaChain:', plasmaChainAddress);
  console.log('PlasmaToken:', plasmaTokenAddress);
  console.log('From Address:', fromAddress);
  console.log('');

  // Get balance using getBalance function
  const balance = await publicClient.readContract({
    address: plasmaChainAddress,
    abi: plasmaChainAbi,
    functionName: 'getBalance',
    args: [fromAddress, plasmaTokenAddress],
  }) as bigint;

  // Get balance using direct balances mapping
  const balanceDirect = await publicClient.readContract({
    address: plasmaChainAddress,
    abi: plasmaChainAbi,
    functionName: 'balances',
    args: [fromAddress, plasmaTokenAddress],
  }) as bigint;

  // Get nonce
  const nonce = await publicClient.readContract({
    address: plasmaChainAddress,
    abi: plasmaChainAbi,
    functionName: 'nonces',
    args: [fromAddress],
  }) as bigint;

  console.log('Results:');
  console.log('--------');
  console.log('Balance (getBalance):  ', balance.toString(), 'wei');
  console.log('                       ', formatEther(balance), 'PLASMA');
  console.log('');
  console.log('Balance (direct map):  ', balanceDirect.toString(), 'wei');
  console.log('                       ', formatEther(balanceDirect), 'PLASMA');
  console.log('');
  console.log('Nonce:                 ', nonce.toString());
  console.log('');

  // Test arithmetic
  const transferAmount = parseEther('3');
  console.log('Transfer amount:       ', transferAmount.toString(), 'wei');
  console.log('                       ', formatEther(transferAmount), 'PLASMA');
  console.log('');
  console.log('Comparison:');
  console.log('  balance >= amount:   ', balance >= transferAmount);
  console.log('  balance - amount:    ', balance >= transferAmount ? (balance - transferAmount).toString() : 'WOULD UNDERFLOW');
}

main().catch(console.error);
