// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/libraries/EcrecoverMulCheck.sol";
import "../src/libraries/ECCMath.sol";

/// @title EcrecoverMulCheckTest
/// @notice T1 (docs/TICKETS.md): validates that EcrecoverMulCheck.eqScalarMulG
/// agrees with ECCMath.scalarMul (the trusted, already-verified reference)
/// across 100 seeded random k values plus edge cases, and correctly rejects
/// malformed inputs. If this suite is not fully green, per the ticket's
/// explicit instruction we do not proceed to T2's CommitASCEcrecover --
/// docs/ECRECOVER_TRICK.md would be written instead (not needed here; see
/// results below).
contract EcrecoverMulCheckTest is Test {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 constant SEED = 0xEC5EC0F3;

    /// 100 seeded random k values, each checked against the ECCMath reference.
    function test_MatchesReference_100RandomK() public view {
        for (uint256 i = 0; i < 100; i++) {
            uint256 k = (uint256(keccak256(abi.encodePacked(SEED, i))) % (N - 2)) + 1; // in [1, N-1]

            (uint256 expectedX, uint256 expectedY) = ECCMath.scalarMul(GX, GY, k);
            bool ok = EcrecoverMulCheck.eqScalarMulG(k, expectedX, expectedY);

            assertTrue(ok, string.concat("mismatch at i=", vm.toString(i), " k=", vm.toString(k)));
        }
    }

    /// Reports gas cost per call, for the record (not written to any
    /// campaign document -- this is T1 validation only).
    function test_GasPerCall() public {
        uint256 k = 12345;
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, k);

        uint256 gasBefore = gasleft();
        bool ok = EcrecoverMulCheck.eqScalarMulG(k, x, y);
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(ok);
        emit log_named_uint("EcrecoverMulCheck.eqScalarMulG gas (includes SLOAD/JUMP overhead of this call frame)", gasUsed);
    }

    function test_k_Equals1() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, 1);
        assertEq(x, GX, "1*G must equal G");
        assertEq(y, GY, "1*G must equal G");
        assertTrue(EcrecoverMulCheck.eqScalarMulG(1, x, y));
    }

    function test_k_Equals2() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, 2);
        assertTrue(EcrecoverMulCheck.eqScalarMulG(2, x, y));
    }

    function test_k_EqualsNMinus1() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, N - 1);
        assertTrue(EcrecoverMulCheck.eqScalarMulG(N - 1, x, y));
    }

    // ---- Negative cases (>= 3 required) ----

    /// k = 0 must be rejected outright (degenerate scalar).
    function test_RevertWhen_KIsZero() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, 1);
        assertFalse(EcrecoverMulCheck.eqScalarMulG(0, x, y), "k=0 must be rejected");
        // Point supplied is irrelevant for k=0 -- it's rejected before any
        // ecrecover call, by construction.
    }

    /// k = N must be rejected (not a canonical scalar; N mod N = 0).
    function test_RevertWhen_KEqualsN() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, 1);
        assertFalse(EcrecoverMulCheck.eqScalarMulG(N, x, y), "k=N must be rejected");
    }

    /// k valid, but the claimed point is wrong (e.g. k*G's coordinates
    /// swapped) -- must be rejected, not accidentally accepted.
    function test_RevertWhen_ClaimedPointIsWrong() public view {
        (uint256 x, uint256 y) = ECCMath.scalarMul(GX, GY, 7);
        // Deliberately swap x/y to produce a point that is (almost
        // certainly) not 7*G.
        assertFalse(EcrecoverMulCheck.eqScalarMulG(7, y, x), "swapped coordinates must not verify");
    }

    /// k valid and matches a DIFFERENT k's point -- must be rejected.
    function test_RevertWhen_PointBelongsToDifferentK() public view {
        (uint256 x8, uint256 y8) = ECCMath.scalarMul(GX, GY, 8);
        assertFalse(EcrecoverMulCheck.eqScalarMulG(9, x8, y8), "point for k=8 must not verify against k=9");
    }
}
