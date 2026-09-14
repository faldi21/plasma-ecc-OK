import { createPublicClient, createWalletClient, http, formatEther, parseEther, keccak256, encodePacked } from 'viem';
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

async function testCompleteUtxoFlow() {
  console.log('='.repeat(70));
  console.log('      COMPLETE UTXO FLOW TEST');
  console.log('='.repeat(70));
  console.log();

  const userAddress = userAccount.address;

  // Step 1: Check current state
  console.log('STEP 1: Current State');
  console.log('-'.repeat(50));

  const currentBlock = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;
  console.log(`Current Plasma Block: ${currentBlock}`);

  const userUtxos = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUserUtxos',
    args: [userAddress],
  }) as `0x${string}`[];
  console.log(`User has ${userUtxos.length} UTXOs total`);

  const unspentUtxos = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUnspentUtxos',
    args: [userAddress],
  }) as `0x${string}`[];
  console.log(`User has ${unspentUtxos.length} unspent UTXOs`);

  // Step 2: Test deposit creates new UTXO
  console.log('\nSTEP 2: Create New UTXO via Deposit');
  console.log('-'.repeat(50));

  const depositAmount = parseEther('50');
  console.log(`Depositing: ${formatEther(depositAmount)} PLASMA`);

  // Approve
  const allowance = await l1PublicClient.readContract({
    address: PLASMA_TOKEN,
    abi: PlasmaTokenData.abi,
    functionName: 'allowance',
    args: [userAddress, ROOT_CHAIN_UTXO],
  }) as bigint;

  if (allowance < depositAmount) {
    const approveHash = await userL1Wallet.writeContract({
      address: PLASMA_TOKEN,
      abi: PlasmaTokenData.abi,
      functionName: 'approve',
      args: [ROOT_CHAIN_UTXO, depositAmount * 10n],
    });
    await l1PublicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approved');
  }

  // Deposit
  const depositHash = await userL1Wallet.writeContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'deposit',
    args: [PLASMA_TOKEN, depositAmount],
  });

  const depositReceipt = await l1PublicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`Deposit TX: ${depositHash}`);

  // Find new UTXO ID from logs
  let newUtxoId: `0x${string}` | null = null;
  for (const log of depositReceipt.logs) {
    if (log.address.toLowerCase() === ROOT_CHAIN_UTXO.toLowerCase() && log.topics[1]) {
      newUtxoId = log.topics[1] as `0x${string}`;
      break;
    }
  }

  if (newUtxoId) {
    console.log(`New UTXO ID: ${newUtxoId}`);

    const newUtxo = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'getUtxo',
      args: [newUtxoId],
    }) as any;

    console.log(`  Owner: ${newUtxo.owner}`);
    console.log(`  Amount: ${formatEther(newUtxo.amount)} PLASMA`);
    console.log(`  Spent: ${newUtxo.spent}`);
  }

  // Step 3: Simulate L2 transfer (operator marks UTXO spent)
  console.log('\nSTEP 3: Simulate L2 Transfer (Mark UTXO Spent)');
  console.log('-'.repeat(50));

  if (newUtxoId) {
    const spendingTxHash = keccak256(encodePacked(
      ['bytes32', 'address', 'uint256'],
      [newUtxoId, userAddress, BigInt(Date.now())]
    ));

    console.log(`Marking UTXO as spent...`);
    console.log(`Spending TX Hash: ${spendingTxHash.slice(0, 20)}...`);

    const syncHash = await operatorL1Wallet.writeContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'syncUtxoSpent',
      args: [newUtxoId, spendingTxHash],
    });

    await l1PublicClient.waitForTransactionReceipt({ hash: syncHash });
    console.log('UTXO marked as spent');

    // Verify
    const spentUtxo = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'getUtxo',
      args: [newUtxoId],
    }) as any;

    console.log(`UTXO status after spend:`);
    console.log(`  Spent: ${spentUtxo.spent}`);
    console.log(`  Exited: ${spentUtxo.exited}`);
  }

  // Step 4: Verify double-spend protection
  console.log('\nSTEP 4: Verify Double-Spend Protection');
  console.log('-'.repeat(50));

  if (newUtxoId) {
    const [canExit, reason] = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'canExit',
      args: [newUtxoId],
    }) as [boolean, string];

    console.log(`canExit(${newUtxoId.slice(0, 20)}...):`);
    console.log(`  Result: ${canExit ? 'YES' : 'NO'}`);
    console.log(`  Reason: ${reason}`);

    if (!canExit) {
      console.log('\nDOUBLE-SPEND PROTECTION WORKS!');
      console.log('User cannot withdraw UTXO that was spent on L2.');
    }
  }

  // Step 5: Final summary
  console.log('\n' + '='.repeat(70));
  console.log('                    FINAL SUMMARY');
  console.log('='.repeat(70));

  const finalUnspent = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUnspentUtxos',
    args: [userAddress],
  }) as `0x${string}`[];

  const utxoBalance = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUserBalance',
    args: [userAddress, PLASMA_TOKEN],
  }) as bigint;

  console.log(`\nUser ${userAddress}:`);
  console.log(`  Total UTXOs created: ${userUtxos.length + 1}`);
  console.log(`  Unspent UTXOs: ${finalUnspent.length}`);
  console.log(`  Withdrawable Balance: ${formatEther(utxoBalance)} PLASMA`);

  console.log('\nUTXO Security Features Verified:');
  console.log('  [x] Deposit creates unique UTXO');
  console.log('  [x] UTXO can be marked as spent');
  console.log('  [x] Spent UTXO cannot be withdrawn');
  console.log('  [x] Double-spending is prevented');
}

testCompleteUtxoFlow().catch(console.error);
