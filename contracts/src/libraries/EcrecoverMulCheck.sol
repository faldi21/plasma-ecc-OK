// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title EcrecoverMulCheck
 * @dev Verifies A == k*G on secp256k1 using the ecrecover precompile (~3,000
 * gas) instead of an on-chain scalar multiplication (~1.65M gas), following
 * the technique described by V. Buterin, "You can kinda abuse ECRECOVER to
 * do ECMUL in secp256k1 today," ethresear.ch, 29 Jun 2018.
 *
 * ecrecover(hash, v, r, s) recovers the address of the public key Q such
 * that: Q = r^-1 * (s*R - hash*G), where R is the point with x-coordinate
 * r (and y-parity selected by v).
 *
 * Choosing hash = 0, r = Gx, R = G (so v encodes G's own y-parity), and
 * s = k*Gx (mod N) collapses this to:
 *
 *   Q = Gx^-1 * (k*Gx*G - 0*G) = Gx^-1 * Gx * k*G = k*G
 *
 * so ecrecover(0, v, Gx, k*Gx mod N) returns address(k*G) at precompile
 * cost, without ever computing k*G with an on-chain double-and-add loop.
 *
 * CommitASCEcrecover (contracts/src/commit/) uses this to let the operator
 * submit a claimed accumulator point (computed off-chain) and verify it
 * on-chain cheaply, instead of the contract computing the scalar
 * multiplication itself (see CommitASC1SM for the on-chain alternative).
 */
library EcrecoverMulCheck {
    uint256 constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;
    uint256 constant GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8;
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    // v = 27 + parity(Gy). GY's least significant bit is 0 (Gy is even),
    // so v = 27. (27/28 is the standard secp256k1/Ethereum recovery-id
    // convention: 27 for even y, 28 for odd y.)
    uint8 constant V_FOR_G = 27;

    /**
     * @dev Verifies that the point (ax, ay) equals k*G.
     * @param k the claimed scalar. Must be in (0, N) -- k = 0 or k >= N is
     * rejected because ecrecover's underlying math is undefined/degenerate
     * at those values (k = 0 would claim the point at infinity, which has
     * no valid (ax, ay) representation here; k >= N is not a canonical
     * scalar for a curve of order N).
     * @param ax, ay the claimed point coordinates, compared by taking the
     * low 160 bits of keccak256(ax, ay) as an "address" and comparing it
     * against what ecrecover recovers -- this is exactly how Ethereum
     * addresses are derived from public keys, reused here as a cheap
     * point-equality check.
     */
    function eqScalarMulG(uint256 k, uint256 ax, uint256 ay) internal pure returns (bool) {
        if (k == 0 || k >= N) return false;

        address expected = address(uint160(uint256(keccak256(abi.encodePacked(ax, ay)))));

        address got = ecrecover(
            bytes32(0),
            V_FOR_G,
            bytes32(GX),
            bytes32(mulmod(k, GX, N))
        );

        return got != address(0) && got == expected;
    }
}
