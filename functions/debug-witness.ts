/**
 * Debug witness storage
 */

async function test() {
  const txHash = '0x16d01d24434d93753346e03db152b930cd7dc49e7bb4ade9238dd5c8606efa95';
  
  console.log('Testing witness generation flow...\n');

  // Add to accumulator
  console.log('1. Adding to accumulator...');
  const addResp = await fetch('http://localhost:3001/api/accumulator/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  const addData = await addResp.json();
  console.log('Added:', JSON.stringify(addData, null, 2));

  // Check witness stored
  console.log('\n2. Get witness...');
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  console.log('Witness returned:', JSON.stringify(witnessData, null, 2));

  // Get accumulator state
  console.log('\n3. Get accumulator value...');
  const accResp = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResp.json();
  console.log('Accumulator:', JSON.stringify(accData, null, 2));

  console.log('\n4. Analysis:');
  if (witnessData.witness) {
    const witnessX = witnessData.witness.x.toLowerCase();
    const accX = accData.accumulator.x.toLowerCase();
    
    if (witnessX === accX) {
      console.log('❌ Witness is same as current accumulator!');
      console.log('This means witness is not personalized per tx.');
    } else {
      console.log('✅ Witness is different from accumulator');
    }
  }
}

test().catch(console.error);
