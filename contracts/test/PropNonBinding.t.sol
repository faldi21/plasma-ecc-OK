// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/libraries/ECCAccumulator.sol";

/// @title PropNonBinding
/// @notice T4 (docs/EXPERIMENT_PRD.md §8, answers reviewer m6): the
/// additive accumulator commits only to the SUM of its elements mod N, not
/// to the multiset itself. Two genuinely different multisets that happen
/// to sum to the same value produce an IDENTICAL digest -- proven here via
/// two independent constructions:
///   1. Delta-swap: shift +delta on one element and -delta on another.
///   2. Balancing element: T u {e*} where e* = -sum(T) mod N matches the
///      EMPTY set's digest, no matter how large T is.
///
/// Test names and function names are final and cited in the paper
/// (docs/TICKETS.md T4) -- do not rename.
contract PropNonBinding is Test {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant SEED = 0x9016B1D1;

    /// @dev Digest of a set of elements exactly as the real accumulator
    /// computes it: A = (1 + sum(e_i mod N)) * G, i.e. G plus each
    /// element*G added in turn.
    function _digest(bytes32[] memory elements) internal view returns (uint256 x, uint256 y) {
        x = GX;
        y = GY;
        for (uint256 i = 0; i < elements.length; i++) {
            ECCAccumulator.Point memory elementPoint =
                ECCAccumulator.scalarMul(ECCAccumulator.Point(GX, GY), uint256(elements[i]));
            ECCAccumulator.Point memory acc =
                ECCAccumulator.pointAdd(ECCAccumulator.Point(x, y), elementPoint);
            x = acc.x;
            y = acc.y;
        }
    }

    /// Construction 1: +delta on one element, -delta on another. The
    /// multiset genuinely changes (two elements differ from the original)
    /// but the sum -- and therefore the digest -- does not.
    function test_NonBinding_DeltaSwapProducesIdenticalDigest() public view {
        bytes32[] memory s = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) {
            s[i] = keccak256(abi.encodePacked(SEED, "s", i));
        }

        uint256 delta = 424242;
        bytes32[] memory sPrime = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) sPrime[i] = s[i];
        sPrime[0] = bytes32(addmod(uint256(s[0]), delta, N));      // e_0 + delta
        sPrime[1] = bytes32(addmod(uint256(s[1]), N - delta, N));  // e_1 - delta (mod N)

        assertTrue(sPrime[0] != s[0], "sanity: element 0 must actually differ");
        assertTrue(sPrime[1] != s[1], "sanity: element 1 must actually differ");

        (uint256 xS, uint256 yS) = _digest(s);
        (uint256 xSPrime, uint256 ySPrime) = _digest(sPrime);

        assertEq(xS, xSPrime, "digest x must be identical for two different multisets with the same sum");
        assertEq(yS, ySPrime, "digest y must be identical for two different multisets with the same sum");
    }

    /// Construction 2: for ANY set T, adding a single balancing element
    /// e* = -sum(T) mod N makes T u {e*} sum to zero -- producing the SAME
    /// digest as the EMPTY set, despite T u {e*} having |T|+1 elements
    /// that were genuinely, individually added.
    function test_NonBinding_BalancingElementMatchesEmptySet() public view {
        bytes32[] memory t = new bytes32[](7);
        for (uint256 i = 0; i < 7; i++) {
            t[i] = keccak256(abi.encodePacked(SEED, "t", i));
        }

        uint256 sumT = 0;
        for (uint256 i = 0; i < 7; i++) {
            sumT = addmod(sumT, uint256(t[i]) % N, N);
        }
        uint256 eStar = sumT == 0 ? 0 : N - sumT; // = -sumT (mod N)

        bytes32[] memory tWithBalancer = new bytes32[](8);
        for (uint256 i = 0; i < 7; i++) tWithBalancer[i] = t[i];
        tWithBalancer[7] = bytes32(eStar);

        bytes32[] memory emptySet = new bytes32[](0);

        (uint256 xT, uint256 yT) = _digest(tWithBalancer);
        (uint256 xEmpty, uint256 yEmpty) = _digest(emptySet);

        assertEq(xT, xEmpty, "T union {e*} (8 elements) must match the empty set's digest x");
        assertEq(yT, yEmpty, "T union {e*} (8 elements) must match the empty set's digest y");
        // The empty set's digest is just G itself (accumulator identity).
        assertEq(xEmpty, GX);
        assertEq(yEmpty, GY);
    }
}
