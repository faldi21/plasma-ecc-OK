const elliptic = require('elliptic');
const BN = require('bn.js');

const EC = elliptic.ec;
const ec = new EC('secp256k1');

// Test element (a transaction hash)
const element = '0x867b57a3b34dec9e340b9da2ad24f57d85734b6cbcfc47aaedc8e8abb41243af';
const elementBN = new BN(element.slice(2), 16);

console.log('Element:', element);
console.log('Element BN:', elementBN.toString(16));

// Curve order N
const N = new BN('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16);
console.log('\nCurve order N:', N.toString(16));

// Test with modulo
const scalarWithMod = elementBN.mod(N);
console.log('\nScalar with mod N:', scalarWithMod.toString(16));

// Test scalar multiplication
const G = ec.g;

const point1 = G.mul(elementBN);
const point2 = G.mul(scalarWithMod);

console.log('\nPoint from element (no mod):');
console.log('  X:', point1.getX().toString(16));
console.log('  Y:', point1.getY().toString(16));

console.log('\nPoint from scalar (with mod):');
console.log('  X:', point2.getX().toString(16));
console.log('  Y:', point2.getY().toString(16));

console.log('\nAre they equal?', point1.eq(point2));
