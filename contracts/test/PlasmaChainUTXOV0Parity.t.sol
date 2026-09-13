// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/PlasmaChainUTXO.sol";

/// @title PlasmaChainUTXOV0ParityTest
/// @notice Proves PlasmaChainUTXOV0 (vendored pre-ECCMath-extraction code,
/// contracts/src/legacy/) and PlasmaChainUTXO (current, post-extraction)
/// produce IDENTICAL accumulatorValue for the same sequence of elements at
/// n in {1, 10, 100}. Only cost is expected to differ (see
/// docs/ECCMATH_REFACTOR_GAS.md) -- this test asserts the result does not.
///
/// Deliberately does NOT `import "../src/legacy/PlasmaChainUTXOV0.sol"`:
/// doing so in the same file as `import "../src/PlasmaChainUTXO.sol"`
/// triggers a Solidity "Identifier already declared" error, because both
/// files transitively declare a `library ECCAccumulator` (the vendored
/// copy keeps that name unchanged for byte-identity with the original --
/// see contracts/src/legacy/ECCAccumulatorV0.sol's header) and Solidity
/// resolves imported symbols into one flat table per file, not truly
/// per-import-source. Deploying PlasmaChainUTXOV0 via vm.deployCode from
/// its compiled artifact, and calling it through low-level
/// call/staticcall with manually-encoded selectors, avoids the import
/// entirely -- so contracts/src/legacy/*.sol stays exactly as vendored
/// (ECCAccumulatorV0.sol byte-identical after its header;
/// PlasmaChainUTXOV0.sol differing from the original by exactly the two
/// lines documented in its own header), with zero further changes needed
/// to make this comparison possible.
contract PlasmaChainUTXOV0ParityTest is Test {
    address constant TOKEN = address(0xDEAD);

    function _ids(uint256 n) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = keccak256(abi.encodePacked("v0-parity-test", i));
        }
    }

    function _run(uint256 n) internal {
        bytes32[] memory ids = _ids(n);
        address[] memory users = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            users[i] = address(uint160(0x2000 + i));
            amounts[i] = 1 ether;
        }

        PlasmaChainUTXO current = new PlasmaChainUTXO();
        address v0 = vm.deployCode("PlasmaChainUTXOV0.sol:PlasmaChainUTXOV0");

        current.createDepositUtxoBatch(ids, users, TOKEN, amounts);
        _callCreateDepositUtxoBatch(v0, ids, users, TOKEN, amounts);

        current.createBlock();
        _callNoArgs(v0, "createBlock()");

        ECCAccumulator.Point memory currentAcc = current.getAccumulatorValue();
        (uint256 v0X, uint256 v0Y) = _getAccumulatorValue(v0);

        assertEq(currentAcc.x, v0X, string.concat("x mismatch at n=", vm.toString(n)));
        assertEq(currentAcc.y, v0Y, string.concat("y mismatch at n=", vm.toString(n)));
    }

    function _callCreateDepositUtxoBatch(
        address target,
        bytes32[] memory ids,
        address[] memory users,
        address token,
        uint256[] memory amounts
    ) internal {
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSignature(
                "createDepositUtxoBatch(bytes32[],address[],address,uint256[])",
                ids,
                users,
                token,
                amounts
            )
        );
        require(ok, string(ret));
    }

    function _callNoArgs(address target, string memory sig) internal {
        (bool ok, bytes memory ret) = target.call(abi.encodeWithSignature(sig));
        require(ok, string(ret));
    }

    function _getAccumulatorValue(address target) internal view returns (uint256, uint256) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature("getAccumulatorValue()"));
        require(ok, "getAccumulatorValue call failed");
        (uint256 x, uint256 y) = abi.decode(ret, (uint256, uint256));
        return (x, y);
    }

    function test_Parity_N1() public {
        _run(1);
    }

    function test_Parity_N10() public {
        _run(10);
    }

    function test_Parity_N100() public {
        _run(100);
    }
}
