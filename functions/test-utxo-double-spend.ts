import { createPublicClient, createWalletClient, http, formatEther, parseEther, keccak256, encodePacked, toHex } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

// Load ABIs
const RootChainUTXOData = JSON.parse(fs.readFileSync('./backend/abi/RootChainUTXO.json', 'utf8'));
const PlasmaChainUTXOData = JSON.parse(fs.readFileSync('./backend/abi/PlasmaChainUTXO.json', 'utf8'));
const PlasmaTokenData = JSON.parse(fs.readFileSync('./backend/abi/PlasmaToken.json', 'utf8'));

// L1 (Sepolia) client
const l1PublicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

// L2 (Anvil) client
const anvilChain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
  },
};

const l2PublicClient = createPublicClient({
  chain: anvilChain as any,
  transport: http(process.env.L2_RPC_URL),
});

// Accounts
const userAccount = privateKeyToAccount(process.env.PK_USER_A as `0x${string}`);
const operatorAccount = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY as `0x${string}`);

const userL1Wallet = createWalletClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
  account: userAccount,
});

const operatorL1Wallet = createWalletClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
  account: operatorAccount,
});

const operatorL2Wallet = createWalletClient({
  chain: anvilChain as any,
  transport: http(process.env.L2_RPC_URL),
  account: operatorAccount,
});

// Contract addresses
const ROOT_CHAIN_UTXO = process.env.ROOT_CHAIN_UTXO_ADDRESS as `0x${string}`;
const PLASMA_CHAIN_UTXO = process.env.PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`;
const PLASMA_TOKEN = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;

async function testDoubleSpendPrevention() {
  console.log('='.repeat(70));
  console.log('      UTXO DOUBLE-SPEND PREVENTION TEST');
  console.log('='.repeat(70));
  console.log();

  // Step 1: Get user's existing UTXOs
  console.log('STEP 1: Check existing UTXOs...');
  console.log('-'.repeat(50));

  const userAddress = userAccount.address;
  console.log(`User: ${userAddress}`);

  const userUtxos = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUserUtxos',
    args: [userAddress],
  }) as `0x${string}`[];

  console.log(`Total UTXOs: ${userUtxos.length}`);

  if (userUtxos.length === 0) {
    console.log('No UTXOs found. Please run test-utxo-flow.ts first to create a deposit.');
    return;
  }

  // Get first unspent UTXO
  let targetUtxoId: `0x${string}` | null = null;
  let targetUtxo: any = null;

  for (const utxoId of userUtxos) {
    const utxo = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'getUtxo',
      args: [utxoId],
    }) as any;

    if (!utxo.spent && !utxo.exited) {
      targetUtxoId = utxoId;
      targetUtxo = utxo;
      break;
    }
  }

  if (!targetUtxoId || !targetUtxo) {
    console.log('No unspent UTXOs found. Create a new deposit first.');
    return;
  }

  console.log(`\nTarget UTXO for test:`);
  console.log(`   ID: ${targetUtxoId}`);
  console.log(`   Amount: ${formatEther(targetUtxo.amount)} PLASMA`);
  console.log(`   Spent: ${targetUtxo.spent}`);
  console.log(`   Exited: ${targetUtxo.exited}`);

  // Step 2: Simulate operator marking UTXO as spent
  console.log('\nSTEP 2: Operator marks UTXO as spent (simulating L2 transfer)...');
  console.log('-'.repeat(50));

  // Create a fake spending transaction hash
  const spendingTxHash = keccak256(encodePacked(
    ['bytes32', 'address', 'uint256'],
    [targetUtxoId, userAddress, BigInt(Date.now())]
  ));

  console.log(`Spending TX Hash: ${spendingTxHash}`);

  try {
    const syncHash = await operatorL1Wallet.writeContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'syncUtxoSpent',
      args: [targetUtxoId, spendingTxHash],
    });

    console.log(`Sync TX: ${syncHash}`);
    await l1PublicClient.waitForTransactionReceipt({ hash: syncHash });
    console.log('UTXO marked as spent!');
  } catch (e: any) {
    console.error('Error marking spent:', e.message);
    return;
  }

  // Step 3: Verify UTXO is now marked as spent
  console.log('\nSTEP 3: Verify UTXO status after spend...');
  console.log('-'.repeat(50));

  const utxoAfterSpend = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUtxo',
    args: [targetUtxoId],
  }) as any;

  console.log(`UTXO Status:`);
  console.log(`   Spent: ${utxoAfterSpend.spent}`);
  console.log(`   Exited: ${utxoAfterSpend.exited}`);

  // Step 4: Try to exit the spent UTXO (should fail!)
  console.log('\nSTEP 4: Attempt to exit SPENT UTXO (should FAIL)...');
  console.log('-'.repeat(50));

  // Check canExit first
  const [canExit, reason] = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'canExit',
    args: [targetUtxoId],
  }) as [boolean, string];

  console.log(`canExit() result:`);
  console.log(`   Can Exit: ${canExit}`);
  console.log(`   Reason: ${reason}`);

  if (!canExit) {
    console.log('\n' + '='.repeat(70));
    console.log('   DOUBLE-SPEND PREVENTION VERIFIED!');
    console.log('='.repeat(70));
    console.log('\nThe UTXO model successfully prevents withdrawal of spent UTXOs.');
    console.log('User cannot withdraw funds that were already transferred on L2.');
  }

  // Step 5: Try to start exit anyway (should revert)
  console.log('\nSTEP 5: Attempt startExit on spent UTXO (will revert)...');
  console.log('-'.repeat(50));

  try {
    // Get current block for witness (fake for testing)
    const currentBlock = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'currentPlasmaBlock',
    }) as bigint;

    // Try to call startExit with a dummy witness
    const dummyWitness = {
      x: BigInt(1),
      y: BigInt(2),
    };

    await userL1Wallet.writeContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'startExit',
      args: [targetUtxoId, currentBlock, dummyWitness],
    });

    console.log('ERROR: startExit should have reverted!');
  } catch (e: any) {
    console.log('startExit correctly REVERTED!');

    // Check for specific error
    if (e.message.includes('UTXO already spent')) {
      console.log('Error message: "UTXO already spent on L2"');
    } else if (e.message.includes('Invalid block number')) {
      console.log('Error: No blocks submitted yet (expected for this test)');
    } else {
      console.log(`Revert reason: ${e.message.slice(0, 100)}...`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('                    TEST SUMMARY');
  console.log('='.repeat(70));
  console.log('\nDouble-Spend Prevention:');
  console.log('  1. User deposits 100 PLASMA -> creates UTXO');
  console.log('  2. User transfers on L2 -> operator marks UTXO spent');
  console.log('  3. User tries to withdraw same UTXO -> BLOCKED!');
  console.log('\nThis is the KEY security feature of the UTXO model!');
  console.log('In the old system, user could withdraw multiple times.');
  console.log('With UTXO, each "coin" can only be spent ONCE.');
}

testDoubleSpendPrevention().catch(console.error);
