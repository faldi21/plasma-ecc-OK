#!/usr/bin/env tsx

/**
 * Aggregated UTXO Withdrawal Script
 *
 * Withdraw any amount (up to total balance) from L2 to L1:
 * 1. Aggregate all user's L2 UTXOs
 * 2. Create Exit UTXO (for withdrawal) + Change UTXO (remaining balance)
 * 3. Operator registers Exit UTXO on L1
 * 4. Start exit on L1 with witness proof
 * 5. Wait for challenge period
 * 6. Finalize exit to receive tokens on L1
 *
 * This solves the limitation where only deposit-originated UTXOs could be withdrawn.
 * Now transfer/change UTXOs can also be withdrawn through aggregation.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type Hex,
  keccak256,
  encodePacked,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

// Environment
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;
const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';
const ROOT_CHAIN_UTXO_ADDRESS = process.env.ROOT_CHAIN_UTXO_ADDRESS as Address;
const PLASMA_CHAIN_UTXO_ADDRESS = process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address;
const PLASMA_TOKEN_ADDRESS = process.env.PLASMA_TOKEN_ADDRESS as Address; // L1 token
const L2_PLASMA_TOKEN_ADDRESS = process.env.L2_PLASMA_TOKEN_ADDRESS as Address; // L2 token
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Operator wallet (must be the Plasma operator)
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY as Hex;

// Chain configs
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [L2_RPC_URL] },
    public: { http: [L2_RPC_URL] },
  },
} as const;

// Load ABIs
const rootChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/RootChainUTXO.json'), 'utf-8')
).abi;

const plasmaChainUtxoAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaChainUTXO.json'), 'utf-8')
).abi;

const plasmaTokenAbi = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/abi/PlasmaToken.json'), 'utf-8')
).abi;

// User wallets
const USER_WALLETS: Record<string, { address: Address; privateKey: Hex }> = {
  A: {
    address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76',
    privateKey: '0x873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080',
  },
  B: {
    address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda',
    privateKey: '0x79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1',
  },
  C: {
    address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab',
    privateKey: '0x070d8f7d287854522182733db1f2f5fc4609480167dced6a1e93213b22694aa3',
  },
};

interface UTXO {
  utxoId: Hex;
  owner: Address;
  token: Address;
  amount: bigint;
  createdInBlock: bigint;
  spent: boolean;
}

/**
 * Get user's total L2 balance
 */
async function getL2Balance(l2Client: any, address: Address, token: Address): Promise<bigint> {
  try {
    return (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserBalance',
      args: [address, token],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Get user's unspent UTXOs from L2
 */
async function getUnspentUtxos(l2Client: any, address: Address): Promise<Hex[]> {
  try {
    return (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUnspentUtxos',
      args: [address],
    })) as Hex[];
  } catch {
    return [];
  }
}

/**
 * Get UTXO details from L2
 */
async function getUtxoDetails(l2Client: any, utxoId: Hex): Promise<UTXO | null> {
  try {
    const result = (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId],
    })) as [Hex, Address, Address, bigint, bigint, boolean];

    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      createdInBlock: result[4],
      spent: result[5],
    };
  } catch {
    return null;
  }
}

/**
 * Get user's nonce from L2
 */
