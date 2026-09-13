// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/libraries/ECCAccumulator.sol";
import "../src/libraries/ECCMath.sol";
import "../src/commit/CommitBaseline.sol";
import "../src/commit/CommitASCNaive.sol";
import "../src/commit/CommitASC1SM.sol";
import "../src/commit/CommitASCEcrecover.sol";
import "../src/commit/CommitScalar.sol";
import "../src/commit/CommitKeccak.sol";
import "../src/commit/CommitMerkle.sol";

// ============================================================================
// ECCAccumulatorParityTest
// ============================================================================

/**
 * @dev Verbatim copy of ECCAccumulator.sol's pointAdd/scalarMul/modInverse/
 * modExp EXACTLY AS THEY EXISTED before the T1+T2 ECCMath extraction (frozen
 * here as ground truth). Used only to prove the refactored ECCAccumulator
 * (which now delegates to ECCMath.sol) is behaviorally identical -- this is
 * NOT a claim that the original arithmetic is cryptographically correct
 * against independent secp256k1 test vectors, only that the extraction
 * changed nothing.
 */
library ReferenceECCAccumulator {
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    struct Point {
        uint256 x;
        uint256 y;
    }

    function pointAdd(Point memory p1, Point memory p2) internal view returns (Point memory) {
        if (p1.x == 0 && p1.y == 0) return p2;
        if (p2.x == 0 && p2.y == 0) return p1;

        uint256 slope;
        if (p1.x == p2.x) {
            if (p1.y == p2.y) {
                uint256 temp1 = mulmod(p1.x, p1.x, P);
                uint256 temp2 = mulmod(3, temp1, P);
                uint256 temp3 = mulmod(2, p1.y, P);
                uint256 inverse = modInverse(temp3, P);
                slope = mulmod(temp2, inverse, P);
            } else {
                return Point(0, 0);
            }
        } else {
            uint256 dy = addmod(p2.y, P - p1.y, P);
            uint256 dx = addmod(p2.x, P - p1.x, P);
            uint256 inverse = modInverse(dx, P);
            slope = mulmod(dy, inverse, P);
        }

        uint256 slope2 = mulmod(slope, slope, P);
        uint256 x3 = slope2;
        x3 = addmod(x3, P - p1.x, P);
        x3 = addmod(x3, P - p2.x, P);

        uint256 dx = addmod(p1.x, P - x3, P);
        uint256 y3 = mulmod(slope, dx, P);
        y3 = addmod(y3, P - p1.y, P);

        return Point(x3, y3);
    }

    function scalarMul(Point memory p, uint256 scalar) internal view returns (Point memory) {
        scalar = scalar % N;
        Point memory result = Point(0, 0);
        Point memory base = p;
        while (scalar > 0) {
            if (scalar & 1 == 1) {
                result = pointAdd(result, base);
            }
            base = pointAdd(base, base);
            scalar >>= 1;
        }
        return result;
    }

    function modInverse(uint256 a, uint256 m) internal view returns (uint256) {
        if (a == 0) return 0;
        return modExp(a, m - 2, m);
    }

    function modExp(uint256 base, uint256 exponent, uint256 modulus) internal view returns (uint256 result) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x20)
            mstore(add(ptr, 0x20), 0x20)
            mstore(add(ptr, 0x40), 0x20)
            mstore(add(ptr, 0x60), base)
            mstore(add(ptr, 0x80), exponent)
            mstore(add(ptr, 0xa0), modulus)
            let success := staticcall(gas(), 0x05, ptr, 0xc0, ptr, 0x20)
            if iszero(success) {
                revert(0, 0)
            }
            result := mload(ptr)
        }
    }
}

