// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/ECCMath.sol";

/**
 * @title CommitASC1SM
 * @dev The R2-M6 fix: since A = (1 + sum(e_i mod N)) * G is linear in the
 * exponent, per-element updates only need a cheap addmod against a running
 * scalar `s`; a single scalarMul at block-commit time materializes the
 * point. This should reduce the ~165M gas of CommitASCNaive at n=100 to
 * roughly one scalarMul's cost (~1.7M gas per docs/REVISION_ROADMAP.md
 * R2-M6's estimate) regardless of n.
 *
 * See CommitBaseline.sol for the shared storage-layout/pending-array design
 * note (identical across all seven contracts in this directory).
 */
contract CommitASC1SM {
    uint256 internal constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 internal constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    mapping(bytes32 => bool) public elements;
    uint256 public count;

    // Running scalar sum, mod N. s = 1 initially (A = G = 1*G).
    uint256 public s;

    // Materialized point, computed via a single scalarMul(G, s) at the end
    // of each createBlock/createBlockChunked-completing call -- NOT updated
    // per element.
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

    /// @dev Batch version of addPending (T6, setup efficiency at large n).
    function addPendingBatch(bytes32[] calldata ids) external onlyOperator {
        for (uint256 i = 0; i < ids.length; i++) {
            pendingUtxos.push(ids[i]);
        }
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

    /// @dev The single scalarMul, paid once per completed block regardless
    /// of how many elements were folded into `s` in that block.
    function _finalizeDigest() internal {
        (accX, accY) = ECCMath.scalarMul(GX, GY, s);
    }

    function createBlock() external onlyOperator returns (uint256) {
        uint256 len = pendingUtxos.length;
        for (uint256 i = 0; i < len; i++) {
            _addElement(pendingUtxos[i]);
        }
        _finalizeDigest();
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
            _finalizeDigest();
            currentBlock++;
            delete pendingUtxos;
            pendingProcessedCursor = 0;
            return (currentBlock, true);
        }
        return (currentBlock, false);
    }
}
