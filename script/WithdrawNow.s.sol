// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../contracts/src/RootChain.sol";

/**
 * Script untuk withdrawal dengan witness yang FRESH dari backend
 *
 * IMPORTANT:
 * 1. Get witness from backend first: curl http://localhost:3001/api/witness/0x<TXHASH>
 * 2. Update the witness X and Y values below
 * 3. Run this script immediately (jangan delay, karena accumulator bisa berubah)
 */
contract WithdrawNowScript is Script {
    function run() external {
        uint256 userPrivateKey = vm.envUint("PK_USER_A");
        address rootChainAddress = vm.envAddress("ROOT_CHAIN_ADDRESS");
        address plasmaToken = vm.envAddress("PLASMA_TOKEN_ADDRESS");

        RootChain rootChain = RootChain(rootChainAddress);

        // ============================================================
        // UPDATE THESE VALUES WITH FRESH DATA FROM BACKEND
        // ============================================================

        // TxHash - get from: curl http://localhost:3001/api/accumulator/elements
        bytes32 txHash = 0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb;

        // Witness - get from: curl http://localhost:3001/api/witness/0x23c7e49f423415d75c31e019538a805a8f2c34d9bde17bff04ee04f2dd1e38eb
        // MUST BE FRESH! Get it right before running this script!
        ECCAccumulator.Point memory witness = ECCAccumulator.Point({
            x: 0x0,  // UPDATE THIS
            y: 0x0   // UPDATE THIS
        });

        // ============================================================

        uint256 amount = 2000 ether;

        // Get current block from contract
        uint256 currentBlock = rootChain.currentPlasmaBlock();

        vm.startBroadcast(userPrivateKey);

        console.log("========================================");
        console.log("WITHDRAWAL - FRESH WITNESS");
        console.log("========================================");
        console.log("Root Chain:", rootChainAddress);
        console.log("Token:", plasmaToken);
        console.log("Amount:", amount / 1 ether, "tokens");
        console.log("Current Block:", currentBlock);
        console.log("TxHash:");
        console.logBytes32(txHash);
        console.log("Witness X:");
        console.logBytes32(bytes32(witness.x));
        console.log("Witness Y:");
        console.logBytes32(bytes32(witness.y));
        console.log("========================================");

        // Validate witness is not zero
        require(witness.x != 0 && witness.y != 0, "WITNESS NOT UPDATED! Please update witness X and Y in the script!");

        // Call startExit
        rootChain.startExit(plasmaToken, amount, currentBlock, txHash, witness);

        console.log("");
        console.log("EXIT STARTED SUCCESSFULLY!");
        console.log("");

        vm.stopBroadcast();
    }
}
