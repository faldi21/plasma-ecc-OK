// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/PlasmaChainUTXO.sol";
import "../src/PlasmaChainUTXOInline.sol";
import "../src/PlasmaChainUTXOMerkle.sol";
import "../src/PlasmaChainUTXOMerkleInline.sol";

/// @title E3PlacementParityTest
/// @notice Proves each E3 "inline" placement cell (docs/EXPERIMENT_PRD.md
/// §6.1, docs/TICKETS.md T7) produces an IDENTICAL final digest to its
/// "deferred" counterpart, for the same sequence of deposits + a
/// transferUtxoBatch (the operation whose placement actually differs
/// between the two -- see PlasmaChainUTXOInline.sol's docblock), at
/// n in {1, 10, 100}. Only WHEN the accumulator gets updated is expected
/// to differ (immediately per output, vs at createBlock) -- this test
/// asserts the final VALUE does not. If it ever doesn't match, that would
/// mean placement changes the result, not just the cost -- a correctness
/// bug, not a benchmark artifact (per this ticket's explicit instruction:
/// stop and report rather than paper over a mismatch).
///
/// No vm.deployCode/low-level-call workaround needed here (unlike
/// PlasmaChainUTXOV0Parity.t.sol): that test's workaround exists because
/// the vendored contracts/src/legacy/ECCAccumulatorV0.sol declares a
/// SECOND `library ECCAccumulator` with the same name (needed for its own
/// byte-identity-with-history goal), which collides when directly
/// imported alongside the current one. PlasmaChainUTXOInline.sol and
/// PlasmaChainUTXOMerkleInline.sol both import the EXISTING, single
/// ECCAccumulator.sol/MerkleAccumulator.sol libraries directly (no vendored
/// duplicate), so plain `import` statements for all four contracts in one
/// file compile without any naming collision.
contract E3PlacementParityTest is Test {
    address constant TOKEN = address(0xDEAD);
    address constant RECIPIENT = address(0xBEEF);

    function _depositIds(uint256 n, string memory salt) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = keccak256(abi.encodePacked("e3-placement-parity", salt, i));
        }
    }

    // ---------------------------------------------------------------- ASC

    function _runASC(uint256 n) internal {
        bytes32[] memory ids = _depositIds(n, "asc");
        address[] memory users = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            users[i] = address(this); // this test contract owns every deposited UTXO
            amounts[i] = 1 ether;
        }

        PlasmaChainUTXO deferredC = new PlasmaChainUTXO();
        PlasmaChainUTXOInline inlineC = new PlasmaChainUTXOInline();

        deferredC.createDepositUtxoBatch(ids, users, TOKEN, amounts);
        inlineC.createDepositUtxoBatch(ids, users, TOKEN, amounts);

        (
            bytes32[] memory inputs,
            address[] memory outputOwners,
            uint256[] memory outputAmounts,
            uint8[] memory outputCounts
        ) = _batchArgs(ids, amounts);

        deferredC.transferUtxoBatch(inputs, outputOwners, outputAmounts, outputCounts);
        inlineC.transferUtxoBatch(inputs, outputOwners, outputAmounts, outputCounts);

        // Deferred needs an explicit createBlock() to catch up; inline is
        // already caught up (and calling createBlock() on it is a harmless
        // no-op re-check thanks to ECCAccumulator.add's duplicate guard).
        deferredC.createBlock();
        inlineC.createBlock();

        ECCAccumulator.Point memory deferredAcc = deferredC.getAccumulatorValue();
        ECCAccumulator.Point memory inlineAcc = inlineC.getAccumulatorValue();

        assertEq(deferredAcc.x, inlineAcc.x, string.concat("ASC x mismatch at n=", vm.toString(n)));
        assertEq(deferredAcc.y, inlineAcc.y, string.concat("ASC y mismatch at n=", vm.toString(n)));
    }

    function test_ASCParity_N1() public {
        _runASC(1);
    }

    function test_ASCParity_N10() public {
        _runASC(10);
    }

    function test_ASCParity_N100() public {
        _runASC(100);
    }

    // ---------------------------------------------------------------- Merkle

    function _runMerkle(uint256 n) internal {
        bytes32[] memory ids = _depositIds(n, "merkle");
        address[] memory users = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            users[i] = address(this);
            amounts[i] = 1 ether;
        }

        PlasmaChainUTXOMerkle deferredC = new PlasmaChainUTXOMerkle();
        PlasmaChainUTXOMerkleInline inlineC = new PlasmaChainUTXOMerkleInline();

        deferredC.createDepositUtxoBatch(ids, users, TOKEN, amounts);
        inlineC.createDepositUtxoBatch(ids, users, TOKEN, amounts);

        (
            bytes32[] memory inputs,
            address[] memory outputOwners,
            uint256[] memory outputAmounts,
            uint8[] memory outputCounts
        ) = _batchArgs(ids, amounts);

        deferredC.transferUtxoBatch(inputs, outputOwners, outputAmounts, outputCounts);
        inlineC.transferUtxoBatch(inputs, outputOwners, outputAmounts, outputCounts);

        deferredC.createBlock();
        inlineC.createBlock();

        bytes32 deferredRoot = deferredC.getAccumulatorValue();
        bytes32 inlineRoot = inlineC.getAccumulatorValue();

        assertEq(deferredRoot, inlineRoot, string.concat("Merkle root mismatch at n=", vm.toString(n)));
    }

    function test_MerkleParity_N1() public {
        _runMerkle(1);
    }

    function test_MerkleParity_N10() public {
        _runMerkle(10);
    }

    function test_MerkleParity_N100() public {
        _runMerkle(100);
    }

    // ---------------------------------------------------------------- shared

    /// @dev n single-input/single-output sub-ops: input i -> output i, same
    /// amount, all to RECIPIENT. Shape is identical regardless of which
    /// contract consumes it, so both deferred/inline calls in a given _run
    /// get byte-identical arguments (and, since they're issued from the
    /// same test-contract msg.sender at the same block.timestamp with
    /// identical nonce progression, byte-identical computed output ids).
    function _batchArgs(bytes32[] memory ids, uint256[] memory amounts)
        internal
        pure
        returns (
            bytes32[] memory inputs,
            address[] memory outputOwners,
            uint256[] memory outputAmounts,
            uint8[] memory outputCounts
        )
    {
        uint256 n = ids.length;
        inputs = ids;
        outputOwners = new address[](n);
        outputAmounts = new uint256[](n);
        outputCounts = new uint8[](n);
        for (uint256 i = 0; i < n; i++) {
            outputOwners[i] = RECIPIENT;
            outputAmounts[i] = amounts[i];
            outputCounts[i] = 1;
        }
    }
}
