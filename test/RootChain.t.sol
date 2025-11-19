// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/RootChain.sol";
import "../src/PlasmaToken.sol";
import "../src/libraries/ECCAccumulator.sol";

contract RootChainTest is Test {
    RootChain public rootChain;
    PlasmaToken public token;
    
    address public operator = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);
    
    function setUp() public {
        // Deploy contracts
        rootChain = new RootChain(operator);
        token = new PlasmaToken("Test Token", "TEST", 1000000 * 10**18);
        
        // Setup test accounts
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        token.transfer(user1, 1000 * 10**18);
    }
    
    function testDeposit() public {
        vm.startPrank(user1);
        
        // Approve token
        token.approve(address(rootChain), 100 * 10**18);
        
        // Deposit
        rootChain.deposit(address(token), 100 * 10**18);
        
        // Check balance
        assertEq(rootChain.balances(user1, address(token)), 100 * 10**18);
        
        vm.stopPrank();
    }
    
    function testDepositETH() public {
        vm.startPrank(user1);
        
        // Deposit ETH
        rootChain.depositETH{value: 1 ether}();
        
        // Check balance
        assertEq(rootChain.balances(user1, address(0)), 1 ether);
        
        vm.stopPrank();
    }
    
    function testSubmitBlock() public {
        vm.startPrank(operator);
        
        // Create test data
        ECCAccumulator.Point memory accValue = ECCAccumulator.Point(1, 2);
        bytes32[] memory txHashes = new bytes32[](2);
        txHashes[0] = keccak256("tx1");
        txHashes[1] = keccak256("tx2");
        
        // Submit block
        rootChain.submitBlock(accValue, 2, txHashes);
        
        // Check block
        assertEq(rootChain.currentPlasmaBlock(), 1);
        
        vm.stopPrank();
    }
}
