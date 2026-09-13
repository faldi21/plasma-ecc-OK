// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./ECCMath.sol";

/**
 * @title ECCAccumulator
 * @dev Library untuk ECC Accumulator sebagai pengganti Merkle Tree
 * Menggunakan elliptic curve untuk mencatat transaksi secara efisien
 *
 * pointAdd/scalarMul/modInverse/modExp below delegate to ECCMath.sol (code
 * extraction, no behavior change -- see ECCMath.sol's docblock and
 * contracts/test/CommitVariants.t.sol's ECCAccumulatorParityTest for the
 * equivalence proof). The Point struct and all other members are untouched.
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
     * @dev Point addition pada elliptic curve. Delegates to ECCMath.pointAdd
     * (extraction, no behavior change).
     */
    function pointAdd(Point memory p1, Point memory p2) internal view returns (Point memory) {
        (uint256 x3, uint256 y3) = ECCMath.pointAdd(p1.x, p1.y, p2.x, p2.y);
        return Point(x3, y3);
    }

    /**
     * @dev Scalar multiplication pada elliptic curve. Delegates to
     * ECCMath.scalarMul (extraction, no behavior change).
     */
    function scalarMul(Point memory p, uint256 scalar) internal view returns (Point memory) {
        (uint256 rx, uint256 ry) = ECCMath.scalarMul(p.x, p.y, scalar);
        return Point(rx, ry);
    }

    /**
     * @dev Modular inverse. Delegates to ECCMath.modInverse (extraction, no
     * behavior change).
     */
    function modInverse(uint256 a, uint256 m) internal view returns (uint256) {
        return ECCMath.modInverse(a, m);
    }

    /**
     * @dev Modular exponentiation. Delegates to ECCMath.modExp (extraction,
     * no behavior change).
     */
    function modExp(uint256 base, uint256 exponent, uint256 modulus) internal view returns (uint256 result) {
        return ECCMath.modExp(base, exponent, modulus);
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
