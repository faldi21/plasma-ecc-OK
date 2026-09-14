import BN from 'bn.js';
import elliptic from 'elliptic';

const EC = elliptic.ec;
const ec = new EC('secp256k1');
const G = ec.g;

async function testWitnessMath() {
  console.log('=== Testing Witness Mathematics ===\n');

  // Get data from backend
  const elementsResp = await fetch('http://localhost:3001/api/accumulator/elements');
  const elementsData = await elementsResp.json();
  const txHash = elementsData.elements[elementsData.elements.length - 1];

  console.log(`TxHash: ${txHash}\n`);

  // Get witness
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  const witness = witnessData.witness;

  // Get current accumulator
  const accResp = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResp.json();

  console.log('Backend Witness:');
  console.log(`  X: ${witness.x}`);
  console.log(`  Y: ${witness.y}`);

  console.log('\nBackend Accumulator:');
  console.log(`  X: ${accData.accumulator.x}`);
  console.log(`  Y: ${accData.accumulator.y}`);

  // Reconstruct the math: witness + txHash*G should equal accumulator
  console.log('\n=== Verifying Math: witness + txHash*G = accumulator ===\n');

  // Convert txHash to BN
  const txHashBN = new BN(txHash.slice(2), 16);
  console.log(`1. TxHash as number: ${txHashBN.toString(10).slice(0, 20)}...`);

  // Calculate txHash * G
  const elementPoint = G.mul(txHashBN);
  console.log(`\n2. Element Point (txHash * G):`);
  console.log(`   X: 0x${elementPoint.getX().toString(16)}`);
  console.log(`   Y: 0x${elementPoint.getY().toString(16)}`);

  // Reconstruct witness point
  const witnessPoint = ec.curve.point(
    new BN(witness.x.slice(2), 16),
    new BN(witness.y.slice(2), 16)
  );

  console.log(`\n3. Witness Point:`);
  console.log(`   X: ${witness.x}`);
  console.log(`   Y: ${witness.y}`);

  // Add witness + elementPoint
  const computed = witnessPoint.add(elementPoint);
  console.log(`\n4. Computed (witness + elementPoint):`);
  console.log(`   X: 0x${computed.getX().toString(16)}`);
  console.log(`   Y: 0x${computed.getY().toString(16)}`);

  console.log(`\n5. Expected (current accumulator):`);
  console.log(`   X: ${accData.accumulator.x}`);
  console.log(`   Y: ${accData.accumulator.y}`);

  // Compare
  const computedX = '0x' + computed.getX().toString(16);
  const computedY = '0x' + computed.getY().toString(16);
  const accX = accData.accumulator.x;
  const accY = accData.accumulator.y;

  console.log(`\n=== RESULT ===`);
  console.log(`Computed X matches? ${computedX === accX}`);
  console.log(`Computed Y matches? ${computedY === accY}`);

  if (computedX === accX && computedY === accY) {
    console.log(`\n✅ WITNESS MATH IS CORRECT!`);
    console.log(`The witness can be used to prove the transaction is in the accumulator.`);
  } else {
    console.log(`\n❌ WITNESS MATH IS WRONG!`);
    console.log(`There's a problem with how the witness was generated.`);
  }
}

testWitnessMath().catch(console.error);