/// @title ECCAccumulatorParityTest
/// @notice Proves the ECCMath extraction (T1+T2 decision, overriding IRON
/// RULE 5's blanket "don't touch ECCAccumulator.sol" for this one
/// controlled, code-motion-only refactor) changed no behavior: the
/// refactored ECCAccumulator.pointAdd/scalarMul must match
/// ReferenceECCAccumulator (the frozen pre-refactor logic above) for every
/// input tested, including point-doubling (p1 == p2) and point-inverse
/// (p1.x == p2.x, p1.y != p2.y) branches.
contract ECCAccumulatorParityTest is Test {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant SEED = 0xACC0EC7A;

    function test_ScalarMul_MatchesReference_100RandomK() public view {
        for (uint256 i = 0; i < 100; i++) {
            uint256 k = uint256(keccak256(abi.encodePacked(SEED, i)));

            ReferenceECCAccumulator.Point memory refResult =
                ReferenceECCAccumulator.scalarMul(ReferenceECCAccumulator.Point(GX, GY), k);
            ECCAccumulator.Point memory newResult =
                ECCAccumulator.scalarMul(ECCAccumulator.Point(GX, GY), k);

            assertEq(newResult.x, refResult.x, string.concat("x mismatch at i=", vm.toString(i)));
            assertEq(newResult.y, refResult.y, string.concat("y mismatch at i=", vm.toString(i)));
        }
    }

    function test_ScalarMul_EdgeCases() public view {
        uint256[5] memory ks = [uint256(0), 1, 2, 3, ReferenceECCAccumulator.N - 1];
        for (uint256 i = 0; i < ks.length; i++) {
            ReferenceECCAccumulator.Point memory refResult =
                ReferenceECCAccumulator.scalarMul(ReferenceECCAccumulator.Point(GX, GY), ks[i]);
            ECCAccumulator.Point memory newResult =
                ECCAccumulator.scalarMul(ECCAccumulator.Point(GX, GY), ks[i]);

            assertEq(newResult.x, refResult.x);
            assertEq(newResult.y, refResult.y);
        }
    }

    /// Exercises pointAdd's point-doubling branch (p1 == p2) directly.
    function test_PointAdd_Doubling() public view {
        ReferenceECCAccumulator.Point memory refG = ReferenceECCAccumulator.Point(GX, GY);
        ReferenceECCAccumulator.Point memory refResult = ReferenceECCAccumulator.pointAdd(refG, refG);

        ECCAccumulator.Point memory newG = ECCAccumulator.Point(GX, GY);
        ECCAccumulator.Point memory newResult = ECCAccumulator.pointAdd(newG, newG);

        assertEq(newResult.x, refResult.x);
        assertEq(newResult.y, refResult.y);
    }

    /// Exercises pointAdd's point-inverse branch (same x, different y) --
    /// both implementations must return (0, 0).
    function test_PointAdd_Inverse() public view {
        // (Gx, Gy) and (Gx, P - Gy) are inverses of each other.
        uint256 P = ReferenceECCAccumulator.P;
        ReferenceECCAccumulator.Point memory refP1 = ReferenceECCAccumulator.Point(GX, GY);
        ReferenceECCAccumulator.Point memory refP2 = ReferenceECCAccumulator.Point(GX, P - GY);
        ReferenceECCAccumulator.Point memory refResult = ReferenceECCAccumulator.pointAdd(refP1, refP2);

        ECCAccumulator.Point memory newP1 = ECCAccumulator.Point(GX, GY);
        ECCAccumulator.Point memory newP2 = ECCAccumulator.Point(GX, P - GY);
        ECCAccumulator.Point memory newResult = ECCAccumulator.pointAdd(newP1, newP2);

        assertEq(refResult.x, 0);
        assertEq(refResult.y, 0);
        assertEq(newResult.x, 0);
        assertEq(newResult.y, 0);
    }

    /// Exercises pointAdd's identity-element short-circuits ((0,0) + P = P).
    function test_PointAdd_Identity() public view {
        ReferenceECCAccumulator.Point memory refZero = ReferenceECCAccumulator.Point(0, 0);
        ReferenceECCAccumulator.Point memory refG = ReferenceECCAccumulator.Point(GX, GY);
        ReferenceECCAccumulator.Point memory refResult = ReferenceECCAccumulator.pointAdd(refZero, refG);

        ECCAccumulator.Point memory newZero = ECCAccumulator.Point(0, 0);
        ECCAccumulator.Point memory newG = ECCAccumulator.Point(GX, GY);
        ECCAccumulator.Point memory newResult = ECCAccumulator.pointAdd(newZero, newG);

        assertEq(newResult.x, refResult.x);
        assertEq(newResult.y, refResult.y);
        assertEq(newResult.x, GX);
        assertEq(newResult.y, GY);
    }

    /// End-to-end: ECCAccumulator.add()/verify() (the actual public API
    /// used by PlasmaChainUTXO.sol/RootChainUTXO.sol) still round-trips
    /// correctly after the refactor.
    function test_AddAndVerify_StillWorks() public {
        Harness h = new Harness();
        bytes32 element = keccak256("parity-element");
        h.add(element);

        ECCAccumulator.Point memory acc = h.getValue();
        // witness = A - e*G
        ECCAccumulator.Point memory elementPoint =
            ECCAccumulator.scalarMul(ECCAccumulator.Point(GX, GY), uint256(element));
        uint256 P = ReferenceECCAccumulator.P;
        ECCAccumulator.Point memory negElementPoint = ECCAccumulator.Point(elementPoint.x, P - elementPoint.y);
        ECCAccumulator.Point memory witness = ECCAccumulator.pointAdd(acc, negElementPoint);

        assertTrue(h.verify(element, witness));
    }
}

