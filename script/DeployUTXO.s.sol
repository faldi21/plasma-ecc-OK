// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../src/RootChainUTXO.sol";
import "../src/PlasmaChainUTXO.sol";

contract DeployUTXO is Script {
    function run() external {
        // Get private keys from environment
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operatorAddress = vm.envAddress("OPERATOR_ADDRESS");

        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Operator:", operatorAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy RootChainUTXO (for L1 - Sepolia)
        RootChainUTXO rootChain = new RootChainUTXO(operatorAddress);
        console.log("RootChainUTXO deployed at:", address(rootChain));

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("RootChainUTXO:", address(rootChain));
        console.log("");
        console.log("Update your .env file with:");
        console.log("ROOT_CHAIN_UTXO_ADDRESS=", address(rootChain));
    }
}

contract DeployL2UTXO is Script {
    function run() external {
        // For L2 (Anvil), use the operator key
        uint256 operatorPrivateKey = vm.envUint("OPERATOR_PRIVATE_KEY");

        console.log("Deploying L2 contract...");
        console.log("Operator:", vm.addr(operatorPrivateKey));

        vm.startBroadcast(operatorPrivateKey);

        // Deploy PlasmaChainUTXO (for L2 - Anvil)
        PlasmaChainUTXO plasmaChain = new PlasmaChainUTXO();
        console.log("PlasmaChainUTXO deployed at:", address(plasmaChain));

        vm.stopBroadcast();

        console.log("");
        console.log("=== L2 DEPLOYMENT COMPLETE ===");
        console.log("PlasmaChainUTXO:", address(plasmaChain));
        console.log("");
        console.log("Update your .env file with:");
        console.log("PLASMA_CHAIN_UTXO_ADDRESS=", address(plasmaChain));
    }
}
