// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title CommitScalar
 * @dev Theoretical lower bound for an additive-checksum-style commitment
 * (reviewer M1, docs/paper1_rejection_findings.md): stores only the running
 * scalar s = 1 + sum(e_i mod N), with no elliptic-curve point at all. Since
 * scalar multiplication is a group homomorphism from (Z_N, +), s alone is
 * functionally equivalent to the point s*G computed by CommitASCNaive/
 * CommitASC1SM/CommitASCEcrecover -- this variant measures what the
 * accumulator costs with the "elliptic curve part" removed entirely.
 *
 * See CommitBaseline.sol for the shared storage-layout/pending-array design
 * note (identical across all seven contracts in this directory).
 */
contract CommitScalar {
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    mapping(bytes32 => bool) public elements;
    uint256 public count;

    // The entire "digest" -- just a scalar, no curve point whatsoever.
    uint256 public s;

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