async function getUserNonce(l2Client: any, address: Address): Promise<bigint> {
  try {
    return (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'nonces',
      args: [address],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Get L1 token balance
 */
async function getL1TokenBalance(l1Client: any, address: Address): Promise<bigint> {
  try {
    return (await l1Client.readContract({
      address: PLASMA_TOKEN_ADDRESS,
      abi: plasmaTokenAbi,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/**
 * Get witness from backend
 */
async function getWitness(utxoId: Hex): Promise<{ witness: { x: bigint; y: bigint }; blockNumber: bigint } | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/witness/${utxoId}`);
    const data = await response.json();
    if (data.success && data.witness) {
      return {
        witness: {
          x: BigInt(data.witness.x),
          y: BigInt(data.witness.y),
        },
        blockNumber: BigInt(data.blockNumber),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure Exit UTXO is in accumulator and get witness
 */
async function ensureUtxoInAccumulator(utxoId: Hex): Promise<boolean> {
  try {
    // Check if already has witness
    const checkResponse = await fetch(`${BACKEND_URL}/api/witness/${utxoId}`);
    const checkData = await checkResponse.json();
    if (checkData.success) {
      return true;
    }

    // Add to accumulator
    console.log(`  Adding Exit UTXO to accumulator...`);
    const addResponse = await fetch(`${BACKEND_URL}/api/accumulator/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: utxoId }),
    });
    const addData = await addResponse.json();

    if (!addData.success) {
      console.error(`  Failed to add to accumulator:`, addData.error);
      return false;
    }

    console.log(`  Added to accumulator (size: ${addData.size})`);

    // Submit block to L1
    console.log(`  Submitting block to L1...`);
    const submitResponse = await fetch(`${BACKEND_URL}/api/submit-block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionCount: 1 }),
    });
    const submitData = await submitResponse.json();

    if (!submitData.success) {
      console.error(`  Failed to submit block:`, submitData.error);
      return false;
    }

    console.log(`  Block ${submitData.data.blockNumber} submitted`);
    return true;
  } catch (error: any) {
    console.error(`Error:`, error.message);
    return false;
  }
}

/**
 * Find the correct block for witness verification
 */
async function findCorrectBlockForWitness(
  l1Client: any,
  utxoId: Hex,
  witness: { x: bigint; y: bigint }
): Promise<bigint | null> {
  try {
    const elliptic = await import('elliptic');
    const BN = (await import('bn.js')).default;

    const EC = elliptic.default.ec;
    const ec = new EC('secp256k1');
    const G = ec.g;
    const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

    const utxoIdBN = BigInt(utxoId);
    const scalarMod = utxoIdBN % N;

    const elementPoint = G.mul(new BN(scalarMod.toString(16), 16));
    const witnessPoint = ec.curve.point(
      new BN(witness.x.toString(16), 16),
      new BN(witness.y.toString(16), 16)
    );
    const expectedAcc = witnessPoint.add(elementPoint);

    const expectedX = BigInt('0x' + expectedAcc.getX().toString(16));
    const expectedY = BigInt('0x' + expectedAcc.getY().toString(16));

    const currentBlock = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'currentPlasmaBlock',
    })) as bigint;

    console.log(`  Searching blocks 1 to ${currentBlock}...`);

    for (let blockNum = currentBlock; blockNum >= 1n; blockNum--) {
      const block = (await l1Client.readContract({
        address: ROOT_CHAIN_UTXO_ADDRESS,
        abi: rootChainUtxoAbi,
        functionName: 'plasmaBlocks',
        args: [blockNum],
      })) as [bigint, { x: bigint; y: bigint }, bigint, string, bigint];

      if (block[1].x === expectedX && block[1].y === expectedY) {
        console.log(`  Found matching block: ${blockNum}`);
        return blockNum;
      }
    }

    return null;
  } catch (error: any) {
    console.error(`Error finding block:`, error.message);
    return null;
  }
}

/**
 * Wait with countdown
 */
async function waitWithCountdown(seconds: number, message: string): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r${message}: ${i}s remaining...   `);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  process.stdout.write(`\r${message}: Done!                    \n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('='.repeat(60));
    console.log('         AGGREGATED UTXO WITHDRAWAL');
    console.log('='.repeat(60));
    console.log('');
    console.log('Withdraw any amount (up to total balance) from L2 to L1.');
    console.log('This aggregates all your L2 UTXOs and creates:');
    console.log('  - Exit UTXO (for withdrawal amount)');
    console.log('  - Change UTXO (remaining balance stays on L2)');
    console.log('');
    console.log('Usage: npx tsx functions/6-withdraw-aggregated.ts <USER> <AMOUNT>');
    console.log('');
    console.log('Arguments:');
    console.log('  USER   = A, B, or C');
    console.log('  AMOUNT = Amount to withdraw (in PLASMA tokens)');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx functions/6-withdraw-aggregated.ts A 50');
    console.log('  npx tsx functions/6-withdraw-aggregated.ts B 100');
    console.log('');
    console.log('Users:');
    console.log('  A: 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76');
    console.log('  B: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda');
    console.log('  C: 0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab');
    console.log('='.repeat(60));
    process.exit(1);
  }

  const userKey = args[0].toUpperCase();
  const withdrawAmount = parseEther(args[1]);

  const userWallet = USER_WALLETS[userKey];
  if (!userWallet) {
    console.error('Invalid user. Use A, B, or C.');
    process.exit(1);
  }

  if (!OPERATOR_PRIVATE_KEY) {
    console.error('OPERATOR_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  // Setup clients
  const userAccount = privateKeyToAccount(userWallet.privateKey);
  const operatorAccount = privateKeyToAccount(OPERATOR_PRIVATE_KEY);

  const l1Client = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l1WalletClient = createWalletClient({
    account: userAccount,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l1OperatorClient = createWalletClient({
    account: operatorAccount,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l2Client = createPublicClient({
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  const l2OperatorClient = createWalletClient({
    account: operatorAccount,
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  console.log('='.repeat(60));
  console.log('         AGGREGATED UTXO WITHDRAWAL');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  L1 RPC:           Sepolia`);
  console.log(`  L2 RPC:           ${L2_RPC_URL}`);
  console.log(`  RootChainUTXO:    ${ROOT_CHAIN_UTXO_ADDRESS}`);
  console.log(`  PlasmaChainUTXO:  ${PLASMA_CHAIN_UTXO_ADDRESS}`);
  console.log(`  Operator:         ${operatorAccount.address}`);
  console.log('');
  console.log(`User: ${userKey} (${userWallet.address})`);
  console.log(`Requested Withdrawal: ${formatEther(withdrawAmount)} PLASMA`);
  console.log('='.repeat(60));

  try {
    // Step 1: Check initial balances
    console.log('\n[1/9] Checking initial balances...');
    const initialL1Balance = await getL1TokenBalance(l1Client, userWallet.address);
    const initialL2Balance = await getL2Balance(l2Client, userWallet.address, L2_PLASMA_TOKEN_ADDRESS);

    console.log(`  L1 PLASMA: ${formatEther(initialL1Balance)}`);
    console.log(`  L2 PLASMA: ${formatEther(initialL2Balance)}`);

    if (initialL2Balance === 0n) {
      console.error('\nNo L2 balance to withdraw.');
      process.exit(1);
    }

    if (withdrawAmount > initialL2Balance) {
      console.error(`\nInsufficient balance. Max: ${formatEther(initialL2Balance)} PLASMA`);
      process.exit(1);
    }

    // Step 2: Show UTXOs that will be aggregated
    console.log('\n[2/9] Finding UTXOs to aggregate...');
    const unspentUtxoIds = await getUnspentUtxos(l2Client, userWallet.address);

    console.log(`  Found ${unspentUtxoIds.length} unspent UTXO(s):`);
    for (const utxoId of unspentUtxoIds) {
      const utxo = await getUtxoDetails(l2Client, utxoId);
      if (utxo && utxo.token.toLowerCase() === L2_PLASMA_TOKEN_ADDRESS.toLowerCase()) {
        console.log(`    - ${formatEther(utxo.amount)} PLASMA (${utxoId.slice(0, 20)}...)`);
      }
    }

    // Step 3: User signs the aggregation request
    console.log('\n[3/9] Creating aggregation signature...');
    const nonce = await getUserNonce(l2Client, userWallet.address);

    // Create message hash matching contract: (user, token, withdrawAmount, "AGGREGATE_WITHDRAW", nonce)
    const messageHash = keccak256(
      encodePacked(
        ['address', 'address', 'uint256', 'string', 'uint256'],
        [userWallet.address, L2_PLASMA_TOKEN_ADDRESS, withdrawAmount, 'AGGREGATE_WITHDRAW', nonce]
      )
    );

    // Sign with user's private key
    const signature = await userAccount.signMessage({
      message: { raw: messageHash },
    });

    console.log(`  Nonce: ${nonce}`);
    console.log(`  Message hash: ${messageHash.slice(0, 30)}...`);
    console.log(`  Signature: ${signature.slice(0, 30)}...`);

    // Step 4: Operator calls aggregateForWithdrawal on L2
    console.log('\n[4/9] Aggregating UTXOs on L2 (operator tx)...');

    const aggregateHash = await l2OperatorClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'aggregateForWithdrawal',
      args: [userWallet.address, L2_PLASMA_TOKEN_ADDRESS, withdrawAmount, signature],
    });

    console.log(`  TX Hash: ${aggregateHash}`);
    const aggregateReceipt = await l2Client.waitForTransactionReceipt({ hash: aggregateHash });
    console.log(`  Block: ${aggregateReceipt.blockNumber}`);
    console.log(`  Status: ${aggregateReceipt.status === 'success' ? 'Success' : 'Failed'}`);

    if (aggregateReceipt.status !== 'success') {
      console.error('\nAggregation failed on L2');
      process.exit(1);
    }

    // Parse AggregatedWithdrawalCreated event
    let exitUtxoId: Hex | null = null;
    let changeUtxoId: Hex | null = null;
    let changeAmount = 0n;

    for (const log of aggregateReceipt.logs) {
      if (log.address.toLowerCase() === PLASMA_CHAIN_UTXO_ADDRESS.toLowerCase()) {
        // AggregatedWithdrawalCreated event
        if (log.topics.length >= 4) {
          exitUtxoId = log.topics[1] as Hex;
          // user and token are in topics 2 and 3
          break;
        }
      }
    }

    if (!exitUtxoId) {
      console.error('\nFailed to get Exit UTXO ID from event');
      process.exit(1);
    }

    console.log(`  Exit UTXO ID: ${exitUtxoId.slice(0, 30)}...`);

    // Get change amount from remaining balance
    const newL2Balance = await getL2Balance(l2Client, userWallet.address, L2_PLASMA_TOKEN_ADDRESS);
    changeAmount = newL2Balance;
    console.log(`  Change Amount: ${formatEther(changeAmount)} PLASMA (stays on L2)`);

    // Step 5: Wait for L2 block creation
    console.log('\n[5/9] Waiting for L2 block creation...');
    await waitWithCountdown(5, 'Waiting for L2 block');

    // Step 6: Create L2 block and get current block number
    console.log('\n[6/9] Creating L2 block...');

    const createBlockHash = await l2OperatorClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'createBlock',
      args: [],
    });

    const blockReceipt = await l2Client.waitForTransactionReceipt({ hash: createBlockHash });
    console.log(`  L2 Block created: ${blockReceipt.blockNumber}`);

    // Get current L2 plasma block number
    const l2BlockNumber = (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'currentBlock',
    })) as bigint;

    console.log(`  L2 Plasma Block: ${l2BlockNumber}`);

    // Ensure Exit UTXO is in accumulator
    console.log('\n[7/9] Adding Exit UTXO to accumulator...');
    const inAccumulator = await ensureUtxoInAccumulator(exitUtxoId);
    if (!inAccumulator) {
      console.error('\nFailed to add Exit UTXO to accumulator');
      process.exit(1);
    }

    // Get current L1 plasma block
    const currentL1Block = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'currentPlasmaBlock',
    })) as bigint;

    // Register Exit UTXO on L1
    console.log('\n[8/9] Registering Exit UTXO on L1 (operator tx)...');

    const registerHash = await l1OperatorClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'registerExitUtxo',
      args: [exitUtxoId, userWallet.address, PLASMA_TOKEN_ADDRESS, withdrawAmount, currentL1Block],
    });

    console.log(`  TX Hash: ${registerHash}`);
    const registerReceipt = await l1Client.waitForTransactionReceipt({ hash: registerHash });
    console.log(`  Block: ${registerReceipt.blockNumber}`);
    console.log(`  Status: ${registerReceipt.status === 'success' ? 'Success' : 'Failed'}`);

    if (registerReceipt.status !== 'success') {
      console.error('\nFailed to register Exit UTXO on L1');
      process.exit(1);
    }

    // Get witness for Exit UTXO
    const witnessData = await getWitness(exitUtxoId);
    if (!witnessData) {
      console.error('\nFailed to get witness for Exit UTXO');
      process.exit(1);
    }

    const { witness } = witnessData;
    const correctBlock = witnessData.blockNumber;

    console.log(`  Witness X: ${witness.x.toString().slice(0, 30)}...`);
    console.log(`  Using block: ${correctBlock}`);

    // Start exit on L1
    console.log('\n[9/9] Starting exit on L1...');

    const startExitHash = await l1WalletClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'startExit',
      args: [exitUtxoId, correctBlock, witness],
    });

    console.log(`  TX Hash: ${startExitHash}`);
    const exitReceipt = await l1Client.waitForTransactionReceipt({ hash: startExitHash });
    console.log(`  Block: ${exitReceipt.blockNumber}`);

    // Get exit ID
    let exitId: Hex | null = null;
    for (const log of exitReceipt.logs) {
      if (log.address.toLowerCase() === ROOT_CHAIN_UTXO_ADDRESS.toLowerCase()) {
        if (log.topics.length >= 2) {
          exitId = log.topics[1] as Hex;
          break;
        }
      }
    }

    if (!exitId) {
      console.error('\nFailed to get exit ID');
      process.exit(1);
    }

    console.log(`  Exit ID: ${exitId}`);

    // Wait for exit period
    console.log('\n[10/10] Waiting for exit period (7 minutes + buffer)...');
    console.log('  Exit period is 7 minutes for testing.');
    await waitWithCountdown(480, 'Exit period');

    // Finalize exit
    console.log('\nFinalizing exit...');
    const finalizeHash = await l1WalletClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'finalizeExit',
      args: [exitId],
    });

    console.log(`  TX Hash: ${finalizeHash}`);
    const finalizeReceipt = await l1Client.waitForTransactionReceipt({ hash: finalizeHash });
    console.log(`  Block: ${finalizeReceipt.blockNumber}`);

    // Show final results
    console.log('\n' + '='.repeat(60));
    console.log('         WITHDRAWAL COMPLETE!');
    console.log('='.repeat(60));

    const finalL1Balance = await getL1TokenBalance(l1Client, userWallet.address);
    const finalL2Balance = await getL2Balance(l2Client, userWallet.address, L2_PLASMA_TOKEN_ADDRESS);

    console.log('\nBalance Changes:');
    console.log('  L1 PLASMA:');
    console.log(`    Before: ${formatEther(initialL1Balance)}`);
    console.log(`    After:  ${formatEther(finalL1Balance)}`);
    console.log(`    Change: +${formatEther(finalL1Balance - initialL1Balance)}`);
    console.log('');
    console.log('  L2 PLASMA:');
    console.log(`    Before: ${formatEther(initialL2Balance)}`);
    console.log(`    After:  ${formatEther(finalL2Balance)}`);
    console.log(`    Change: -${formatEther(initialL2Balance - finalL2Balance)}`);

    console.log('\nWithdrawal Summary:');
    console.log(`  Withdrawn: ${formatEther(withdrawAmount)} PLASMA`);
    console.log(`  Remaining on L2: ${formatEther(finalL2Balance)} PLASMA`);

    console.log('\n' + '='.repeat(60));

  } catch (error: any) {
    console.error('\nWithdrawal failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
    process.exit(1);
  }
}

main();
