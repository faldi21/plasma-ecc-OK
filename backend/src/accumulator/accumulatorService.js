const { ethers } = require('ethers');
const EC = require('elliptic').ec;
const BN = require('bn.js');

class AccumulatorService {
    constructor() {
        // Initialize secp256k1 curve
        this.ec = new EC('secp256k1');
        
        // Generator point
        this.G = this.ec.g;
        
        // Current accumulator value (starts with generator)
        this.accumulatorValue = this.G;
        
        // Store elements and their witnesses
        this.elements = new Map();
        this.witnesses = new Map();
    }

    async add(element) {
        try {
            // Convert element to BN
            const elementBN = new BN(element.slice(2), 16); // Remove '0x' prefix
            
            // Check if element already exists
            if (this.elements.has(element)) {
                return false;
            }
            
            // Calculate new accumulator value
            const elementPoint = this.G.mul(elementBN);
            const oldAccumulator = this.accumulatorValue;
            this.accumulatorValue = this.accumulatorValue.add(elementPoint);
            
            // Store element and witness
            this.elements.set(element, true);
            this.witnesses.set(element, oldAccumulator);
            
            return true;
        } catch (error) {
            console.error('Add to accumulator error:', error);
            throw error;
        }
    }

    async generateWitness(element) {
        try {
            if (!this.witnesses.has(element)) {
                throw new Error('Element not found in accumulator');
            }
            
            const witness = this.witnesses.get(element);
            
            return {
                x: '0x' + witness.getX().toString(16),
                y: '0x' + witness.getY().toString(16)
            };
        } catch (error) {
            console.error('Generate witness error:', error);
            throw error;
        }
    }

    async verify(element, witness) {
        try {
            if (!this.elements.has(element)) {
                return false;
            }
            
            // Convert element to BN
            const elementBN = new BN(element.slice(2), 16);
            
            // Calculate element point
            const elementPoint = this.G.mul(elementBN);
            
            // Reconstruct accumulator from witness
            const witnessPoint = this.ec.curve.point(
                new BN(witness.x.slice(2), 16),
                new BN(witness.y.slice(2), 16)
            );
            
            const computedAccumulator = witnessPoint.add(elementPoint);
            
            // Compare with current accumulator
            return computedAccumulator.eq(this.accumulatorValue);
        } catch (error) {
            console.error('Verify accumulator error:', error);
            throw error;
        }
    }

    getValue() {
        return {
            x: '0x' + this.accumulatorValue.getX().toString(16),
            y: '0x' + this.accumulatorValue.getY().toString(16)
        };
    }

    reset() {
        this.accumulatorValue = this.G;
        this.elements.clear();
        this.witnesses.clear();
    }
}

module.exports = AccumulatorService;
