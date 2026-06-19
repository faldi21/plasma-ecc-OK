#!/usr/bin/env tsx

/**
 * UTXO Withdrawal Script
 *
 * Withdraw PLASMA tokens from L2 to L1:
 * 1. Select UTXO to withdraw
 * 2. Request withdrawal on L2 (marks UTXO as spent)
 * 3. Get witness from backend
 * 4. Start exit on L1 with witness proof
 * 5. Wait for challenge period (4 min for testing)
 * 6. Finalize exit to receive tokens on L1
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type Hex,
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
const PLASMA_TOKEN_ADDRESS = process.env.PLASMA_TOKEN_ADDRESS as Address;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

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

interface L1UTXO extends UTXO {
  exited: boolean;
  existsOnL1: boolean;
}

/**
 * Get user's UTXOs from L2 contract
 */
async function getUtxosFromL2(l2Client: any, address: Address): Promise<Hex[]> {
  try {
    const utxoIds = (await l2Client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [address],
    })) as Hex[];
    return utxoIds;
  } catch (error: any) {
    console.error(`Error getting UTXOs:`, error.message);
    return [];
  }
}

/**
 * Get UTXO details from L2 contract
 */
async function getUtxoDetailsL2(l2Client: any, utxoId: Hex): Promise<UTXO | null> {
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
  } catch (error: any) {
    console.error(`Error getting UTXO details:`, error.message);
    return null;
  }
}

/**
 * Check if UTXO exists on L1 (RootChainUTXO)
 * Only deposit-originated UTXOs exist on L1
 * Transfer/change UTXOs only exist on L2
 */
async function checkUtxoExistsOnL1(l1Client: any, utxoId: Hex): Promise<L1UTXO | null> {
  try {
    const result = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId],
    })) as [Hex, Address, Address, bigint, bigint, boolean, boolean];

    // L1 UTXO struct: utxoId, owner, token, amount, createdInBlock, spent, exited
    // If utxoId is zero, UTXO doesn't exist
    if (result[0] === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }

    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      createdInBlock: result[4],
      spent: result[5],
      exited: result[6],
      existsOnL1: true,
    };
  } catch (error: any) {
    // UTXO doesn't exist on L1
    return null;
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
 * Get L2 balance from UTXOs
 */
async function getL2Balance(l2Client: any, address: Address): Promise<bigint> {
  const utxoIds = await getUtxosFromL2(l2Client, address);
  let total = 0n;
  for (const utxoId of utxoIds) {
    const utxo = await getUtxoDetailsL2(l2Client, utxoId);
    if (utxo && !utxo.spent) {
      total += utxo.amount;
    }
  }
  return total;
}

/**
 * Ensure UTXO is in accumulator (add if not present)
 */
async function ensureUtxoInAccumulator(utxoId: Hex): Promise<boolean> {
  try {
    // First check if UTXO already has a witness
    const checkResponse = await fetch(`${BACKEND_URL}/api/witness/${utxoId}`);
    const checkData = await checkResponse.json();
    if (checkData.success) {
      return true; // Already in accumulator
    }

    // Add to accumulator
    console.log(`  Adding UTXO to accumulator...`);
    const addResponse = await fetch(`${BACKEND_URL}/api/accumulator/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: utxoId }),
    });
    const addData = await addResponse.json();

    if (!addData.success) {
      console.error(`  Failed to add UTXO to accumulator:`, addData.error);
      return false;
    }

    console.log(`  UTXO added to accumulator (size: ${addData.size})`);

    // Submit block to L1 so witness is valid
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

    console.log(`  Block ${submitData.data.blockNumber} submitted successfully`);
    return true;
  } catch (error: any) {
    console.error(`Error ensuring UTXO in accumulator:`, error.message);
    return false;
  }
}

/**
 * Get witness from backend
 */
async function getWitness(utxoId: Hex): Promise<{ x: bigint; y: bigint } | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/witness/${utxoId}`);
    const data = await response.json();
    if (data.success && data.witness) {
      return {
        x: BigInt(data.witness.x),
        y: BigInt(data.witness.y),
      };
    }
    return null;
  } catch (error: any) {
    console.error(`Error getting witness:`, error.message);
    return null;
  }
}

/**
 * Find the correct block number for witness verification
 * The witness is valid for the block where witness + utxoId*G == blockAccumulator
 * We search from most recent block backwards
 */
async function findCorrectBlockForWitness(
  l1Client: any,
  utxoId: Hex,
  witness: { x: bigint; y: bigint }
): Promise<bigint | null> {
  try {
    // Import elliptic for EC math
    const elliptic = await import('elliptic');
    const BN = (await import('bn.js')).default;

    const EC = elliptic.default.ec;
    const ec = new EC('secp256k1');
    const G = ec.g;
    const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

    // Compute expected accumulator: witness + utxoId*G
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

    // Get current block number
    const currentBlock = (await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'currentPlasmaBlock',
    })) as bigint;

    console.log(`  Searching for matching block (1 to ${currentBlock})...`);
    console.log(`  Expected Acc X: ${expectedX.toString(16).slice(0, 20)}...`);

    // Search from most recent to oldest
    for (let blockNum = currentBlock; blockNum >= 1n; blockNum--) {
      const block = (await l1Client.readContract({
        address: ROOT_CHAIN_UTXO_ADDRESS,
        abi: rootChainUtxoAbi,
        functionName: 'plasmaBlocks',
        args: [blockNum],
      })) as [bigint, { x: bigint; y: bigint }, bigint, string, bigint];

      const blockAccX = block[1].x;
      const blockAccY = block[1].y;

      if (blockAccX === expectedX && blockAccY === expectedY) {
        console.log(`  Found matching block: ${blockNum}`);
        return blockNum;
      }
    }

    console.log('  No matching block found!');
    return null;
  } catch (error: any) {
    console.error(`Error finding block:`, error.message);
    return null;
  }
}

