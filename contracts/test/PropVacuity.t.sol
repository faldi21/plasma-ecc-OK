// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/libraries/ECCAccumulator.sol";

/// @title PropVacuity
/// @notice T3 (docs/EXPERIMENT_PRD.md §8, answers M2/Remark 1): for 100
/// random elements that were NEVER added to any accumulator,
/// verifyWithAccumulator always returns true when given the forged witness
/// W = A_b - e*G. Demonstrates the additive scheme's verification carries
/// zero evidence of actual set membership -- it holds unconditionally, for
/// every candidate element.
///
/// Test name and function name are final and cited in the paper
/// (docs/TICKETS.md T4) -- do not rename.
contract PropVacuity is Test {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    uint256 constant SEED = 0x7ACC117E;

    function test_Vacuity_100RandomNeverAddedElementsAllVerify() public view {
        // An arbitrary "current" accumulator value -- any point works,
        // since verify never actually constrains it to have been built
        // from any specific set. Use G, matching a freshly initialized
        // accumulator.
        ECCAccumulator.Point memory accumulatorValue = ECCAccumulator.Point(GX, GY);

        for (uint256 i = 0; i < 100; i++) {
            bytes32 element = keccak256(abi.encodePacked(SEED, i));

            ECCAccumulator.Point memory elementPoint =
                ECCAccumulator.scalarMul(ECCAccumulator.Point(GX, GY), uint256(element));
            ECCAccumulator.Point memory negElementPoint =
                ECCAccumulator.Point(elementPoint.x, P - elementPoint.y);
            ECCAccumulator.Point memory witness = ECCAccumulator.pointAdd(accumulatorValue, negElementPoint);

            bool verified = ECCAccumulator.verifyWithAccumulator(element, witness, accumulatorValue);
            assertTrue(
                verified,
                string.concat("element i=", vm.toString(i), " must verify despite never being added to any set")
            );
        }
    }
}
