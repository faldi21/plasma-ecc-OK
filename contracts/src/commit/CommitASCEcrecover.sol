// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/EcrecoverMulCheck.sol";

/**
 * @title CommitASCEcrecover
 * @dev Like CommitASC1SM, accumulates a running scalar `s` via cheap addmod
 * per element. Instead of computing s*G on-chain (~1.65M gas scalarMul),
 * the operator computes it off-chain and submits the claimed point as
 * calldata; the contract verifies it via EcrecoverMulCheck.eqScalarMulG
 * (~3,655 gas per contracts/test/EcrecoverMulCheck.t.sol's measurement).
 *
 * Asymmetry vs. the other six variants (docs/GAP_ANALYSIS.md #6, already
 * flagged before this ticket): createBlock() here takes the claimed point
 * as parameters, since it needs external input that the other variants
 * don't. createBlockChunked() intentionally does NOT verify/update the
 * point on intermediate chunks -- only a completed block's createBlock
 * call carries the hint, consistent with docs/REVISION_ROADMAP.md R1-18's
 * finding that a single scalarMul (or, here, its ecrecover-verified
 * off-chain equivalent) removes the need for chunking in the first place.
 *
 * See CommitBaseline.sol for the shared storage-layout/pending-array design
 * note (identical across all seven contracts in this directory).
 */
contract CommitASCEcrecover {
    uint256 internal constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 internal constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    mapping(bytes32 => bool) public elements;
    uint256 public count;

    uint256 public s;

    // Materialized point, verified (not computed) via ecrecover.
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
        s = 1;
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
        s = addmod(s, uint256(element) % N, N);
        elements[element] = true;
        count++;
        return true;
    }

    /// @param claimedX, claimedY operator-supplied point claimed to equal
    /// s*G after folding in this block's pending elements, verified via
    /// EcrecoverMulCheck instead of an on-chain scalarMul.
    function createBlock(uint256 claimedX, uint256 claimedY) external onlyOperator returns (uint256) {
        uint256 len = pendingUtxos.length;
        for (uint256 i = 0; i < len; i++) {
            _addElement(pendingUtxos[i]);
        }
        require(EcrecoverMulCheck.eqScalarMulG(s, claimedX, claimedY), "claimed point != s*G");
        accX = claimedX;
        accY = claimedY;
        currentBlock++;
        delete pendingUtxos;
        pendingProcessedCursor = 0;
        return currentBlock;
    }

    /// @dev Folds elements into `s` without verifying/updating the point --
    /// see contract-level docblock. Callers must finish a block with
    /// createBlock(claimedX, claimedY) once isComplete is true.
    function createBlockChunked(uint256 maxOps) external onlyOperator returns (uint256, bool) {
        uint256 endIdx = pendingProcessedCursor + maxOps;
        if (endIdx > pendingUtxos.length) endIdx = pendingUtxos.length;

        for (uint256 i = pendingProcessedCursor; i < endIdx; i++) {
            _addElement(pendingUtxos[i]);
        }
        pendingProcessedCursor = endIdx;

        return (currentBlock, pendingProcessedCursor == pendingUtxos.length);
    }
}
