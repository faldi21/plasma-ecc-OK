#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PlasmaChainABI } from '../backend/abi/PlasmaChain.ts';

// Get current file directory and load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
config({ path: envPath });

console.log(`[dotenv] Loading from: ${envPath}\n`);

// L2 Chain config (Anvil)
const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
    public: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
  },
} as const;

// Use PlasmaChain ABI from backend/abi folder
const plasmaChainAbi = PlasmaChainABI[0].abi;

// Extract balanceOf function for ERC20 (minimal ABI for balance check)
const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💸 Plasma L2 Token Transfer');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nUsage:');
    console.log('  npx tsx 6-transfer-plasma-l2.ts <from_private_key> <to_address> <amount>');
    console.log('\nArguments:');
    console.log('  from_private_key  - Sender private key (0x...)');
    console.log('  to_address        - Recipient address (0x...)');
    console.log('  amount            - Amount to transfer (in ether units, e.g., 100)');
    console.log('\nExamples:');
    console.log('  # Transfer 100 tokens from Anvil account #0 to address');
    console.log('  npx tsx 6-transfer-plasma-l2.ts \\');
    console.log('    0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\');
    console.log('    0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 \\');
    console.log('    100');
    console.log('');
    console.log('  # Transfer 50 tokens from account #1 to account #2');
    console.log('  npx tsx 6-transfer-plasma-l2.ts \\');
    console.log('    0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \\');
    console.log('    0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \\');
    console.log('    50');
    console.log('');
    console.log('Anvil Default Accounts (Private Keys):');
    console.log('  #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    console.log('      0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    console.log('');
    console.log('  #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    console.log('      0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    console.log('');
    console.log('  #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
    console.log('      0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
    console.log('');
    console.log('  #3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906');
    console.log('      0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
  }

  const fromPrivateKey = args[0] as Hex;
  const toAddress = args[1] as Address;
  const amount = parseEther(args[2]);

  // Environment validation
  const l2PlasmaChainAddress = process.env.L2_PLASMA_CHAIN_ADDRESS as Address;
  const l2PlasmaTokenAddress = process.env.L2_PLASMA_TOKEN_ADDRESS as Address;
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';

  if (!l2PlasmaChainAddress || !l2PlasmaTokenAddress) {
    console.error('❌ Error: L2_PLASMA_CHAIN_ADDRESS or L2_PLASMA_TOKEN_ADDRESS not found in .env');
    process.exit(1);
  }

  // Setup account
  const account = privateKeyToAccount(fromPrivateKey);

  // Setup clients
  const publicClient = createPublicClient({
    chain: l2Chain,
    transport: http(l2RpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: l2Chain,
    transport: http(l2RpcUrl),
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💸 Plasma L2 Token Transfer');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nConfiguration:');
  console.log(`  L2 RPC:       ${l2RpcUrl}`);
  console.log(`  PlasmaChain:  ${l2PlasmaChainAddress}`);
  console.log(`  PlasmaToken:  ${l2PlasmaTokenAddress}`);
  console.log('');
  console.log('Transfer Details:');
  console.log(`  From:         ${account.address}`);
  console.log(`  To:           ${toAddress}`);
  console.log(`  Amount:       ${formatEther(amount)} PLASMA`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // 1. Check balances before transfer
    console.log('📊 Checking balances before transfer...\n');

    const fromBalanceBefore = await publicClient.readContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [account.address, l2PlasmaTokenAddress],
    }) as bigint;

    const toBalanceBefore = await publicClient.readContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [toAddress, l2PlasmaTokenAddress],
    }) as bigint;

    console.log('Before Transfer:');
    console.log(`  From balance: ${formatEther(fromBalanceBefore)} PLASMA`);
    console.log(`  To balance:   ${formatEther(toBalanceBefore)} PLASMA`);
    console.log('');

    // Check if sender has enough balance
    if (fromBalanceBefore < amount) {
      console.error(`❌ Error: Insufficient balance`);
      console.error(`   Required: ${formatEther(amount)} PLASMA`);
      console.error(`   Available: ${formatEther(fromBalanceBefore)} PLASMA`);
      process.exit(1);
    }

    // 2. Get nonce for sender
    const nonce = await publicClient.readContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'nonces',
      args: [account.address],
    }) as bigint;

    console.log(`  Sender nonce: ${nonce.toString()}\n`);

    // 3. Execute transaction (direct user call, no signature needed)
    console.log('🔄 Executing transfer...\n');

    const hash = await walletClient.writeContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'executeTransaction',
      args: [
        account.address,       // from
        toAddress,             // to
        l2PlasmaTokenAddress,  // token
        amount,                // amount
        nonce,                 // nonce
        '0x' as Hex,          // empty signature (direct user call)
      ],
    } as any);

    console.log(`  Transaction hash: ${hash}`);
    console.log('  Waiting for confirmation...\n');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`  ✅ Transfer confirmed!`);
    console.log(`  Block number: ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`  New nonce: ${(nonce + 1n).toString()}`);
    console.log('');

    // 3. Check balances after transfer
    console.log('📊 Checking balances after transfer...\n');

    const fromBalanceAfter = await publicClient.readContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [account.address, l2PlasmaTokenAddress],
    }) as bigint;

    const toBalanceAfter = await publicClient.readContract({
      address: l2PlasmaChainAddress,
      abi: plasmaChainAbi,
      functionName: 'getBalance',
      args: [toAddress, l2PlasmaTokenAddress],
    }) as bigint;

    console.log('After Transfer:');
    console.log(`  From balance: ${formatEther(fromBalanceAfter)} PLASMA (${formatEther(fromBalanceBefore - fromBalanceAfter)} sent)`);
    console.log(`  To balance:   ${formatEther(toBalanceAfter)} PLASMA (+${formatEther(toBalanceAfter - toBalanceBefore)} received)`);
    console.log('');

    // 4. Check ERC20 balance (actual minted tokens)
    console.log('💰 Checking ERC20 token balances...\n');

    const fromErc20Balance = await publicClient.readContract({
      address: l2PlasmaTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;

    const toErc20Balance = await publicClient.readContract({
      address: l2PlasmaTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [toAddress],
    }) as bigint;

    console.log('ERC20 Token Balances:');
    console.log(`  From: ${formatEther(fromErc20Balance)} PLASMA`);
    console.log(`  To:   ${formatEther(toErc20Balance)} PLASMA`);
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Transfer completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ Transfer failed!');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('\nError:', error.message);

    if (error.message.includes('insufficient funds')) {
      console.error('\n💡 Tip: Make sure sender has enough ETH for gas fees');
    } else if (error.message.includes('execution reverted')) {
      console.error('\n💡 Tip: Check if:');
      console.error('   - Sender has sufficient balance in PlasmaChain');
      console.error('   - Contract addresses are correct');
      console.error('   - PlasmaChain contract is deployed');
    }
    console.error('');
    process.exit(1);
  }
}

main();