/// @dev Thin storage-holding wrapper, since ECCAccumulator.Accumulator lives
/// in storage (it contains a mapping) and can't be used from a stateless
/// test contract directly.
contract Harness {
    using ECCAccumulator for ECCAccumulator.Accumulator;

    ECCAccumulator.Accumulator private accumulator;

    constructor() {
        accumulator.initialize();
    }

    function add(bytes32 element) external returns (bool) {
        return accumulator.add(element);
    }

    function verify(bytes32 element, ECCAccumulator.Point memory witness) external view returns (bool) {
        return accumulator.verify(element, witness);
    }

    function getValue() external view returns (ECCAccumulator.Point memory) {
        return accumulator.getValue();
    }
}

// ============================================================================
// CommitVariantsTest
// ============================================================================

/// @title CommitVariantsTest
/// @notice T2 (docs/TICKETS.md): for n in {1, 2, 10, 100} with seeded
/// elements, verifies (a) ASCNaive/ASC1SM/ASCEcrecover/Scalar reach
/// mathematically equivalent state, (b) CommitKeccak rejects out-of-order
/// input, and (c) every variant rejects duplicates.
contract CommitVariantsTest is Test {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant SEED = 0xC0117BE7;

    /// Generates n seeded elements as monotonically increasing bytes32
    /// values (needed so the same element set is valid input for
    /// CommitKeccak too, which requires strictly increasing ids).
    function _seededIncreasingElements(uint256 n) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](n);
        uint256 base = uint256(keccak256(abi.encodePacked(SEED, n))) >> 32; // leave room to add i without wraparound in practice
        for (uint256 i = 0; i < n; i++) {
            ids[i] = bytes32(base + i + 1); // +1 so id=0 (== lastId's initial value) is never used
        }
    }

    // ---- (a) ASCNaive / ASC1SM / ASCEcrecover / Scalar equivalence ----

    function test_Equivalence_N1() public {
        _runEquivalenceCheck(1);
    }

    function test_Equivalence_N2() public {
        _runEquivalenceCheck(2);
    }

    function test_Equivalence_N10() public {
        _runEquivalenceCheck(10);
    }

    function test_Equivalence_N100() public {
        _runEquivalenceCheck(100);
    }

    function _runEquivalenceCheck(uint256 n) internal {
        bytes32[] memory ids = _seededIncreasingElements(n);

        CommitASCNaive naive = new CommitASCNaive();
        CommitASC1SM oneSm = new CommitASC1SM();
        CommitASCEcrecover ecrec = new CommitASCEcrecover();
        CommitScalar scalarOnly = new CommitScalar();

        for (uint256 i = 0; i < n; i++) {
            naive.addPending(ids[i]);
            oneSm.addPending(ids[i]);
            ecrec.addPending(ids[i]);
            scalarOnly.addPending(ids[i]);
        }

        naive.createBlock();
        oneSm.createBlock();
        scalarOnly.createBlock();

        // Compute the expected final scalar off-chain (mirrors what an
        // honest operator would do) to supply ASCEcrecover's claimed point.
        uint256 expectedS = 1;
        for (uint256 i = 0; i < n; i++) {
            expectedS = addmod(expectedS, uint256(ids[i]) % N, N);
        }
        (uint256 claimedX, uint256 claimedY) = ECCMath.scalarMul(GX, GY, expectedS);
        ecrec.createBlock(claimedX, claimedY);

        // (a) All three point-based variants must agree exactly.
        assertEq(naive.accX(), oneSm.accX(), "naive vs 1SM x mismatch");
        assertEq(naive.accY(), oneSm.accY(), "naive vs 1SM y mismatch");
        assertEq(naive.accX(), ecrec.accX(), "naive vs ecrecover x mismatch");
        assertEq(naive.accY(), ecrec.accY(), "naive vs ecrecover y mismatch");

        // The scalar-only variant's `s`, converted through scalarMul(G, s)
        // off-chain, must equal the same point.
        assertEq(scalarOnly.s(), expectedS, "scalar sum mismatch");
        (uint256 sx, uint256 sy) = ECCMath.scalarMul(GX, GY, scalarOnly.s());
        assertEq(sx, naive.accX(), "scalar-derived point x mismatch");
        assertEq(sy, naive.accY(), "scalar-derived point y mismatch");
    }

    // ---- (b) CommitKeccak rejects out-of-order input ----

    function test_CommitKeccak_RejectsOutOfOrder() public {
        CommitKeccak k = new CommitKeccak();
        k.addPending(bytes32(uint256(100)));
        k.addPending(bytes32(uint256(50))); // not a duplicate, but out of order

        vm.expectRevert("CommitKeccak: ids must be strictly increasing");
        k.createBlock();
    }

    function test_CommitKeccak_AcceptsStrictlyIncreasing() public {
        CommitKeccak k = new CommitKeccak();
        bytes32[] memory ids = _seededIncreasingElements(10);
        for (uint256 i = 0; i < ids.length; i++) {
            k.addPending(ids[i]);
        }
        k.createBlock();
        assertEq(k.count(), 10);
    }

    // ---- (c) every variant rejects duplicates ----

    function test_CommitBaseline_RejectsDuplicate() public {
        CommitBaseline c = new CommitBaseline();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id); // duplicate
        c.createBlock();
        assertEq(c.count(), 1, "duplicate must not be counted twice");
    }

    function test_CommitASCNaive_RejectsDuplicate() public {
        CommitASCNaive c = new CommitASCNaive();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id);
        c.createBlock();
        assertEq(c.count(), 1);
    }

    function test_CommitASC1SM_RejectsDuplicate() public {
        CommitASC1SM c = new CommitASC1SM();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id);
        c.createBlock();
        assertEq(c.count(), 1);
    }

    function test_CommitASCEcrecover_RejectsDuplicate() public {
        CommitASCEcrecover c = new CommitASCEcrecover();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id);

        uint256 expectedS = addmod(1, uint256(id) % N, N); // only counted once
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, expectedS);
        c.createBlock(x, y);
        assertEq(c.count(), 1);
    }

    function test_CommitScalar_RejectsDuplicate() public {
        CommitScalar c = new CommitScalar();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id);
        c.createBlock();
        assertEq(c.count(), 1);
    }

    function test_CommitKeccak_RejectsDuplicate() public {
        CommitKeccak c = new CommitKeccak();
        bytes32 id = bytes32(uint256(42));
        c.addPending(id);
        c.addPending(id); // exact duplicate -- caught by the elements guard
        // before the strictly-increasing check would otherwise revert.
        c.createBlock();
        assertEq(c.count(), 1);
    }

    function test_CommitMerkle_RejectsDuplicate() public {
        CommitMerkle c = new CommitMerkle();
        bytes32 id = keccak256("dup");
        c.addPending(id);
        c.addPending(id);
        c.createBlock();
        assertEq(c.getCount(), 1);
    }
}
