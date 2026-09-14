/**
 * Test witness generation flow
 */

import * as crypto from 'crypto';

// Witness dari backend untuk tx yang sama
const witnessFromBackend = {
  x: '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  y: '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
};

// TX hash yang kita gunakan
const txHash = '0x16d01d24434d93753346e03db152b930cd7dc49e7bb4ade9238dd5c8606efa95';

// Generator point untuk secp256k1
const G = {
  x: '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  y: '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
};

console.log('=== Witness Analysis ===\n');
console.log('TX Hash:', txHash);
console.log('Witness from backend:', witnessFromBackend);
console.log('\nGenerator point G:', G);

console.log('\n📝 Note: Witness X and Y match Generator point G exactly!');
console.log('This means witness is the generator point - witness is NOT personalized per tx!');

console.log('\nThis is the problem:');
console.log('- Backend returns SAME witness (generator point) for ALL txes');
console.log('- But accumulator.verify() expects unique witness for each tx');
console.log('- Witness should be: r*G + tx_value');
console.log('- Instead we get: just G (the default generator)');

console.log('\n❌ Backend witness generation is BROKEN!');
console.log('It should generate accumulator-specific witness, not just return generator.');
