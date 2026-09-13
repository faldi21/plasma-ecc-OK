// SPDX-License-Identifier: MIT
  pragma solidity ^0.8.30;

  import "forge-std/Script.sol";
  import "../contracts/src/RootChain.sol";
  import "../contracts/src/PlasmaChain.sol";
  import "../contracts/src/PlasmaToken.sol";

  contract DeployScript is Script {
      function run() external {
          uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
          address operatorAddress = vm.envAddress("OPERATOR_ADDRESS");

          vm.startBroadcast(deployerPrivateKey);

          // Deploy PlasmaToken
          PlasmaToken token = new PlasmaToken(
              "Plasma Token",
              "PLASMA",
              1000000 * 10**18 // 1 million tokens
          );
          console.log("PlasmaToken deployed at:", address(token));

          // Deploy RootChain
          RootChain rootChain = new RootChain(operatorAddress);
          console.log("RootChain deployed at:", address(rootChain));

          // Deploy PlasmaChain
          PlasmaChain plasmaChain = new PlasmaChain();
          console.log("PlasmaChain deployed at:", address(plasmaChain));

          vm.stopBroadcast();
      }
  }