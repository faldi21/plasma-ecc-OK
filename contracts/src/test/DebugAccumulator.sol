// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/ECCAccumulator.sol";

/**
 * @title DebugAccumulator
 * @dev Debug contract to test and log accumulator verification
 */
contract DebugAccumulator {
    using ECCAccumulator for ECCAccumulator.Accumulator;

    ECCAccumulator.Accumulator public accumulator;

    // Events for debugging
    event VerifyAttempt(
        bytes32 element,
        uint256 witness_x,
        uint256 witness_y
    );

    event ElementPoint(
        uint256 scalar,
        uint256 point_x,
        uint256 point_y
    );

    event ComputedAccumulator(
        uint256 computed_x,
        uint256 computed_y
    );

    event ExpectedAccumulator(
        uint256 expected_x,
        uint256 expected_y
    );

    event VerificationResult(
        bool x_match,
        bool y_match,
        bool final_result
    );

    constructor() {
        accumulator.initialize();
    }

    /**
     * @dev Set accumulator to a specific value (for testing)
     */
    function setAccumulator(uint256 x, uint256 y) external {
        accumulator.value.x = x;
        accumulator.value.y = y;
    }

    /**
     * @dev Get current accumulator value
     */
    function getAccumulatorValue() external view returns (ECCAccumulator.Point memory) {
        return accumulator.getValue();
    }

    /**
     * @dev Debug verify with full logging. Renamed from testVerify to
     * debugVerify (docs/FAILING_TESTS.md #1.4) so Foundry's test-name
     * convention no longer auto-fuzzes this debug-only function.
     */
    function debugVerify(
        bytes32 element,
        ECCAccumulator.Point memory witness
    ) external returns (bool) {
        emit VerifyAttempt(element, witness.x, witness.y);

        // Manually compute what verify() does
        uint256 N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        uint256 GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
        uint256 GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;

        uint256 scalar = uint256(element) % N;

        // Compute element * G
        ECCAccumulator.Point memory elementPoint = ECCAccumulator.scalarMul(
            ECCAccumulator.Point(GX, GY),
            scalar
        );

        emit ElementPoint(scalar, elementPoint.x, elementPoint.y);

        // Compute witness + elementPoint
        ECCAccumulator.Point memory computedAcc = ECCAccumulator.pointAdd(
            witness,
            elementPoint
        );

        emit ComputedAccumulator(computedAcc.x, computedAcc.y);
        emit ExpectedAccumulator(accumulator.value.x, accumulator.value.y);

        bool x_match = computedAcc.x == accumulator.value.x;
        bool y_match = computedAcc.y == accumulator.value.y;
        bool result = x_match && y_match;

        emit VerificationResult(x_match, y_match, result);

        return result;
    }

    /**
     * @dev Direct verify call
     */
    function verify(
        bytes32 element,
        ECCAccumulator.Point memory witness
    ) external view returns (bool) {
        return accumulator.verify(element, witness);
    }

    /**
     * @dev Add element to accumulator
     */
    function add(bytes32 element) external returns (bool) {
        return accumulator.add(element);
    }
}
