// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/MerkleAccumulator.sol";

/**
 * @title CommitMerkle
 * @dev Reuses the existing, already-audited-by-usage MerkleAccumulator
 * library (contracts/src/libraries/MerkleAccumulator.sol) directly, rather
 * than reimplementing OpenZeppelin's Bytes32PushTree wiring a second time.
 * This is the same library PlasmaChainUTXOMerkle.sol uses, so the duplicate
 * guard, tree depth (20), and commutative-hashing behavior are identical to
 * the measured system's Merkle baseline "as-is" -- no new logic is
 * introduced here, only the same benchmark-harness scaffolding
 * (pendingUtxos/cursor/createBlock/createBlockChunked) shared by the other
 * six commit variants (see CommitBaseline.sol's docblock).
 */
contract CommitMerkle {
    using MerkleAccumulator for MerkleAccumulator.Accumulator;

    MerkleAccumulator.Accumulator private accumulator;

    bytes32[] public pendingUtxos;
    uint256 public pendingProcessedCursor;

    address public operator;
    uint256 public currentBlock;

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
        accumulator.initialize();
    }

    function addPending(bytes32 id) external onlyOperator {
        pendingUtxos.push(id);
    }

    function createBlock() external onlyOperator returns (uint256) {
        uint256 len = pendingUtxos.length;
        for (uint256 i = 0; i < len; i++) {
            accumulator.add(pendingUtxos[i]); // duplicate guard is built into MerkleAccumulator.add
        }
        currentBlock++;
        delete pendingUtxos;
        pendingProcessedCursor = 0;
        return currentBlock;
    }

    function createBlockChunked(uint256 maxOps) external onlyOperator returns (uint256, bool) {
        uint256 endIdx = pendingProcessedCursor + maxOps;
        if (endIdx > pendingUtxos.length) endIdx = pendingUtxos.length;

        for (uint256 i = pendingProcessedCursor; i < endIdx; i++) {
            accumulator.add(pendingUtxos[i]);
        }
        pendingProcessedCursor = endIdx;

        if (pendingProcessedCursor == pendingUtxos.length) {
            currentBlock++;
            delete pendingUtxos;
            pendingProcessedCursor = 0;
            return (currentBlock, true);
        }
        return (currentBlock, false);
    }

    function getRoot() external view returns (bytes32) {
        return accumulator.getRoot();
    }

    function getCount() external view returns (uint256) {
        return accumulator.getCount();
    }

    function contains(bytes32 element) external view returns (bool) {
        return accumulator.contains(element);
    }
}
