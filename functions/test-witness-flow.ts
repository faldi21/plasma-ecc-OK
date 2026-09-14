/**
 * Test backend witness generation flow
 */

// Fetch accumulator debug info
async function test() {
  const txHash = '0x16d01d24434d93753346e03db152b930cd7dc49e7bb4ade9238dd5c8606efa95';
  
  // First, add to accumulator
  console.log('1. Adding to accumulator...');
  const addResp = await fetch('http://localhost:3001/api/accumulator/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash }),
  });
  const addData = await addResp.json();
  console.log('Add response:', JSON.stringify(addData, null, 2));

  // Get accumulator value
  console.log('\n2. Get accumulator value...');
  const accResp = await fetch('http://localhost:3001/api/accumulator/value');
  const accData = await accResp.json();
  console.log('Accumulator:', JSON.stringify(accData, null, 2));

  // Get witness
  console.log('\n3. Get witness...');
  const witnessResp = await fetch(`http://localhost:3001/api/witness/${txHash}`);
  const witnessData = await witnessResp.json();
  console.log('Witness:', JSON.stringify(witnessData, null, 2));

  // Check if witness matches generator point
  const G_x = '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const G_y = '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';

  if (witnessData.witness) {
    const witnessX = witnessData.witness.x.toLowerCase();
    const witnessY = witnessData.witness.y.toLowerCase();
    
    console.log('\n📊 Analysis:');
    console.log('Witness X matches G?', witnessX === G_x.toLowerCase());
    console.log('Witness Y matches G?', witnessY === G_y.toLowerCase());
    
    if (witnessX === G_x.toLowerCase() && witnessY === G_y.toLowerCase()) {
      console.log('❌ PROBLEM: Witness is just the generator point!');
      console.log('This happens when the first element is added (accumulator was at G, so witness = G)');
    }
  }
}

test().catch(console.error);
