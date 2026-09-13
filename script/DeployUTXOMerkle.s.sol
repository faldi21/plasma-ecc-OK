// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../contracts/src/PlasmaChainUTXOMerkle.sol";

/**
 * @title DeployL2UTXOMerkle
 * @dev Deploys the Merkle-baseline variant of PlasmaChainUTXO to L2 (Anvil).
 *      Used for empirical comparison against the ECC accumulator version.
 *
 * Usage:
 *   forge script script/DeployUTXOMerkle.s.sol:DeployL2UTXOMerkle \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast
 *
 * After deployment, set in .env:
 *   PLASMA_CHAIN_UTXO_MERKLE_ADDRESS=<deployed address>
 */
contract DeployL2UTXOMerkle is Script {
    function run() external {
        uint256 operatorPrivateKey = vm.envUint("OPERATOR_PRIVATE_KEY");

        console.log("Deploying L2 Merkle baseline contract...");
        console.log("Operator:", vm.addr(operatorPrivateKey));

        vm.startBroadcast(operatorPrivateKey);

        PlasmaChainUTXOMerkle plasmaChainMerkle = new PlasmaChainUTXOMerkle();
        console.log("PlasmaChainUTXOMerkle deployed at:", address(plasmaChainMerkle));

        vm.stopBroadcast();

        console.log("");
        console.log("=== L2 MERKLE DEPLOYMENT COMPLETE ===");
        console.log("PlasmaChainUTXOMerkle:", address(plasmaChainMerkle));
        console.log("");
        console.log("Add this to your .env file:");
        console.log("PLASMA_CHAIN_UTXO_MERKLE_ADDRESS=", address(plasmaChainMerkle));
    }
}
