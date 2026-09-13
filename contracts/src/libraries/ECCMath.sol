// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ECCMath
 * @dev Pure secp256k1 point-arithmetic primitives, extracted verbatim from
 * ECCAccumulator.sol (pointAdd, scalarMul, modInverse, modExp) so the seven
 * commit-variant benchmark contracts (contracts/src/commit/) can reuse the
 * exact same arithmetic without duplicating it seven times.
 *
 * ECCAccumulator.sol now delegates its own pointAdd/scalarMul/modInverse/
 * modExp to this library. This is a pure code-motion refactor with no
 * intended behavior change; see contracts/test/CommitVariants.t.sol's
 * ECCAccumulatorParityTest for an executable proof that the refactored
 * ECCAccumulator produces byte-identical outputs to the original inline
 * implementation (a verbatim reference copy embedded in the test) across
 * many inputs, including the point-doubling and point-inverse branches.
 *
 * Point coordinates are passed as raw (x, y) uint256 pairs rather than a
 * struct: ECCAccumulator.sol's own `Point` struct type is left completely
 * untouched (so `ECCAccumulator.Point`, used throughout PlasmaChainUTXO.sol,
 * PlasmaChainUTXOMerkle.sol (indirectly), RootChainUTXO.sol, and other
 * callers, keeps meaning exactly what it always meant) -- a library-local
 * struct here would be a distinct, ABI-incompatible type despite the
 * identical (uint256, uint256) layout, since Solidity structs are
 * nominally, not structurally, typed.
 */
library ECCMath {
    // Secp256k1 curve parameters (mirrors ECCAccumulator.sol's N and P).
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    /**
     * @dev Point addition pada elliptic curve (fixed to avoid overflow)
     */
    function pointAdd(uint256 p1x, uint256 p1y, uint256 p2x, uint256 p2y)
        internal
        view
        returns (uint256 x3, uint256 y3)
    {
        if (p1x == 0 && p1y == 0) return (p2x, p2y);
        if (p2x == 0 && p2y == 0) return (p1x, p1y);

        uint256 slope;
        if (p1x == p2x) {
            if (p1y == p2y) {
                // Point doubling
                uint256 temp1 = mulmod(p1x, p1x, P);
                uint256 temp2 = mulmod(3, temp1, P);
                uint256 temp3 = mulmod(2, p1y, P);
                uint256 inverse = modInverse(temp3, P);
                slope = mulmod(temp2, inverse, P);
            } else {
                // Points are inverses
                return (0, 0);
            }
        } else {
            // Regular addition - use addmod to avoid overflow
            uint256 dy = addmod(p2y, P - p1y, P);  // p2.y - p1.y (mod P)
            uint256 dx = addmod(p2x, P - p1x, P);  // p2.x - p1.x (mod P)
            uint256 inverse = modInverse(dx, P);
            slope = mulmod(dy, inverse, P);
        }

        // x3 = slope^2 - p1.x - p2.x (mod P)
        // Use addmod to avoid overflow
        uint256 slope2 = mulmod(slope, slope, P);
        x3 = slope2;
        x3 = addmod(x3, P - p1x, P);  // x3 = slope^2 - p1.x
        x3 = addmod(x3, P - p2x, P);  // x3 = slope^2 - p1.x - p2.x

        // y3 = slope * (p1.x - x3) - p1.y (mod P)
        uint256 dx2 = addmod(p1x, P - x3, P);  // p1.x - x3
        y3 = mulmod(slope, dx2, P);            // slope * (p1.x - x3)
        y3 = addmod(y3, P - p1y, P);           // slope * (p1.x - x3) - p1.y

        return (x3, y3);
    }

    /**
     * @dev Scalar multiplication pada elliptic curve
     */
    function scalarMul(uint256 px, uint256 py, uint256 scalar)
        internal
        view
        returns (uint256 rx, uint256 ry)
    {
        // Reduce scalar modulo N (curve order) to ensure proper range
        scalar = scalar % N;

        uint256 resultX = 0;
        uint256 resultY = 0;
        uint256 baseX = px;
        uint256 baseY = py;

        while (scalar > 0) {
            if (scalar & 1 == 1) {
                (resultX, resultY) = pointAdd(resultX, resultY, baseX, baseY);
            }
            (baseX, baseY) = pointAdd(baseX, baseY, baseX, baseY);
            scalar >>= 1;
        }

        return (resultX, resultY);
    }

    /**
     * @dev Modular inverse using Fermat's little theorem via precompiled modexp
     * a^(-1) = a^(p-2) (mod p) for prime p
     */
    function modInverse(uint256 a, uint256 m) internal view returns (uint256) {
        if (a == 0) return 0;

        // Use modexp precompile (0x05) for efficiency
        // a^(m-2) mod m
        return modExp(a, m - 2, m);
    }

    /**
     * @dev Modular exponentiation using precompiled contract (0x05)
     * Much more gas efficient than looping
     */
    function modExp(uint256 base, uint256 exponent, uint256 modulus) internal view returns (uint256 result) {
        assembly {
            // Free memory pointer
            let ptr := mload(0x40)

            // Define input layout for modexp precompile
            // <length_of_BASE> <length_of_EXPONENT> <length_of_MODULUS> <BASE> <EXPONENT> <MODULUS>
            mstore(ptr, 0x20)                       // Length of BASE (32 bytes)
            mstore(add(ptr, 0x20), 0x20)            // Length of EXPONENT (32 bytes)
            mstore(add(ptr, 0x40), 0x20)            // Length of MODULUS (32 bytes)
            mstore(add(ptr, 0x60), base)            // BASE
            mstore(add(ptr, 0x80), exponent)        // EXPONENT
            mstore(add(ptr, 0xa0), modulus)         // MODULUS

            // Call modexp precompile at 0x05
            let success := staticcall(
                gas(),          // forward all gas
                0x05,           // modexp precompile address
                ptr,            // input start
                0xc0,           // input size (6 * 32 bytes)
                ptr,            // output start (reuse same memory)
                0x20            // output size (32 bytes)
            )

            // Check if call succeeded
            if iszero(success) {
                revert(0, 0)
            }

            // Load result
            result := mload(ptr)
        }
    }
}
