import { createPublicClient, http, keccak256, toHex } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import BN from 'bn.js';
import elliptic from 'elliptic';

dotenv.config();

const EC = elliptic.ec;
const ec = new EC('secp256k1');
const G = ec.g;
const N = new BN('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16);

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function diagnose() {
  console.log('=== DIAGNOSING DEPLOYED CONTRACT ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;

  // Test 1: Check if contract has correct constants
  console.log('Test 1: Checking ECC constants...');

  // We can't directly read constants, but we can test behavior
  // Let's use a simple element and see if the math matches

  // Create a test txHash
  const testTxHash = keccak256(toHex('test123'));
  console.log(`Test txHash: ${testTxHash}`);

  // Calculate what elementPoint should be using our backend logic
  const txHashBN = new BN(testTxHash.slice(2), 16);

  // This is what elliptic.js does (no manual modulo)
  const elementPoint = G.mul(txHashBN);

  console.log(`Expected element point:`);
  console.log(`  X: 0x${elementPoint.getX().toString(16)}`);
  console.log(`  Y: 0x${elementPoint.getY().toString(16)}`);

  // Now let's check actual contract behavior
  console.log('\nTest 2: Checking actual contract accumulator state...');

  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  console.log(`Current plasma block: ${currentBlock}`);

  if (currentBlock === 0n) {
    console.log('❌ No blocks submitted. Cannot test further.');
    return;
  }

  // Get the submitted block's accumulator value
  const blockData = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'plasmaBlocks',
    args: [currentBlock],
  }) as any;

  console.log(`\nBlock ${currentBlock} data:`, blockData);

  if (blockData && blockData[1]) {
    console.log(`Block ${currentBlock} accumulator:`);
    console.log(`  X: ${blockData[1].x ||blockData[1][0]}`);
    console.log(`  Y: ${blockData[1].y || blockData[1][1]}`);
  }

  // Get current accumulator from contract
  const contractAcc = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'getAccumulatorValue',
  }) as any;

  console.log(`\nCurrent contract accumulator:`);
  console.log(`  X: ${contractAcc.x}`);
  console.log(`  Y: ${contractAcc.y}`);

  // Compare with backend
  const backendResp = await fetch('http://localhost:3001/api/accumulator/value');
  const backendData = await backendResp.json();

  console.log(`\nBackend accumulator:`);
  console.log(`  X: ${backendData.accumulator.x}`);
  console.log(`  Y: ${backendData.accumulator.y}`);

  const contractX = BigInt(contractAcc.x);
  const contractY = BigInt(contractAcc.y);
  const backendX = BigInt(backendData.accumulator.x);
  const backendY = BigInt(backendData.accumulator.y);

  console.log(`\n=== COMPARISON ===`);
  console.log(`Contract X == Backend X? ${contractX === backendX}`);
  console.log(`Contract Y == Backend Y? ${contractY === backendY}`);

  if (contractX !== backendX || contractY !== backendY) {
    console.log(`\n❌ MISMATCH DETECTED!`);
    console.log(`Contract and backend are using different ECC implementations!`);
    console.log(`\nPossible causes:`);
    console.log(`1. Contract was not redeployed with the fix`);
    console.log(`2. Backend used old contract ABI`);
    console.log(`3. submitBlock sent wrong accumulator value`);
  } else {
    console.log(`\n✅ Contract and backend match!`);
    console.log(`The deployed contract is using the correct ECC logic.`);
  }

  // Test 3: Check deployment timestamp
  console.log(`\n=== DEPLOYMENT INFO ===`);
  console.log(`Contract address: ${rootChainAddress}`);

  // Get contract creation block
  const code = await publicClient.getBytecode({ address: rootChainAddress });
  console.log(`Bytecode size: ${code?.length || 0} bytes`);
}

diagnose().catch(console.error);
