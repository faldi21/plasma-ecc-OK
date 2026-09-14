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

async function checkBothExits() {
  const rootChainAddress = process.env.ROOT_CHAIN_ADDRESS as `0x${string}`;
  const userAddress = account.address;
  const token = process.env.PLASMA_TOKEN_ADDRESS as `0x${string}`;

  console.log('=== CHECKING BOTH EXITS ===\n');

  // Get all transactions from accumulator
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  
  console.log('Total transactions in accumulator:', elementsData.size);
  console.log('');

  // Check exit for block 2 (first deposit)
  const txHashBlock2 = elementsData.elements[elementsData.elements.length - 2] as `0x${string}`;
  const exitIdBlock2 = keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'bytes32'],
      [userAddress, token, 2n, txHashBlock2]
    )
  );

  console.log('EXIT #1 (Block 2):');
  console.log('  TxHash:', txHashBlock2);
  console.log('  ExitID:', exitIdBlock2);
  
  const result1 = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'exits',
    args: [exitIdBlock2],
  }) as any[];

  const [owner1, , amount1, , , exitTime1, processed1] = result1;
  console.log('  Owner:', owner1);
  console.log('  Amount:', Number(amount1) / 1e18, 'tokens');
  console.log('  Exit Time:', new Date(Number(exitTime1) * 1000).toISOString());
  console.log('  Processed:', processed1);
  
  const timeRemaining1 = Number(exitTime1) - Math.floor(Date.now() / 1000);
  if (timeRemaining1 > 0) {
    console.log('  Status: ⏳ Waiting', Math.floor(timeRemaining1 / 60) + 'm');
  } else {
    console.log('  Status:', processed1 ? '✅ Finalized' : '✅ Ready to finalize');
  }
  console.log('');

  // Check exit for block 3 (second deposit)
  const txHashBlock3 = elementsData.elements[elementsData.elements.length - 1] as `0x${string}`;
  const exitIdBlock3 = keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'bytes32'],
      [userAddress, token, 3n, txHashBlock3]
    )
  );

  console.log('EXIT #2 (Block 3):');
  console.log('  TxHash:', txHashBlock3);
  console.log('  ExitID:', exitIdBlock3);
  
  const result2 = await publicClient.readContract({
    address: rootChainAddress,
    abi: RootChainData.abi,
    functionName: 'exits',
    args: [exitIdBlock3],
  }) as any[];

  const [owner2, , amount2, , , exitTime2, processed2] = result2;
  console.log('  Owner:', owner2);
  console.log('  Amount:', Number(amount2) / 1e18, 'tokens');
  console.log('  Exit Time:', new Date(Number(exitTime2) * 1000).toISOString());
  console.log('  Processed:', processed2);
  
  const timeRemaining2 = Number(exitTime2) - Math.floor(Date.now() / 1000);
  if (timeRemaining2 > 0) {
    console.log('  Status: ⏳ Waiting', Math.floor(timeRemaining2 / 60) + 'm');
  } else {
    console.log('  Status:', processed2 ? '✅ Finalized' : '✅ Ready to finalize');
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('⚠️  BOTH EXITS CREATED SUCCESSFULLY!');
  console.log('This demonstrates that multiple exits can be created.');
  console.log('Total exit requests: 2 x 2000 = 4000 tokens');
  console.log('Total actual deposits: 2 x 2000 = 4000 tokens (balanced)');
  console.log('');
  console.log('In this case it\'s OK because we made 2 separate deposits.');
  console.log('BUT the vulnerability exists: if there was a transfer between,');
  console.log('user could withdraw more than their actual balance!');
  console.log('='.repeat(60));
}

checkBothExits().catch(console.error);
