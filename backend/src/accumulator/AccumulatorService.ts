import elliptic from 'elliptic';
import BN from 'bn.js';
import type { Hex } from 'viem';
import type { AccumulatorPoint, AccumulatorWitness } from '../types/contracts.js';

const EC = elliptic.ec;

// Serialized state type for persistence
export interface SerializedAccumulatorState {
  value: { x: string; y: string };
  elements: string[];
  witnesses: Record<string, { x: string; y: string }>;
}

/**
 * ECC Accumulator Service
 *
 * Implements an Elliptic Curve Cryptography accumulator for Plasma transactions.
 * Uses secp256k1 curve for compatibility with Ethereum.
 *
 * Now supports state persistence for recovery after restart.
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

      // Calculate element point once
      const elementPoint = this.G.mul(elementBN);

      // Calculate new accumulator value: acc' = acc + element * G
      // Note: elliptic.js mul() automatically handles modulo N internally
      const oldAccumulator = this.accumulatorValue;

      // Update existing witnesses to stay valid for the new accumulator
      for (const [key, witnessPoint] of this.witnesses.entries()) {
        this.witnesses.set(key, witnessPoint.add(elementPoint));
      }

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
      if (!this.elements.has(element)) {
        throw new Error('Element not found in accumulator');
      }

      const elementBN = new BN(element.slice(2), 16);
      const elementPoint = this.G.mul(elementBN);
      const witnessPoint = this.accumulatorValue.add(elementPoint.neg());

      return {
        x: ('0x' + witnessPoint.getX().toString(16)) as Hex,
        y: ('0x' + witnessPoint.getY().toString(16)) as Hex,
      };
    } catch (error) {
      console.error('Generate witness error:', error);
      throw error;
    }
  }

  /**
   * Compute a witness for a specific accumulator value.
   * Useful when the accumulator has advanced beyond the block being proven.
   */
  public computeWitnessForAccumulator(element: Hex, accumulator: AccumulatorPoint): AccumulatorWitness {
    const elementBN = new BN(element.slice(2), 16);
    const elementPoint = this.G.mul(elementBN);
    const accumulatorPoint = this.ec.curve.point(
      new BN(accumulator.x.slice(2), 16),
      new BN(accumulator.y.slice(2), 16)
    );
    const witnessPoint = accumulatorPoint.add(elementPoint.neg());

    return {
      x: ('0x' + witnessPoint.getX().toString(16)) as Hex,
      y: ('0x' + witnessPoint.getY().toString(16)) as Hex,
    };
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
      // Note: elliptic.js mul() automatically handles modulo N internally
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

  // ============ PERSISTENCE METHODS ============

  /**
   * Serialize accumulator state for persistence
   * @returns Serialized state that can be saved to file/database
   */
  public serialize(): SerializedAccumulatorState {
    const witnesses: Record<string, { x: string; y: string }> = {};

    // Serialize all witnesses
    for (const [element, witnessPoint] of this.witnesses.entries()) {
      witnesses[element] = {
        x: '0x' + witnessPoint.getX().toString(16).padStart(64, '0'),
        y: '0x' + witnessPoint.getY().toString(16).padStart(64, '0'),
      };
    }

    return {
      value: {
        x: '0x' + this.accumulatorValue.getX().toString(16).padStart(64, '0'),
        y: '0x' + this.accumulatorValue.getY().toString(16).padStart(64, '0'),
      },
      elements: Array.from(this.elements.keys()),
      witnesses,
    };
  }

  /**
   * Restore accumulator state from serialized data
   * @param state - Serialized state from file/database
   * @returns True if restore was successful
   */
  public restore(state: SerializedAccumulatorState): boolean {
    try {
      console.log('[Accumulator] Restoring state...');

      // Clear current state
      this.elements.clear();
      this.witnesses.clear();

      // Restore accumulator value
      if (state.value.x && state.value.y) {
        this.accumulatorValue = this.ec.curve.point(
          new BN(state.value.x.slice(2), 16),
          new BN(state.value.y.slice(2), 16)
        );
      } else {
        // If no value, start with generator
        this.accumulatorValue = this.G;
      }

      // Restore elements
      for (const element of state.elements) {
        this.elements.set(element as Hex, true);
      }

      // Restore witnesses
      for (const [element, witness] of Object.entries(state.witnesses)) {
        const witnessPoint = this.ec.curve.point(
          new BN(witness.x.slice(2), 16),
          new BN(witness.y.slice(2), 16)
        );
        this.witnesses.set(element as Hex, witnessPoint);
      }

      console.log(`[Accumulator] Restored ${this.elements.size} elements`);
      return true;
    } catch (error) {
      console.error('[Accumulator] Error restoring state:', error);
      // Reset to clean state on error
      this.reset();
      return false;
    }
  }

  /**
   * Check if accumulator has been modified (has elements)
   */
  public hasData(): boolean {
    return this.elements.size > 0;
  }
}

export default AccumulatorService;
