// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/libraries/ECCAccumulator.sol";

/// @dev Thin external wrapper around the library's internal functions so a
/// revert can be observed from a Foundry test with vm.expectRevert (which
/// requires a call-frame boundary). Does not modify ECCAccumulator.sol.
contract VerifyWrapper {
    function callVerifyWithAccumulator(
        bytes32 element,
        ECCAccumulator.Point memory witness,
        ECCAccumulator.Point memory targetAccumulator
    ) external view returns (bool) {
        return ECCAccumulator.verifyWithAccumulator(element, witness, targetAccumulator);
    }
}

/// @title PointRangeRevertTest
/// @notice Asserts the CURRENT behavior of ECCAccumulator.verifyWithAccumulator
/// / pointAdd around Point coordinates that exceed the secp256k1 field prime
/// P. This does NOT fix the missing range validation (docs/FAILING_TESTS.md
/// #1) -- it only documents, as executable tests, exactly what happens today,
/// per IRON RULE 5 (ECCAccumulator.sol is not modified).
contract PointRangeRevertTest is Test {
    // secp256k1 constants, mirrored from ECCAccumulator.sol (read-only copy).
    uint256 constant P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;

    bytes32 constant ELEMENT = keccak256("point-range-test-element");

    VerifyWrapper wrapper;

    function setUp() public {
        wrapper = new VerifyWrapper();
    }

    /// witness.x > P must revert with panic 0x11 (arithmetic underflow).
    /// Root cause: ECCAccumulator.sol:114, `P - p1.x` underflows when
    /// p1.x > P (docs/FAILING_TESTS.md #1.1). This is the exact shape of
    /// the counterexample Foundry's fuzzer found in DebugAccumulator's
    /// former testVerify.
    function test_RevertWhen_WitnessXExceedsP() public {
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({x: P + 1, y: GY});
        ECCAccumulator.Point memory accumulator = ECCAccumulator.Point({x: GX, y: GY});

        vm.expectRevert(stdError.arithmeticError);
        wrapper.callVerifyWithAccumulator(ELEMENT, witness, accumulator);
    }

    /// witness.y > P must also revert -- same underflow, one line earlier
    /// (ECCAccumulator.sol:113, `P - p1.y`).
    function test_RevertWhen_WitnessYExceedsP() public {
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({x: GX, y: P + 1});
        ECCAccumulator.Point memory accumulator = ECCAccumulator.Point({x: GX, y: GY});

        vm.expectRevert(stdError.arithmeticError);
        wrapper.callVerifyWithAccumulator(ELEMENT, witness, accumulator);
    }

    /// Boundary: x = P - 1 is a valid field element (the largest one) and
    /// must not revert. The boolean result is not meaningful here (P-1 is
    /// not necessarily on the curve, and pointAdd never checks curve
    /// membership) -- the assertion is purely "no panic".
    function test_Boundary_XEqualsPMinus1_DoesNotRevert() public view {
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({x: P - 1, y: GY});
        ECCAccumulator.Point memory accumulator = ECCAccumulator.Point({x: GX, y: GY});

        wrapper.callVerifyWithAccumulator(ELEMENT, witness, accumulator);
    }

    /// Boundary: x = P exactly. `P - P = 0` does NOT underflow, so unlike
    /// x = P+1 this does NOT revert. Documented because it is a non-obvious
    /// edge of the same bug: the function silently treats x = P as if it
    /// were x = 0 (since P mod P = 0), rather than rejecting P as a
    /// non-canonical field representation. This test asserts the current
    /// (non-reverting) behavior; it is not a claim that this is correct.
    function test_Boundary_XEqualsP_DoesNotRevert() public view {
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({x: P, y: GY});
        ECCAccumulator.Point memory accumulator = ECCAccumulator.Point({x: GX, y: GY});

        wrapper.callVerifyWithAccumulator(ELEMENT, witness, accumulator);
    }

    /// A witness constructed the way the paper's Remark 1 / reviewer M2
    /// describe (w = A - e*G) is guaranteed to have coordinates < P, because
    /// it comes out of pointAdd/scalarMul, which always reduce mod P. Such a
    /// witness must NOT revert and must verify (return true). This isolates
    /// the missing-range-check bug (above) from the algebraic vacuity
    /// finding: a properly forged witness is unaffected by it.
    function test_ProperlyForgedWitness_DoesNotRevert_AndVerifies() public view {
        // A = G (fresh accumulator, matches ECCAccumulator.initialize()).
        ECCAccumulator.Point memory accumulator = ECCAccumulator.Point({x: GX, y: GY});

        // e*G
        ECCAccumulator.Point memory elementPoint = ECCAccumulator.scalarMul(
            ECCAccumulator.Point(GX, GY),
            uint256(ELEMENT)
        );

        // w = A - e*G = A + (-(e*G)). Negate by y -> P - y (mod P); always
        // < P here because elementPoint.y is already a reduced field element
        // coming out of scalarMul/pointAdd.
        ECCAccumulator.Point memory negElementPoint = ECCAccumulator.Point({
            x: elementPoint.x,
            y: P - elementPoint.y
        });
        ECCAccumulator.Point memory witness = ECCAccumulator.pointAdd(accumulator, negElementPoint);

        assertLt(witness.x, P, "sanity: forged witness.x must be < P");
        assertLt(witness.y, P, "sanity: forged witness.y must be < P");

        bool ok = wrapper.callVerifyWithAccumulator(ELEMENT, witness, accumulator);
        assertTrue(ok, "properly forged witness must verify (M2 / Remark 1 vacuity)");
    }
}
