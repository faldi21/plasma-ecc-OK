import { createPublicClient, http, keccak256, encodePacked } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const RootChainData = JSON.parse(fs.readFileSync('./backend/abi/RootChain.json', 'utf8'));

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const account = privateKeyToAccount(process.env.PK_USER_A as `0x${string}`);

async function checkExitStatus() {
  console.log('=== CHECK EXIT STATUS ===\n');

  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  const userAddress = account.address;
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;

  // Get txHash from user input or latest
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  const txHash = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;

  console.log('Checking exit for:');
  console.log('  User:', userAddress);
  console.log('  Token:', token);
  console.log('  TxHash:', txHash);
  console.log('');

  // Get current block number from L1
  const currentBlock = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'currentPlasmaBlock',
  }) as bigint;

  // Calculate exitId (same way contract does it)
  const exitId = keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'bytes32'],
      [userAddress, token, currentBlock, txHash]
    )
  );

  console.log('Exit ID:', exitId);
  console.log('');

  // Get exit data from contract (returns array)
  try {
    const result = await publicClient.readContract({
      address: rootChainAddress,
      abi: RootChainData.abi,
      functionName: 'exits',
      args: [exitId],
    }) as any[];

    // Destructure array: [owner, token, amount, blockNumber, txHash, exitTime, processed]
    const [owner, exitToken, amount, blockNum, exitTxHash, exitTime, processed] = result;

    console.log('Exit Data:');
    console.log('  Owner:', owner);
    console.log('  Token:', exitToken);
    console.log('  Amount:', (Number(amount) / 1e18).toFixed(2), 'tokens');
    console.log('  Block Number:', blockNum.toString());
    console.log('  TxHash:', exitTxHash);
    console.log('  Exit Time:', new Date(Number(exitTime) * 1000).toISOString());
    console.log('  Processed:', processed);
    console.log('');

    // Check if exit exists
    if (owner === '0x0000000000000000000000000000000000000000') {
      console.log('❌ Exit not found!');
      console.log('   Make sure you have called startExit first.');
      return;
    }

    // Check current time
    const currentTime = Math.floor(Date.now() / 1000);
    const exitTimeNum = Number(exitTime);
    const timeRemaining = exitTimeNum - currentTime;

    console.log('Timing:');
    console.log('  Current Time:', new Date(currentTime * 1000).toISOString());
    console.log('  Exit Time:', new Date(exitTimeNum * 1000).toISOString());

    if (timeRemaining > 0) {
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      console.log(`  Time Remaining: ${minutes}m ${seconds}s`);
      console.log('');
      console.log('⏳ Exit period not ended yet.');
      console.log('   Please wait before calling finalizeExit().');
    } else {
      console.log('  Time Remaining: 0 (ready!)');
      console.log('');

      if (processed) {
        console.log('✅ Exit already processed and finalized!');
      } else {
        console.log('✅ Exit is ready to be finalized!');
        console.log('   You can now call finalizeExit()');
        console.log('');
        console.log('Run: npx tsx functions/finalize-exit.ts');
      }
    }

  } catch (error: any) {
    console.error('Error reading exit data:', error.message);
  }
}

checkExitStatus().catch(console.error);
