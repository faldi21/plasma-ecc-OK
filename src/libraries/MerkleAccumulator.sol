// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MerkleTree} from "@openzeppelin/contracts/utils/structs/MerkleTree.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MerkleAccumulator
 * @dev Baseline accumulator implementation for Plasma-UTXO using a Merkle tree.
 *
 * This library is the Merkle-based counterpart to `ECCAccumulator.sol`. It is
 * provided as a baseline for empirical comparison in research/benchmark contexts.
 *
 * Design rationale:
 *   - Uses OpenZeppelin's audited {MerkleTree} for incremental leaf insertion
 *     and {MerkleProof} for membership verification with commutative hashing.
 *   - Mirrors the public API of `ECCAccumulator.sol` (add / verify / getValue
 *     equivalent / getCount) so the surrounding Plasma contract can swap
 *     accumulator implementations with minimal change.
 *
 * Complexity (per operation):
 *   - add        : O(log N) keccak256 hashes
 *   - verify     : O(log N) keccak256 hashes on-chain
 *   - proof size : 32 * log2(N) bytes
 *
 * Compare against ECC:
 *   - ECC add    : O(1) operations but ~5M gas (scalar multiplication)
 *   - ECC verify : O(1) operations but ~5M gas
 *   - ECC proof  : 64 bytes (one EC point) — constant regardless of N
 */
library MerkleAccumulator {
    using MerkleTree for MerkleTree.Bytes32PushTree;

    /// @dev Tree depth. Capacity = 2^TREE_DEPTH = 1,048,576 leaves.
    /// 20 levels covers all benchmarking scenarios up to ~1M UTXOs.
    uint8 internal constant TREE_DEPTH = 20;

    /// @dev Zero value used for empty leaves (matches MerkleTree convention).
    bytes32 internal constant ZERO_LEAF = bytes32(0);

    /**
     * @dev Accumulator state.
     *
     * `tree`         : OpenZeppelin's incremental Merkle tree (frontier-based).
     * `root`         : Current Merkle root (top of the tree).
     * `count`        : Number of elements inserted (also = next leaf index).
     * `elementIndex` : Map from element → leaf index. Used by off-chain proof
     *                  generation and on-chain queries.
     * `elements`     : Membership set for duplicate-add detection.
     *
     * Storage cost notes:
     *   - `tree` keeps `TREE_DEPTH` slots for the frontier (constant cost).
     *   - `elementIndex` and `elements` grow O(N) with inserted elements.
     */
    struct Accumulator {
        MerkleTree.Bytes32PushTree tree;
        bytes32 root;
        uint256 count;
        mapping(bytes32 => uint256) elementIndex;
        mapping(bytes32 => bool) elements;
    }

    /**
     * @dev Initialize the accumulator. MUST be called exactly once before any
     * `add`. The initial root is the all-zero tree root.
     */
    function initialize(Accumulator storage acc) internal {
        acc.root = acc.tree.setup(TREE_DEPTH, ZERO_LEAF);
    }

    /**
     * @dev Add a new element to the accumulator.
     *
     * Returns `true` if inserted, `false` if the element already existed
     * (duplicate-safe semantics matching ECCAccumulator.add).
     *
     * Costs (typical):
     *   - 1 SSTORE to mark element
     *   - 1 SSTORE to record element index
     *   - 1 SSTORE to bump count
     *   - 1 SSTORE to update root
     *   - ~log2(N) keccak256 hashes inside MerkleTree.push
     */
    function add(Accumulator storage acc, bytes32 element) internal returns (bool) {
        if (acc.elements[element]) {
            return false; // Element already in accumulator
        }
        (uint256 index, bytes32 newRoot) = acc.tree.push(element);
        acc.elements[element] = true;
        acc.elementIndex[element] = index;
        acc.root = newRoot;
        acc.count++;
        return true;
    }

    /**
     * @dev Verify that `element` is in the accumulator using `proof` against
     * the CURRENT root. Uses commutative hashing — proof order doesn't matter.
     *
     * Equivalent role to ECCAccumulator.verify but using Merkle path.
     */
    function verify(
        Accumulator storage acc,
        bytes32 element,
        bytes32[] memory proof
    ) internal view returns (bool) {
        return MerkleProof.verify(proof, acc.root, element);
    }

    /**
     * @dev Verify membership against a HISTORICAL root (e.g., the accumulator
     * value snapshotted at a previous L2 block).
     *
     * Equivalent role to ECCAccumulator.verifyWithAccumulator. Plasma exits on
     * L1 use this with the Block.accumulatorValue snapshot.
     */
    function verifyWithRoot(
        bytes32 root,
        bytes32 element,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        return MerkleProof.verify(proof, root, element);
    }

    // ============ Views (API parity with ECCAccumulator) ============

    /**
     * @dev Current Merkle root. Counterpart to ECCAccumulator.getValue().
     * Returns bytes32 (32 bytes) instead of a Point (64 bytes), which is one
     * of the key advantages of this design noted in the research comparison.
     */
    function getRoot(Accumulator storage acc) internal view returns (bytes32) {
        return acc.root;
    }

    /// @dev Number of elements inserted.
    function getCount(Accumulator storage acc) internal view returns (uint256) {
        return acc.count;
    }

    /// @dev Leaf index of a previously-inserted element (0 if not in set).
    function getElementIndex(
        Accumulator storage acc,
        bytes32 element
    ) internal view returns (uint256) {
        return acc.elementIndex[element];
    }

    /// @dev Membership query (cheaper than verifying a proof — for internal use).
    function contains(
        Accumulator storage acc,
        bytes32 element
    ) internal view returns (bool) {
        return acc.elements[element];
    }

    /// @dev Tree depth — exposed for off-chain proof construction.
    function depth() internal pure returns (uint8) {
        return TREE_DEPTH;
    }
}
