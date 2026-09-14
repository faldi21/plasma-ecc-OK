import { createPublicClient, createWalletClient, http, formatEther, parseEther, encodeFunctionData } from 'viem';
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

const operatorL2Wallet = createWalletClient({
  chain: anvilChain as any,
  transport: http(process.env.L2_RPC_URL),
  account: operatorAccount,
});

// Contract addresses
const ROOT_CHAIN_UTXO = process.env.ROOT_CHAIN_UTXO_ADDRESS as `0x${string}`;
const PLASMA_CHAIN_UTXO = process.env.PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`;
const PLASMA_TOKEN = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;

async function testUtxoFlow() {
  console.log('='.repeat(70));
  console.log('         UTXO PLASMA CHAIN - FLOW TEST');
  console.log('='.repeat(70));
  console.log();

  // Step 1: Check contracts
  console.log('STEP 1: Checking contracts...');
  console.log('-'.repeat(50));

  try {
    const isActive = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'isPlasmaActive',
    });
    console.log(`L1 RootChainUTXO: ${ROOT_CHAIN_UTXO}`);
    console.log(`   Active: ${isActive}`);

    const l2Code = await l2PublicClient.getBytecode({ address: PLASMA_CHAIN_UTXO });
    console.log(`L2 PlasmaChainUTXO: ${PLASMA_CHAIN_UTXO}`);
    console.log(`   Deployed: ${l2Code && l2Code.length > 2 ? 'Yes' : 'No'}`);
  } catch (e: any) {
    console.error('Error checking contracts:', e.message);
    return;
  }

  // Step 2: Check user's token balance
  console.log('\nSTEP 2: Checking user token balance...');
  console.log('-'.repeat(50));

  const userAddress = userAccount.address;
  console.log(`User address: ${userAddress}`);

  const tokenBalance = await l1PublicClient.readContract({
    address: PLASMA_TOKEN,
    abi: PlasmaTokenData.abi,
    functionName: 'balanceOf',
    args: [userAddress],
  }) as bigint;

  console.log(`Token balance: ${formatEther(tokenBalance)} PLASMA`);

  if (tokenBalance < parseEther('100')) {
    console.log('\nInsufficient token balance. Minting some tokens first...');
    // For testing - mint tokens (if allowed)
    console.log('Note: Token minting should be done via owner');
    return;
  }

  // Step 3: Approve and Deposit
  console.log('\nSTEP 3: Approving and Depositing tokens...');
  console.log('-'.repeat(50));

  const depositAmount = parseEther('100');
  console.log(`Deposit amount: ${formatEther(depositAmount)} PLASMA`);

  // Check allowance
  const allowance = await l1PublicClient.readContract({
    address: PLASMA_TOKEN,
    abi: PlasmaTokenData.abi,
    functionName: 'allowance',
    args: [userAddress, ROOT_CHAIN_UTXO],
  }) as bigint;

  if (allowance < depositAmount) {
    console.log('Approving tokens...');
    const approveHash = await userL1Wallet.writeContract({
      address: PLASMA_TOKEN,
      abi: PlasmaTokenData.abi,
      functionName: 'approve',
      args: [ROOT_CHAIN_UTXO, depositAmount],
    });
    console.log(`Approve TX: ${approveHash}`);
    await l1PublicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approved!');
  } else {
    console.log('Already approved');
  }

  // Deposit
  console.log('\nDepositing tokens...');
  try {
    const depositHash = await userL1Wallet.writeContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'deposit',
      args: [PLASMA_TOKEN, depositAmount],
    });

    console.log(`Deposit TX: ${depositHash}`);
    const depositReceipt = await l1PublicClient.waitForTransactionReceipt({ hash: depositHash });

    if (depositReceipt.status === 'success') {
      console.log('Deposit SUCCESS!');

      // Parse logs to get UTXO ID
      const depositEvent = depositReceipt.logs.find(log => {
        try {
          return log.address.toLowerCase() === ROOT_CHAIN_UTXO.toLowerCase();
        } catch {
          return false;
        }
      });

      if (depositEvent) {
        console.log(`UTXO created in log topic: ${depositEvent.topics[1]}`);
      }
    } else {
      console.log('Deposit FAILED');
      return;
    }
  } catch (e: any) {
    console.error('Deposit error:', e.message);
    return;
  }

  // Step 4: Check user's UTXOs
  console.log('\nSTEP 4: Checking user UTXOs on L1...');
  console.log('-'.repeat(50));

  const userUtxos = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUserUtxos',
    args: [userAddress],
  }) as `0x${string}`[];

  console.log(`User has ${userUtxos.length} UTXOs`);

  for (let i = 0; i < userUtxos.length; i++) {
    const utxoId = userUtxos[i];
    const utxo = await l1PublicClient.readContract({
      address: ROOT_CHAIN_UTXO,
      abi: RootChainUTXOData.abi,
      functionName: 'getUtxo',
      args: [utxoId],
    }) as any;

    console.log(`\nUTXO ${i + 1}:`);
    console.log(`   ID: ${utxoId}`);
    console.log(`   Owner: ${utxo.owner}`);
    console.log(`   Amount: ${formatEther(utxo.amount)} PLASMA`);
    console.log(`   Spent: ${utxo.spent}`);
    console.log(`   Exited: ${utxo.exited}`);
  }

  // Step 5: Check unspent UTXOs
  console.log('\nSTEP 5: Checking unspent UTXOs...');
  console.log('-'.repeat(50));

  const unspentUtxos = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUnspentUtxos',
    args: [userAddress],
  }) as `0x${string}`[];

  console.log(`Unspent UTXOs: ${unspentUtxos.length}`);

  // Step 6: Get user total balance
  console.log('\nSTEP 6: Getting total UTXO balance...');
  console.log('-'.repeat(50));

  const utxoBalance = await l1PublicClient.readContract({
    address: ROOT_CHAIN_UTXO,
    abi: RootChainUTXOData.abi,
    functionName: 'getUserBalance',
    args: [userAddress, PLASMA_TOKEN],
  }) as bigint;

  console.log(`Total UTXO balance: ${formatEther(utxoBalance)} PLASMA`);

  console.log('\n' + '='.repeat(70));
  console.log('                     TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('\nSummary:');
  console.log(`  - Deposited: ${formatEther(depositAmount)} PLASMA`);
  console.log(`  - Total UTXOs: ${userUtxos.length}`);
  console.log(`  - Unspent UTXOs: ${unspentUtxos.length}`);
  console.log(`  - UTXO Balance: ${formatEther(utxoBalance)} PLASMA`);
  console.log('\nNext steps:');
  console.log('  1. Operator creates L2 deposit UTXO');
  console.log('  2. User can transfer UTXO on L2');
  console.log('  3. User can start exit to withdraw');
}

testUtxoFlow().catch(console.error);
