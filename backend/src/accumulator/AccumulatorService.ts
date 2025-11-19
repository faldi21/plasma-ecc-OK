import elliptic from 'elliptic';
import BN from 'bn.js';
import type { Hex } from 'viem';
import type { AccumulatorPoint, AccumulatorWitness } from '../types/contracts.js';

const EC = elliptic.ec;

/**
 * ECC Accumulator Service
 *
 * Implements an Elliptic Curve Cryptography accumulator for Plasma transactions.
 * Uses secp256k1 curve for compatibility with Ethereum.
 */
export class AccumulatorService {
  private readonly ec: InstanceType<typeof EC>;
  private readonly G: any; // Generator point
  private accumulatorValue: any; // EC Point
  private readonly elements: Map<Hex, boolean>;
  private readonly witnesses: Map<Hex, any>;

  constructor() {
    // Initialize secp256k1 curve (same as Bitcoin/Ethereum)
    this.ec = new EC('secp256k1');

    // Generator point
    this.G = this.ec.g;

    // Current accumulator value (starts with generator)
    this.accumulatorValue = this.G;

    // Store elements and their witnesses
    this.elements = new Map();
    this.witnesses = new Map();
  }

  /**
   * Add an element to the accumulator
   * @param element - Transaction hash to add
   * @returns True if element was added, false if already exists
   */
  public async add(element: Hex): Promise<boolean> {
    try {
      // Convert element to BN (remove '0x' prefix)
      const elementBN = new BN(element.slice(2), 16);

      // Check if element already exists
      if (this.elements.has(element)) {
        return false;
      }

      // Calculate new accumulator value: acc' = acc + element * G
      const elementPoint = this.G.mul(elementBN);
      const oldAccumulator = this.accumulatorValue;
      this.accumulatorValue = this.accumulatorValue.add(elementPoint);

      // Store element and witness (witness is the old accumulator before adding this element)
      this.elements.set(element, true);
      this.witnesses.set(element, oldAccumulator);

      return true;
    } catch (error) {
      console.error('Add to accumulator error:', error);
      throw error;
    }
  }

  /**
   * Generate a witness (proof) for an element
   * @param element - Transaction hash to generate witness for
   * @returns Witness point coordinates
   */
  public async generateWitness(element: Hex): Promise<AccumulatorWitness> {
    try {
      if (!this.witnesses.has(element)) {
        throw new Error('Element not found in accumulator');
      }

      const witness = this.witnesses.get(element);

      return {
        x: ('0x' + witness.getX().toString(16)) as Hex,
        y: ('0x' + witness.getY().toString(16)) as Hex,
      };
    } catch (error) {
      console.error('Generate witness error:', error);
      throw error;
    }
  }

  /**
   * Verify that an element is in the accumulator using its witness
   * @param element - Transaction hash to verify
   * @param witness - Witness point for the element
   * @returns True if verification passes
   */
  public async verify(element: Hex, witness: AccumulatorWitness): Promise<boolean> {
    try {
      if (!this.elements.has(element)) {
        return false;
      }

      // Convert element to BN
      const elementBN = new BN(element.slice(2), 16);

      // Calculate element point: element * G
      const elementPoint = this.G.mul(elementBN);

      // Reconstruct accumulator from witness: acc = witness + element * G
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

  /**
   * Get the current accumulator value
   * @returns Current accumulator point coordinates
   */
  public getValue(): AccumulatorPoint {
    return {
      x: ('0x' + this.accumulatorValue.getX().toString(16)) as Hex,
      y: ('0x' + this.accumulatorValue.getY().toString(16)) as Hex,
    };
  }

  /**
   * Reset the accumulator to initial state (generator point)
   */
  public reset(): void {
    this.accumulatorValue = this.G;
    this.elements.clear();
    this.witnesses.clear();
  }

  /**
   * Get the number of elements in the accumulator
   */
  public size(): number {
    return this.elements.size;
  }

  /**
   * Check if an element exists in the accumulator
   */
  public has(element: Hex): boolean {
    return this.elements.has(element);
  }

  /**
   * Get all elements in the accumulator
   */
  public getElements(): Hex[] {
    return Array.from(this.elements.keys());
  }
}

export default AccumulatorService;
