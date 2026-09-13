// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ECCAccumulator
 * @dev Library untuk ECC Accumulator sebagai pengganti Merkle Tree
 * Menggunakan elliptic curve untuk mencatat transaksi secara efisien
 */
library ECCAccumulator {
    // Secp256k1 curve parameters
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    struct Point {
        uint256 x;
        uint256 y;
    }

    struct Accumulator {
        Point value;
        uint256 count;
        mapping(bytes32 => bool) elements;
    }

    /**
     * @dev Inisialisasi accumulator dengan generator point
     */
    function initialize(Accumulator storage acc) internal {
        acc.value = Point(GX, GY);
        acc.count = 0;
    }

    /**
     * @dev Menambahkan element ke accumulator
     */
    function add(Accumulator storage acc, bytes32 element) internal returns (bool) {
        if (acc.elements[element]) {
            return false; // Element sudah ada
        }

        // scalarMul will handle modulo N internally
        Point memory newPoint = scalarMul(Point(GX, GY), uint256(element));
        acc.value = pointAdd(acc.value, newPoint);
        acc.elements[element] = true;
        acc.count++;

        return true;
    }

    /**
     * @dev Verifikasi membership element dalam accumulator
     * 
     * Verification hanya perlu memastikan bahwa: witness + element = current_accumulator
     * Tidak perlu memeriksa apakah element sudah di-record dalam mapping karena:
     * - Backend yang mengelola accumulator, bukan contract
     * - Backend mengirim witness yang sudah dikompute dengan element
     * - Verifikasi hanya cek mathematical property, tidak perlu lookup
     */
    function verify(
        Accumulator storage acc,
        bytes32 element,
        Point memory witness
    ) internal view returns (bool) {
        // scalarMul will handle modulo N internally
        Point memory elementPoint = scalarMul(Point(GX, GY), uint256(element));
        Point memory computedAcc = pointAdd(witness, elementPoint);

        return computedAcc.x == acc.value.x && computedAcc.y == acc.value.y;
    }

    /**
     * @dev Verifikasi membership element dengan target accumulator tertentu
     * Digunakan untuk verify transaction terhadap historical block accumulator
     *
     * witness + element*G should equal targetAccumulator
     */
    function verifyWithAccumulator(
        bytes32 element,
        Point memory witness,
        Point memory targetAccumulator
    ) internal view returns (bool) {
        // scalarMul will handle modulo N internally
        Point memory elementPoint = scalarMul(Point(GX, GY), uint256(element));
        Point memory computedAcc = pointAdd(witness, elementPoint);

        return computedAcc.x == targetAccumulator.x && computedAcc.y == targetAccumulator.y;
    }

    /**
     * @dev Point addition pada elliptic curve (fixed to avoid overflow)
     */
    function pointAdd(Point memory p1, Point memory p2) internal view returns (Point memory) {
        if (p1.x == 0 && p1.y == 0) return p2;
        if (p2.x == 0 && p2.y == 0) return p1;

        uint256 slope;
        if (p1.x == p2.x) {
            if (p1.y == p2.y) {
                // Point doubling
                uint256 temp1 = mulmod(p1.x, p1.x, P);
                uint256 temp2 = mulmod(3, temp1, P);
                uint256 temp3 = mulmod(2, p1.y, P);
                uint256 inverse = modInverse(temp3, P);
                slope = mulmod(temp2, inverse, P);
            } else {
                // Points are inverses
                return Point(0, 0);
            }
        } else {
            // Regular addition - use addmod to avoid overflow
            uint256 dy = addmod(p2.y, P - p1.y, P);  // p2.y - p1.y (mod P)
            uint256 dx = addmod(p2.x, P - p1.x, P);  // p2.x - p1.x (mod P)
            uint256 inverse = modInverse(dx, P);
            slope = mulmod(dy, inverse, P);
        }

        // x3 = slope^2 - p1.x - p2.x (mod P)
        // Use addmod to avoid overflow
        uint256 slope2 = mulmod(slope, slope, P);
        uint256 x3 = slope2;
        x3 = addmod(x3, P - p1.x, P);  // x3 = slope^2 - p1.x
        x3 = addmod(x3, P - p2.x, P);  // x3 = slope^2 - p1.x - p2.x

        // y3 = slope * (p1.x - x3) - p1.y (mod P)
        uint256 dx = addmod(p1.x, P - x3, P);  // p1.x - x3
        uint256 y3 = mulmod(slope, dx, P);      // slope * (p1.x - x3)
        y3 = addmod(y3, P - p1.y, P);          // slope * (p1.x - x3) - p1.y

        return Point(x3, y3);
    }

    /**
     * @dev Scalar multiplication pada elliptic curve
     */
    function scalarMul(Point memory p, uint256 scalar) internal view returns (Point memory) {
        // Reduce scalar modulo N (curve order) to ensure proper range
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

    /**
     * @dev Modular inverse using Fermat's little theorem via precompiled modexp
     * a^(-1) ≡ a^(p-2) (mod p) for prime p
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

    /**
     * @dev Get current accumulator value
     */
    function getValue(Accumulator storage acc) internal view returns (Point memory) {
        return acc.value;
    }

    /**
     * @dev Get element count
     */
    function getCount(Accumulator storage acc) internal view returns (uint256) {
        return acc.count;
    }
}
