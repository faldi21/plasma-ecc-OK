#!/usr/bin/env tsx

import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';

async function main() {
  const userAccount = privateKeyToAccount('0x873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080');
  const user = '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';
  const token = '0x9E7088C23e5C0B2D02cD7886A1BDbC7FE8b71016';
  const amount = BigInt('50000000000000000000');
  const nonce = 0n;

  const messageHash = keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'string', 'uint256'],
      [user, token, amount, 'AGGREGATE_WITHDRAW', nonce]
    )
  );

  const signature = await userAccount.signMessage({
    message: { raw: messageHash },
  });

  console.log('User:', user);
  console.log('Token:', token);
  console.log('Amount:', amount.toString());
  console.log('Nonce:', nonce.toString());
  console.log('Message hash:', messageHash);
  console.log('Signature:', signature);
  console.log('Signature length (bytes):', (signature.length - 2) / 2);
}

main();
