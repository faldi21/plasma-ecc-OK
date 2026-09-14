import BN from 'bn.js';
import elliptic from 'elliptic';

const EC = elliptic.ec;
const ec = new EC('secp256k1');
const G = ec.g;

async function deepDebug() {
  console.log('=== DEEP DEBUG: Contract vs Backend Verification ===\n');

  const txHash = '0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb';

  // Get witness from backend
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  const witness = witnessData.witness;

  // Get current accumulator from backend
  const accResp = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResp.json();
  const currentAcc = accData.accumulator;

  console.log('Data:');
  console.log('  TxHash:', txHash);
  console.log('  Witness X:', witness.x);
  console.log('  Witness Y:', witness.y);
  console.log('  Current Acc X:', currentAcc.x);
  console.log('  Current Acc Y:', currentAcc.y);

  console.log('\n=== BACKEND CALCULATION (JavaScript/elliptic.js) ===\n');

  // Step 1: Calculate txHash * G (backend way)
  const txHashBN = new BN(txHash.slice(2), 16);
  console.log('1. TxHash as BN:', txHashBN.toString(10).slice(0, 30) + '...');

  const elementPoint = G.mul(txHashBN);
  console.log('2. Element Point (txHash * G):');
  console.log('   X:', '0x' + elementPoint.getX().toString(16));
  console.log('   Y:', '0x' + elementPoint.getY().toString(16));

  // Step 2: witness point
  const witnessPoint = ec.curve.point(
    new BN(witness.x.slice(2), 16),
    new BN(witness.y.slice(2), 16)
  );
  console.log('3. Witness Point:');
  console.log('   X:', witness.x);
  console.log('   Y:', witness.y);

  // Step 3: Add them
  const computed = witnessPoint.add(elementPoint);
  console.log('4. Computed (witness + elementPoint):');
  console.log('   X:', '0x' + computed.getX().toString(16));
  console.log('   Y:', '0x' + computed.getY().toString(16));

  // Step 4: Compare with expected
  console.log('5. Expected (current accumulator):');
  console.log('   X:', currentAcc.x);
  console.log('   Y:', currentAcc.y);

  const backendMatch = (
    '0x' + computed.getX().toString(16) === currentAcc.x &&
    '0x' + computed.getY().toString(16) === currentAcc.y
  );

  console.log('\n✅ Backend verification:', backendMatch ? 'PASS' : 'FAIL');

  console.log('\n=== CONTRACT CALCULATION (Solidity) ===\n');
  console.log('Contract should do:');
  console.log('1. scalarMul(G, txHash) to get elementPoint');
  console.log('2. pointAdd(witness, elementPoint) to get computed');
  console.log('3. Compare computed with accumulator.value');

  console.log('\nKey difference: Contract uses modulo operations');
  console.log('Let me check if there\'s a modulo issue...');

  // Check if txHash needs modulo N
  const N = new BN('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16);
  const txHashModN = txHashBN.mod(N);

  console.log('\nTxHash mod N check:');
  console.log('  Original txHash:', txHashBN.toString(10).slice(0, 30) + '...');
  console.log('  TxHash mod N:', txHashModN.toString(10).slice(0, 30) + '...');
  console.log('  Are they equal?', txHashBN.eq(txHashModN));

  if (!txHashBN.eq(txHashModN)) {
    console.log('\n⚠️  TxHash > N! This might cause issues!');

    const elementPointModN = G.mul(txHashModN);
    console.log('\nElement point with modulo N:');
    console.log('   X:', '0x' + elementPointModN.getX().toString(16));
    console.log('   Y:', '0x' + elementPointModN.getY().toString(16));

    const computedModN = witnessPoint.add(elementPointModN);
    console.log('\nComputed with modulo N:');
    console.log('   X:', '0x' + computedModN.getX().toString(16));
    console.log('   Y:', '0x' + computedModN.getY().toString(16));

    const modNMatch = (
      '0x' + computedModN.getX().toString(16) === currentAcc.x &&
      '0x' + computedModN.getY().toString(16) === currentAcc.y
    );

    console.log('\nModulo N verification:', modNMatch ? 'PASS' : 'FAIL');
  }
}

deepDebug().catch(console.error);
