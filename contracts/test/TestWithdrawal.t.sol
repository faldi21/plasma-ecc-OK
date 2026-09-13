// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/RootChain.sol";

contract TestWithdrawal is Test {
    RootChain rootChain;

    function setUp() public {
        // Fork Sepolia at latest block
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));

        // Load the deployed contract
        rootChain = RootChain(vm.envAddress("ROOT_CHAIN_ADDRESS"));
    }

    function testStartExit() public {
        // Use data from our backend
        // TxHash from block 2
        bytes32 txHash = 0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb;

        // Witness from backend (generated when block 2 was created)
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({
            x: 0x73e7751db38d33fdcb72609c018812b5c7c5a900d14939715220390b174b2f26,
            y: 0x7839cfacec818101bc4a2635996b8400ae549e0eaed0f2810c274046068758e9
        });

        address token = vm.envAddress("PLASMA_TOKEN_ADDRESS");
        uint256 amount = 2000 ether;
        uint256 blockNumber = 2;  // This tx was in block 2

        // Use the actual user address
        address user = 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76;

        vm.startPrank(user);

        // This should now succeed because we verify against block 2's accumulator
        // not the current accumulator
        rootChain.startExit(token, amount, blockNumber, txHash, witness);

        vm.stopPrank();

        console.log("Exit started successfully!");
    }
}