/**
 * Get exit info from L1
 */
async function getExitInfo(l1Client: any, exitId: Hex): Promise<any> {
  try {
    return await l1Client.readContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'getExit',
      args: [exitId],
    });
  } catch {
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

  if (args.length < 1) {
    console.log('='.repeat(60));
    console.log('         UTXO WITHDRAWAL');
    console.log('='.repeat(60));
    console.log('');
    console.log('Usage: npx tsx functions/5-withdraw-utxo.ts <USER> [AMOUNT]');
    console.log('');
    console.log('Arguments:');
    console.log('  USER   = A, B, or C');
    console.log('  AMOUNT = Amount to withdraw (optional, defaults to first UTXO)');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx functions/5-withdraw-utxo.ts A');
    console.log('  npx tsx functions/5-withdraw-utxo.ts A 100');
    console.log('');
    console.log('Users:');
    console.log('  A: 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76');
    console.log('  B: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda');
    console.log('  C: 0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab');
    console.log('='.repeat(60));
    process.exit(1);
  }

  const userKey = args[0].toUpperCase();
  const requestedAmount = args[1] ? parseEther(args[1]) : null;

  const userWallet = USER_WALLETS[userKey];
  if (!userWallet) {
    console.error('Invalid user. Use A, B, or C.');
    process.exit(1);
  }

  // Setup clients
  const account = privateKeyToAccount(userWallet.privateKey);

  const l1Client = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l1WalletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const l2Client = createPublicClient({
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  const l2WalletClient = createWalletClient({
    account,
    chain: l2Chain,
    transport: http(L2_RPC_URL),
  });

  console.log('='.repeat(60));
  console.log('         UTXO WITHDRAWAL');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  L1 RPC:           Sepolia`);
  console.log(`  L2 RPC:           ${L2_RPC_URL}`);
  console.log(`  RootChainUTXO:    ${ROOT_CHAIN_UTXO_ADDRESS}`);
  console.log(`  PlasmaChainUTXO:  ${PLASMA_CHAIN_UTXO_ADDRESS}`);
  console.log('');
  console.log(`User: ${userKey} (${userWallet.address})`);
  console.log('='.repeat(60));

  try {
    // Step 1: Get initial balances
    console.log('\n[1/8] Checking initial balances...');
    const initialL1Balance = await getL1TokenBalance(l1Client, userWallet.address);
    const initialL2Balance = await getL2Balance(l2Client, userWallet.address);

    console.log(`  L1 PLASMA: ${formatEther(initialL1Balance)}`);
    console.log(`  L2 PLASMA: ${formatEther(initialL2Balance)}`);

    if (initialL2Balance === 0n) {
      console.error('\nNo L2 balance to withdraw.');
      process.exit(1);
    }

    // Step 2: Find UTXO to withdraw (must exist on L1)
    console.log('\n[2/8] Finding withdrawable UTXO...');
    console.log('  Note: Only deposit-originated UTXOs can be withdrawn.');
    console.log('  Transfer/change UTXOs exist only on L2 and cannot be withdrawn directly.\n');

    const utxoIds = await getUtxosFromL2(l2Client, userWallet.address);

    // Categorize UTXOs
    const withdrawableUtxos: L1UTXO[] = [];
    const l2OnlyUtxos: UTXO[] = [];

    for (const utxoId of utxoIds) {
      const l2Utxo = await getUtxoDetailsL2(l2Client, utxoId);
      if (!l2Utxo || l2Utxo.spent) continue;

      // Check if this UTXO exists on L1
      const l1Utxo = await checkUtxoExistsOnL1(l1Client, utxoId);

      if (l1Utxo && !l1Utxo.exited) {
        withdrawableUtxos.push(l1Utxo);
      } else {
        l2OnlyUtxos.push(l2Utxo);
      }
    }

    // Display all UTXOs with their status
    console.log('  UTXOs found:');
    console.log('  ' + '-'.repeat(56));

    if (withdrawableUtxos.length > 0) {
      console.log('  [WITHDRAWABLE - Deposit UTXOs on L1]:');
      for (const utxo of withdrawableUtxos) {
        console.log(`    - ${formatEther(utxo.amount)} PLASMA (${utxo.utxoId.slice(0, 20)}...)`);
      }
    }

    if (l2OnlyUtxos.length > 0) {
      console.log('  [L2 ONLY - Transfer/Change UTXOs]:');
      for (const utxo of l2OnlyUtxos) {
        console.log(`    - ${formatEther(utxo.amount)} PLASMA (${utxo.utxoId.slice(0, 20)}...) [cannot withdraw]`);
      }
    }
    console.log('  ' + '-'.repeat(56));

    // Select UTXO from withdrawable list
    let selectedUtxo: L1UTXO | null = null;

    for (const utxo of withdrawableUtxos) {
      if (requestedAmount) {
        if (utxo.amount === requestedAmount) {
          selectedUtxo = utxo;
          break;
        }
      } else {
        selectedUtxo = utxo;
        break;
      }
    }

    if (!selectedUtxo) {
      if (withdrawableUtxos.length === 0) {
        console.error('\n  ERROR: No withdrawable UTXOs found!');
        console.error('  Only deposit-originated UTXOs can be withdrawn to L1.');
        if (l2OnlyUtxos.length > 0) {
          console.error(`\n  You have ${l2OnlyUtxos.length} L2-only UTXO(s) from transfers.`);
          console.error('  These are change/transfer UTXOs that only exist on L2.');
          console.error('  To withdraw these, you need to first consolidate them');
          console.error('  through a deposit (deposit from L1 creates withdrawable UTXO).');
        }
      } else if (requestedAmount) {
        console.error(`\n  ERROR: No withdrawable UTXO with amount ${formatEther(requestedAmount)} PLASMA`);
        console.log('\n  Withdrawable UTXOs:');
        for (const utxo of withdrawableUtxos) {
          console.log(`    - ${formatEther(utxo.amount)} PLASMA`);
        }
      }
      process.exit(1);
    }

    console.log(`\n  Selected UTXO: ${selectedUtxo.utxoId.slice(0, 20)}...`);
    console.log(`  Amount: ${formatEther(selectedUtxo.amount)} PLASMA`);
    console.log(`  Type: Deposit UTXO (exists on L1)`);

    // Step 3: Request withdrawal on L2
    console.log('\n[3/8] Requesting withdrawal on L2...');
    // When owner calls directly, signature can be empty
    const emptySignature = '0x' as Hex;
    const withdrawHash = await l2WalletClient.writeContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS,
      abi: plasmaChainUtxoAbi,
      functionName: 'requestWithdrawal',
      args: [selectedUtxo.utxoId, emptySignature],
    });

    console.log(`  TX Hash: ${withdrawHash}`);
    const withdrawReceipt = await l2Client.waitForTransactionReceipt({ hash: withdrawHash });
    console.log(`  Block: ${withdrawReceipt.blockNumber}`);
    console.log(`  Status: ${withdrawReceipt.status === 'success' ? 'Success' : 'Failed'}`);

    if (withdrawReceipt.status !== 'success') {
      console.error('\nWithdrawal request failed on L2');
      process.exit(1);
    }

    // Notify backend
    try {
      await fetch(`${BACKEND_URL}/api/transactions/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'UTXO_WITHDRAWAL',
          utxoId: selectedUtxo.utxoId,
          txHash: withdrawHash,
          from: userWallet.address,
          amount: selectedUtxo.amount.toString(),
        }),
      });
    } catch {
      // Ignore
    }

    // Step 4: Wait for block submission
    console.log('\n[4/8] Waiting for block submission...');
    await waitWithCountdown(35, 'Waiting for auto block submission');

    // Step 5: Ensure UTXO is in accumulator and get witness
    console.log('\n[5/8] Getting witness from backend...');

    // First ensure UTXO is in accumulator (add if needed and submit block)
    const inAccumulator = await ensureUtxoInAccumulator(selectedUtxo.utxoId);
    if (!inAccumulator) {
      console.error('\n  ERROR: Failed to add UTXO to accumulator.');
      process.exit(1);
    }

    const witness = await getWitness(selectedUtxo.utxoId);

    if (!witness) {
      console.error('\n  ERROR: Failed to get witness after adding to accumulator.');
      console.log('  Try checking backend status: curl http://localhost:3001/health');
      process.exit(1);
    }

    console.log(`  Witness X: ${witness.x.toString().slice(0, 30)}...`);
    console.log(`  Witness Y: ${witness.y.toString().slice(0, 30)}...`);

    // Step 6: Start exit on L1
    console.log('\n[6/8] Starting exit on L1...');

    // Find the correct block where witness is valid
    // witness + utxoId*G must equal the block's accumulator
    const correctBlock = await findCorrectBlockForWitness(l1Client, selectedUtxo.utxoId, witness);

    if (!correctBlock) {
      console.error('\n  ERROR: Could not find a valid block for this witness!');
      console.error('  The witness may be invalid or the UTXO was not included in any submitted block.');
      console.error('  This can happen if:');
      console.error('    1. Backend was restarted and lost accumulator state');
      console.error('    2. UTXO was added after the last block submission');
      console.error('  Try waiting for a new block submission and retry.');
      process.exit(1);
    }

    console.log(`  Using L1 Plasma Block: ${correctBlock}`);

    const startExitHash = await l1WalletClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'startExit',
      args: [selectedUtxo.utxoId, correctBlock, witness],
    });

    console.log(`  TX Hash: ${startExitHash}`);
    const exitReceipt = await l1Client.waitForTransactionReceipt({ hash: startExitHash });
    console.log(`  Block: ${exitReceipt.blockNumber}`);
    console.log(`  Gas used: ${exitReceipt.gasUsed}`);

    // Parse ExitStarted event to get exitId
    let exitId: Hex | null = null;
    for (const log of exitReceipt.logs) {
      try {
        // Check if this is ExitStarted event
        if (log.address.toLowerCase() === ROOT_CHAIN_UTXO_ADDRESS.toLowerCase()) {
          // ExitStarted(bytes32 indexed exitId, address indexed owner, uint256 amount, bytes32 indexed utxoId)
          if (log.topics.length >= 2) {
            exitId = log.topics[1] as Hex;
            break;
          }
        }
      } catch {
        // Ignore
      }
    }

    if (!exitId) {
      console.error('\nFailed to get exit ID from transaction');
      process.exit(1);
    }

    console.log(`  Exit ID: ${exitId}`);

    // Step 7: Wait for challenge period
    // EXIT_PERIOD in contract is 7 minutes for testing
    console.log('\n[7/8] Waiting for exit period (7 minutes + buffer)...');
    console.log('  Exit period is 7 minutes for testing.');
    console.log('  In production, this would be 7 days.');
    console.log('  Adding 60s buffer for Sepolia block confirmations.');
    await waitWithCountdown(480, 'Exit period'); // 7 min + 1 min buffer = 8 min = 480s

    // Step 8: Finalize exit
    console.log('\n[8/8] Finalizing exit...');
    const finalizeHash = await l1WalletClient.writeContract({
      address: ROOT_CHAIN_UTXO_ADDRESS,
      abi: rootChainUtxoAbi,
      functionName: 'finalizeExit',
      args: [exitId],
    });

    console.log(`  TX Hash: ${finalizeHash}`);
    const finalizeReceipt = await l1Client.waitForTransactionReceipt({ hash: finalizeHash });
    console.log(`  Block: ${finalizeReceipt.blockNumber}`);
    console.log(`  Gas used: ${finalizeReceipt.gasUsed}`);

    // Verify final balances
    console.log('\n' + '='.repeat(60));
    console.log('         WITHDRAWAL COMPLETE!');
    console.log('='.repeat(60));

    const finalL1Balance = await getL1TokenBalance(l1Client, userWallet.address);
    const finalL2Balance = await getL2Balance(l2Client, userWallet.address);

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

    // Verify balance matches
    const withdrawnAmount = selectedUtxo.amount;
    const l1Increase = finalL1Balance - initialL1Balance;
    const l2Decrease = initialL2Balance - finalL2Balance;

    console.log('\nVerification:');
    if (l1Increase === withdrawnAmount && l2Decrease === withdrawnAmount) {
      console.log('  [OK] L1 increase matches withdrawn amount');
      console.log('  [OK] L2 decrease matches withdrawn amount');
      console.log('  [OK] Balances are consistent!');
    } else {
      console.log(`  [!] Expected: ${formatEther(withdrawnAmount)} PLASMA`);
      console.log(`  [!] L1 increased: ${formatEther(l1Increase)}`);
      console.log(`  [!] L2 decreased: ${formatEther(l2Decrease)}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Withdrawn ${formatEther(withdrawnAmount)} PLASMA from L2 to L1`);
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('\nWithdrawal failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
    process.exit(1);
  }
}

main();
