// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/PlasmaChain.sol";

contract PlasmaChainTransferTest is Test {
    PlasmaChain public plasmaChain;
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public token = address(0x3);

    function setUp() public {
        plasmaChain = new PlasmaChain();

        // Add balance for Alice
        plasmaChain.addBalance(alice, token, 2000 ether);
        plasmaChain.addBalance(bob, token, 1000 ether);
    }

    function testTransfer() public {
        // Check initial balances
        assertEq(plasmaChain.getBalance(alice, token), 2000 ether);
        assertEq(plasmaChain.getBalance(bob, token), 1000 ether);

        uint256 nonce = plasmaChain.nonces(alice);
        assertEq(nonce, 0);

        // Execute transfer as Alice
        vm.prank(alice);
        bytes32 txHash = plasmaChain.executeTransaction(
            alice,
            bob,
            token,
            3 ether,
            0,
            ""
        );

        // Check final balances
        assertEq(plasmaChain.getBalance(alice, token), 1997 ether);
        assertEq(plasmaChain.getBalance(bob, token), 1003 ether);
        assertEq(plasmaChain.nonces(alice), 1);
    }
}
