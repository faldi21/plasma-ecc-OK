// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../contracts/src/test/DebugAccumulator.sol";

contract DeployDebug is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        DebugAccumulator debug = new DebugAccumulator();

        console.log("DebugAccumulator deployed at:", address(debug));

        vm.stopBroadcast();
    }
}
