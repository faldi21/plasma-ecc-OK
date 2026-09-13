// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title CommitBaseline
 * @dev Control variant for E1 (docs/EXPERIMENT_PRD.md 4.1): reads pending
 * ids from storage and applies the same duplicate guard as every other
 * variant, but computes NO digest at all. Every other commit variant's
 * gas cost minus this contract's gas cost isolates the pure cost of that
 * variant's cryptographic primitive, with storage-read and duplicate-guard
 * overhead subtracted out.
 *
 * Storage layout and pending-array/cursor pattern are deliberately
 * identical across all seven contracts in contracts/src/commit/, mirroring
 * PlasmaChainUTXO.sol's pendingUtxos/pendingProcessedCursor/createBlock/
 * createBlockChunked -- the only thing that varies between variants is the
 * body of `_addElement`. No shared interface or base contract is used
 * (per the T1+T2 decision overriding EXPERIMENT_PRD.md's ICommitStrategy):
 * each of the seven contracts is independent and self-contained.
 */
contract CommitBaseline {
    // Duplicate guard, equivalent to ECCAccumulator.Accumulator's
    // `mapping(bytes32 => bool) elements`.
    mapping(bytes32 => bool) public elements;
    uint256 public count;

    // Cumulative across blocks: never reset by createBlock, matching
    // PlasmaChainUTXO.sol's _createBlockChunked semantics (the accumulator
    // state is a running lifetime total, not per-block).
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
    }

    /// @dev Benchmark setup helper: queue an id for the next createBlock.
    function addPending(bytes32 id) external onlyOperator {
        pendingUtxos.push(id);
    }

    function _addElement(bytes32 element) internal returns (bool) {
        if (elements[element]) {
            return false; // duplicate guard, same semantics as ECCAccumulator.add
        }
        // No digest computation -- this is the control variant.
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
