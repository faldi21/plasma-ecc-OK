// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../contracts/src/RootChain.sol";

contract TestWithdrawalScript is Script {
    function run() external {
        uint256 userPrivateKey = vm.envUint("PK_USER_A");
        address rootChainAddress = vm.envAddress("ROOT_CHAIN_ADDRESS");
        address plasmaToken = vm.envAddress("PLASMA_TOKEN_ADDRESS");

        RootChain rootChain = RootChain(rootChainAddress);

        // Data from backend accumulator
        bytes32 txHash = 0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb;

        // Witness from backend
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({
            x: 0x73e7751db38d33fdcb72609c018812b5c7c5a900d14939715220390b174b2f26,
            y: 0x7839cfacec818101bc4a2635996b8400ae549e0eaed0f2810c274046068758e9
        });

        uint256 amount = 2000 ether;
        uint256 blockNumber = 2;

        vm.startBroadcast(userPrivateKey);

        console.log("========================================");
        console.log("WITHDRAWAL TEST");
        console.log("========================================");
        console.log("Root Chain:", rootChainAddress);
        console.log("Token:", plasmaToken);
        console.log("Amount:", amount / 1 ether, "tokens");
        console.log("Block:", blockNumber);
        console.log("TxHash:");
        console.logBytes32(txHash);
        console.log("========================================");

        // Call startExit
        rootChain.startExit(plasmaToken, amount, blockNumber, txHash, witness);

        console.log("");
        console.log("EXIT STARTED SUCCESSFULLY!");
        console.log("");

        vm.stopBroadcast();
    }
}
