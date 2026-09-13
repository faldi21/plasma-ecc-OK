// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title RootChainBench
 * @dev Minimal L1 anchoring contract for E1/E2 (docs/EXPERIMENT_PRD.md):
 * measures gas and calldata cost of submitting a block digest to L1,
 * independent of any exit-game logic. Two entry points cover the two
 * digest shapes produced by the seven commit variants: a curve point
 * (CommitASCNaive/ASC1SM/ASCEcrecover) or a single bytes32 (CommitScalar
 * as a scalar, CommitKeccak/CommitMerkle as a hash/root).
 *
 * This intentionally does NOT implement startExit/challengeExitWithSpendProof
 * or any other RootChainUTXO.sol logic -- it exists purely to isolate L1
 * anchoring cost from L2 commit-construction cost (reviewer M6/R1-5:
 * "pisahkan gas L2 vs L1 anchoring").
 */
contract RootChainBench {
    struct PointBlock {
        uint256 x;
        uint256 y;
        uint256 timestamp;
    }

    struct RootBlock {
        bytes32 root;
        uint256 timestamp;
    }

    mapping(uint256 => PointBlock) public pointBlocks;
    mapping(uint256 => RootBlock) public rootBlocks;
    uint256 public currentBlock;

    address public operator;

    event BlockSubmittedPoint(uint256 indexed blockNumber, uint256 x, uint256 y);
    event BlockSubmittedRoot(uint256 indexed blockNumber, bytes32 root);

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    /// @dev Anchors a curve-point digest (64 bytes: two uint256 words).
    function submitBlockPoint(uint256 x, uint256 y) external onlyOperator returns (uint256) {
        currentBlock++;
        pointBlocks[currentBlock] = PointBlock({x: x, y: y, timestamp: block.timestamp});
        emit BlockSubmittedPoint(currentBlock, x, y);
        return currentBlock;
    }

    /// @dev Anchors a single-word digest (32 bytes: a scalar, hash, or
    /// Merkle root -- shape is identical on-chain regardless of which).
    function submitBlockRoot(bytes32 root) external onlyOperator returns (uint256) {
        currentBlock++;
        rootBlocks[currentBlock] = RootBlock({root: root, timestamp: block.timestamp});
        emit BlockSubmittedRoot(currentBlock, root);
        return currentBlock;
    }
}
