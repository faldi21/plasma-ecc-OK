// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../contracts/src/RootChain.sol";

contract DeployRootChainOnly is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operatorAddress = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy RootChain with fixed ECCAccumulator
        RootChain rootChain = new RootChain(operatorAddress);

        console.log("========================================");
        console.log("RootChain deployed at:", address(rootChain));
        console.log("Operator address:", operatorAddress);
        console.log("========================================");
        console.log("");
        console.log("IMPORTANT: Update .env with new address:");
        console.log("ROOT_CHAIN_ADDRESS=%s", address(rootChain));
        console.log("========================================");

        vm.stopBroadcast();
    }
}
