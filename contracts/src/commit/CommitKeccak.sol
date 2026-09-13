// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title CommitKeccak
 * @dev Order-independent (from the caller's perspective) keccak256 digest,
 * built as a hash chain: digest = keccak256(digest, id). Ids must be
 * submitted in strictly increasing order (as uint256), enforced globally
 * (across the entire contract lifetime, not just within one block's
 * batch) via `lastId` -- this makes the digest canonical for a given set
 * of ids regardless of what order the operator originally collected them
 * in off-chain, since only one increasing order is accepted.
 *
 * Two distinct rejection behaviors, both required by contracts/test/
 * CommitVariants.t.sol:
 *   - A duplicate id (already in `elements`) is a graceful no-op: returns
 *     false, same as every other variant's duplicate guard.
 *   - A non-duplicate id that is NOT strictly greater than `lastId`
 *     reverts the whole call: this is a distinct correctness violation
 *     (out-of-order input), not a duplicate.
 *
 * See CommitBaseline.sol for the shared storage-layout/pending-array design
 * note (identical across all seven contracts in this directory).
 */
contract CommitKeccak {
    mapping(bytes32 => bool) public elements;
    uint256 public count;

    bytes32 public digest;
    uint256 public lastId; // highest id accepted so far, across all blocks

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

    function addPending(bytes32 id) external onlyOperator {
        pendingUtxos.push(id);
    }

    function _addElement(bytes32 element) internal returns (bool) {
        if (elements[element]) {
            return false; // duplicate: graceful no-op, same as other variants
        }
        uint256 idAsUint = uint256(element);
        require(idAsUint > lastId, "CommitKeccak: ids must be strictly increasing");

        lastId = idAsUint;
        digest = keccak256(abi.encodePacked(digest, element));
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
