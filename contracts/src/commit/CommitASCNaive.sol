// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/ECCMath.sol";

/**
 * @title CommitASCNaive
 * @dev Mirrors ECCAccumulator.add()'s current (unoptimized) behavior exactly:
 * one scalarMul + one pointAdd PER element. This is the O(n) scalarMul cost
 * that produced the paper's original ~165M gas figure at n=100 (reviewer
 * finding M6, docs/GAP_ANALYSIS.md, docs/REVISION_ROADMAP.md R2-M6).
 *
 * See CommitBaseline.sol for the shared storage-layout/pending-array design
 * note (identical across all seven contracts in this directory).
 */
contract CommitASCNaive {
    uint256 internal constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 internal constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;

    mapping(bytes32 => bool) public elements;
    uint256 public count;

    // Cumulative accumulator point, A = (1 + sum(e_i mod N)) * G, updated
    // one scalarMul+pointAdd at a time -- same as ECCAccumulator.add().
    uint256 public accX;
    uint256 public accY;

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
        accX = GX;
        accY = GY;
    }

    function addPending(bytes32 id) external onlyOperator {
        pendingUtxos.push(id);
    }

    function _addElement(bytes32 element) internal returns (bool) {
        if (elements[element]) {
            return false;
        }
        // scalarMul handles the `element mod N` reduction internally,
        // exactly as ECCAccumulator.add() does.
        (uint256 ex, uint256 ey) = ECCMath.scalarMul(GX, GY, uint256(element));
        (accX, accY) = ECCMath.pointAdd(accX, accY, ex, ey);
        elements[element] = true;
        count++;
        return true;
    }

    function createBlock() external onlyOperator returns (uint256) {
        uint256 len = pendingUtxos.length;
        for (uint256 i = 0; i < len; i++) {
            _addElement(pendingUtxos[i]);
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
            _addElement(pendingUtxos[i]);
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
}
