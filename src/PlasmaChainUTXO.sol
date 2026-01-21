// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./libraries/ECCAccumulator.sol";

/**
 * @title PlasmaChainUTXO
 * @dev Contract untuk mengelola state di Layer 2 dengan UTXO model
 *
 * UTXO Model:
 * - Setiap deposit dari L1 membuat UTXO baru
 * - Transfer consume input UTXOs dan create output UTXOs
 * - Total input HARUS sama dengan total output (no inflation)
 * - Mencegah double-spending dengan tracking spent status
 */
contract PlasmaChainUTXO {
    using ECCAccumulator for ECCAccumulator.Accumulator;

    // ============ STRUCTS ============

    struct UTXO {
        bytes32 utxoId;         // Unique identifier
        address owner;          // Current owner
        address token;          // Token address
        uint256 amount;         // Amount
        uint256 createdInBlock; // Block where created
        bool spent;             // Whether spent
        bytes32 spentInTx;      // Transaction that spent this UTXO
    }

    struct Block {
        uint256 blockNumber;
        bytes32[] utxoIds;      // List of UTXO IDs in this block
        ECCAccumulator.Point accumulatorValue;
        uint256 timestamp;
    }

    // ============ STATE VARIABLES ============

    // UTXO storage
    mapping(bytes32 => UTXO) public utxos;
    mapping(address => bytes32[]) public userUtxos;
    mapping(bytes32 => bool) public processedDeposits;

    // Block storage
    mapping(uint256 => Block) public blocks;
    uint256 public currentBlock;

    // Pending transactions for next block
    bytes32[] public pendingUtxos;

    // Accumulator
    ECCAccumulator.Accumulator private accumulator;

    // Nonces for replay protection
    mapping(address => uint256) public nonces;

    // Operator
    address public operator;

    // ============ EVENTS ============

    event UtxoCreated(
        bytes32 indexed utxoId,
        address indexed owner,
        address indexed token,
        uint256 amount,
        uint256 blockNumber
    );

    event UtxoSpent(
        bytes32 indexed utxoId,
        bytes32 indexed spendingTxHash
    );

    event TransferExecuted(
        bytes32 indexed txHash,
        address indexed sender,
        bytes32[] inputUtxoIds,
        bytes32[] outputUtxoIds
    );

    event WithdrawalRequested(
        bytes32 indexed withdrawalTxHash,
        address indexed user,
        address indexed token,
        uint256 amount,
        bytes32 utxoId
    );

    event BlockCreated(
        uint256 indexed blockNumber,
        uint256 utxoCount
    );

    // ============ MODIFIERS ============

    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor() {
        operator = msg.sender;
        accumulator.initialize();
    }

    // ============ DEPOSIT UTXO CREATION ============

    /**
     * @dev Create UTXO from L1 deposit
     * Called by operator when deposit is relayed from L1
     * @param depositUtxoId The UTXO ID generated on L1
     * @param user The depositor address
     * @param token The token address
     * @param amount The deposit amount
     */
    function createDepositUtxo(
        bytes32 depositUtxoId,
        address user,
        address token,
        uint256 amount
    ) external onlyOperator returns (bytes32) {
        require(!processedDeposits[depositUtxoId], "Deposit already processed");
        require(user != address(0), "Invalid user");
        require(amount > 0, "Invalid amount");

        // Create UTXO
        utxos[depositUtxoId] = UTXO({
            utxoId: depositUtxoId,
            owner: user,
            token: token,
            amount: amount,
            createdInBlock: currentBlock + 1,
            spent: false,
            spentInTx: bytes32(0)
        });

        // Add to user's UTXO list
        userUtxos[user].push(depositUtxoId);

        // Mark deposit as processed
        processedDeposits[depositUtxoId] = true;

        // Add to pending for next block
        pendingUtxos.push(depositUtxoId);

        // Add to accumulator
        accumulator.add(depositUtxoId);

        emit UtxoCreated(depositUtxoId, user, token, amount, currentBlock + 1);

        return depositUtxoId;
    }

    // ============ UTXO TRANSFER ============

    /**
     * @dev Transfer UTXOs - spend inputs and create outputs
     * @param inputUtxoIds Array of input UTXO IDs to spend
     * @param outputOwners Array of output owners
     * @param outputAmounts Array of output amounts
     * @param signature User's signature (for operator relay)
     */
    function transferUtxo(
        bytes32[] calldata inputUtxoIds,
        address[] calldata outputOwners,
        uint256[] calldata outputAmounts,
        bytes memory signature
    ) external returns (bytes32[] memory) {
        require(inputUtxoIds.length > 0, "No inputs");
        require(outputOwners.length > 0 && outputOwners.length <= 2, "Invalid outputs");
        require(outputOwners.length == outputAmounts.length, "Output array mismatch");

        // Validate and get sender/token from first input
        UTXO storage firstInput = utxos[inputUtxoIds[0]];
        require(firstInput.utxoId != bytes32(0), "Input UTXO not found");
        require(!firstInput.spent, "Input UTXO already spent");

        address sender = firstInput.owner;
        address token = firstInput.token;
        uint256 totalInput = firstInput.amount;

        // Validate remaining inputs
        for (uint256 i = 1; i < inputUtxoIds.length; i++) {
            UTXO storage input = utxos[inputUtxoIds[i]];
            require(input.utxoId != bytes32(0) && !input.spent, "Invalid input");
            require(input.owner == sender && input.token == token, "Input mismatch");
            totalInput += input.amount;
        }

        // Calculate and validate total output
        uint256 totalOutput = _sumOutputs(outputOwners, outputAmounts);
        require(totalOutput == totalInput, "Input/output amount mismatch");

        // Verify authorization
        bytes32 txHash = keccak256(abi.encodePacked(inputUtxoIds, outputOwners, outputAmounts, nonces[sender]));
        _verifyAuth(txHash, signature, sender);

        // Mark inputs as spent
        _markInputsSpent(inputUtxoIds, txHash);

        // Create outputs and return
        bytes32[] memory outputUtxoIds = _createOutputs(txHash, token, outputOwners, outputAmounts);

        nonces[sender]++;
        emit TransferExecuted(txHash, sender, inputUtxoIds, outputUtxoIds);

        return outputUtxoIds;
    }

    function _sumOutputs(address[] calldata owners, uint256[] calldata amounts) internal pure returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(owners[i] != address(0) && amounts[i] > 0, "Invalid output");
            total += amounts[i];
        }
        return total;
    }

    function _verifyAuth(bytes32 txHash, bytes memory signature, address sender) internal view {
        if (msg.sender == sender) return;
        if (msg.sender == operator) {
            require(verifySignature(txHash, signature, sender), "Invalid signature");
            return;
        }
        revert("Unauthorized");
    }

    function _markInputsSpent(bytes32[] calldata inputUtxoIds, bytes32 txHash) internal {
        for (uint256 i = 0; i < inputUtxoIds.length; i++) {
            utxos[inputUtxoIds[i]].spent = true;
            utxos[inputUtxoIds[i]].spentInTx = txHash;
            emit UtxoSpent(inputUtxoIds[i], txHash);
        }
    }

    function _createOutputs(
        bytes32 txHash,
        address token,
        address[] calldata outputOwners,
        uint256[] calldata outputAmounts
    ) internal returns (bytes32[] memory) {
        bytes32[] memory outputUtxoIds = new bytes32[](outputOwners.length);
        uint256 nextBlock = currentBlock + 1;

        for (uint256 i = 0; i < outputOwners.length; i++) {
            bytes32 outputUtxoId = keccak256(abi.encodePacked(txHash, i, block.timestamp));

            utxos[outputUtxoId] = UTXO({
                utxoId: outputUtxoId,
                owner: outputOwners[i],
                token: token,
                amount: outputAmounts[i],
                createdInBlock: nextBlock,
                spent: false,
                spentInTx: bytes32(0)
            });

            userUtxos[outputOwners[i]].push(outputUtxoId);
            outputUtxoIds[i] = outputUtxoId;
            pendingUtxos.push(outputUtxoId);
            accumulator.add(outputUtxoId);

            emit UtxoCreated(outputUtxoId, outputOwners[i], token, outputAmounts[i], nextBlock);
        }

        return outputUtxoIds;
    }

    // ============ WITHDRAWAL REQUEST ============

    /**
     * @dev Request withdrawal - spend UTXO on L2 to claim on L1
     * @param utxoId The UTXO to withdraw
     * @param signature User's signature (for operator relay)
     */
    function requestWithdrawal(
        bytes32 utxoId,
        bytes memory signature
    ) external returns (bytes32) {
        UTXO storage utxo = utxos[utxoId];

        require(utxo.utxoId != bytes32(0), "UTXO not found");
        require(!utxo.spent, "UTXO already spent");

        address user = utxo.owner;

        // Create withdrawal transaction hash
        bytes32 withdrawalTxHash = keccak256(abi.encodePacked(
            utxoId,
            "WITHDRAWAL",
            nonces[user],
            block.timestamp
        ));

        // Verify authorization
        if (msg.sender == user) {
            // Direct user call
        } else if (msg.sender == operator) {
            // Operator relay - verify signature
            bytes32 messageHash = keccak256(abi.encodePacked(utxoId, nonces[user]));
            require(verifySignature(messageHash, signature, user), "Invalid signature");
        } else {
            revert("Only owner or operator can withdraw");
        }

        // Mark UTXO as spent (burned for withdrawal)
        utxo.spent = true;
        utxo.spentInTx = withdrawalTxHash;

        // Add withdrawal tx to accumulator
        pendingUtxos.push(withdrawalTxHash);
        accumulator.add(withdrawalTxHash);

        // Increment nonce
        nonces[user]++;

        emit UtxoSpent(utxoId, withdrawalTxHash);
        emit WithdrawalRequested(withdrawalTxHash, user, utxo.token, utxo.amount, utxoId);

        return withdrawalTxHash;
    }

    // ============ AGGREGATED WITHDRAWAL ============

    /**
     * @dev Event for aggregated withdrawal
     */
    event AggregatedWithdrawalCreated(
        bytes32 indexed exitUtxoId,
        address indexed user,
        address indexed token,
        uint256 withdrawAmount,
        uint256 changeAmount,
        bytes32[] inputUtxoIds
    );

    /**
     * @dev Aggregate multiple L2-only UTXOs and create an Exit UTXO for withdrawal
     *
     * This allows users to withdraw any amount (up to their total balance) by:
     * 1. Aggregating all their L2-only UTXOs
     * 2. Creating an "Exit UTXO" for the withdrawal amount
     * 3. Creating a "Change UTXO" for remaining balance (stays on L2)
     *
     * The Exit UTXO will be registered on L1 by the operator, enabling withdrawal.
     *
     * @param user The user requesting withdrawal
     * @param token The token to withdraw
     * @param withdrawAmount Amount to withdraw to L1
     * @param signature User's signature authorizing the aggregation
     * @return exitUtxoId The UTXO ID that can be used for L1 withdrawal
     */
    function aggregateForWithdrawal(
        address user,
        address token,
        uint256 withdrawAmount,
        bytes memory signature
    ) external returns (bytes32 exitUtxoId, bytes32 changeUtxoId, uint256 changeAmount) {
        require(withdrawAmount > 0, "Invalid withdraw amount");

        // Only operator can call this (to maintain control over L1 registration)
        require(msg.sender == operator, "Only operator");

        // Verify user signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            user,
            token,
            withdrawAmount,
            "AGGREGATE_WITHDRAW",
            nonces[user]
        ));
        require(verifySignature(messageHash, signature, user), "Invalid signature");

        // Collect all unspent UTXOs for this user and token
        bytes32[] memory allUtxos = userUtxos[user];
        uint256 totalAvailable = 0;
        uint256 utxoCount = 0;

        // First pass: count eligible UTXOs and total amount
        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && utxo.token == token) {
                totalAvailable += utxo.amount;
                utxoCount++;
            }
        }

        require(totalAvailable >= withdrawAmount, "Insufficient balance");

        // Collect UTXO IDs for spending
        bytes32[] memory inputUtxoIds = new bytes32[](utxoCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && utxo.token == token) {
                inputUtxoIds[idx] = allUtxos[i];
                idx++;
            }
        }

        // Create aggregation transaction hash
        bytes32 aggregateTxHash = keccak256(abi.encodePacked(
            user,
            token,
            withdrawAmount,
            totalAvailable,
            nonces[user],
            block.timestamp,
            "AGGREGATE"
        ));

        // Mark all input UTXOs as spent
        for (uint256 i = 0; i < inputUtxoIds.length; i++) {
            utxos[inputUtxoIds[i]].spent = true;
            utxos[inputUtxoIds[i]].spentInTx = aggregateTxHash;
            emit UtxoSpent(inputUtxoIds[i], aggregateTxHash);
        }

        // Create Exit UTXO (for L1 withdrawal)
        exitUtxoId = keccak256(abi.encodePacked(
            aggregateTxHash,
            "EXIT",
            withdrawAmount,
            block.timestamp
        ));

        // Exit UTXO is created as "spent" because it's meant for L1 withdrawal
        // It should NOT be counted in getUserBalance() - user can't use it on L2
        utxos[exitUtxoId] = UTXO({
            utxoId: exitUtxoId,
            owner: user,
            token: token,
            amount: withdrawAmount,
            createdInBlock: currentBlock + 1,
            spent: true,  // Mark as spent immediately - it's for L1 exit only
            spentInTx: aggregateTxHash
        });

        userUtxos[user].push(exitUtxoId);
        pendingUtxos.push(exitUtxoId);
        accumulator.add(exitUtxoId);

        emit UtxoCreated(exitUtxoId, user, token, withdrawAmount, currentBlock + 1);
        emit UtxoSpent(exitUtxoId, aggregateTxHash);  // Emit spent event

        // Create Change UTXO if there's remaining balance
        changeAmount = totalAvailable - withdrawAmount;
        if (changeAmount > 0) {
            changeUtxoId = keccak256(abi.encodePacked(
                aggregateTxHash,
                "CHANGE",
                changeAmount,
                block.timestamp
            ));

            utxos[changeUtxoId] = UTXO({
                utxoId: changeUtxoId,
                owner: user,
                token: token,
                amount: changeAmount,
                createdInBlock: currentBlock + 1,
                spent: false,
                spentInTx: bytes32(0)
            });

            userUtxos[user].push(changeUtxoId);
            pendingUtxos.push(changeUtxoId);
            accumulator.add(changeUtxoId);

            emit UtxoCreated(changeUtxoId, user, token, changeAmount, currentBlock + 1);
        }

        // Increment nonce
        nonces[user]++;

        emit AggregatedWithdrawalCreated(
            exitUtxoId,
            user,
            token,
            withdrawAmount,
            changeAmount,
            inputUtxoIds
        );

        return (exitUtxoId, changeUtxoId, changeAmount);
    }

    // ============ BLOCK CREATION ============

    /**
     * @dev Create new block with pending UTXOs
     */
    function createBlock() external onlyOperator returns (uint256) {
        require(pendingUtxos.length > 0, "No pending UTXOs");

        currentBlock++;

        blocks[currentBlock] = Block({
            blockNumber: currentBlock,
            utxoIds: pendingUtxos,
            accumulatorValue: accumulator.getValue(),
            timestamp: block.timestamp
        });

        emit BlockCreated(currentBlock, pendingUtxos.length);

        // Clear pending
        delete pendingUtxos;

        return currentBlock;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get UTXO details
     */
    function getUtxo(bytes32 utxoId) external view returns (UTXO memory) {
        return utxos[utxoId];
    }

    /**
     * @dev Get all UTXOs for a user
     */
    function getUserUtxos(address user) external view returns (bytes32[] memory) {
        return userUtxos[user];
    }

    /**
     * @dev Get unspent UTXOs for a user
     */
    function getUnspentUtxos(address user) external view returns (bytes32[] memory) {
        bytes32[] memory allUtxos = userUtxos[user];
        uint256 count = 0;

        for (uint256 i = 0; i < allUtxos.length; i++) {
            if (!utxos[allUtxos[i]].spent) {
                count++;
            }
        }

        bytes32[] memory unspent = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allUtxos.length; i++) {
            if (!utxos[allUtxos[i]].spent) {
                unspent[j] = allUtxos[i];
                j++;
            }
        }

        return unspent;
    }

    /**
     * @dev Get user's total balance for a token
     */
    function getUserBalance(address user, address token) external view returns (uint256) {
        bytes32[] memory allUtxos = userUtxos[user];
        uint256 total = 0;

        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && utxo.token == token) {
                total += utxo.amount;
            }
        }

        return total;
    }

    /**
     * @dev Get block info
     */
    function getBlock(uint256 blockNumber) external view returns (Block memory) {
        return blocks[blockNumber];
    }

    /**
     * @dev Get current accumulator value
     */
    function getAccumulatorValue() external view returns (ECCAccumulator.Point memory) {
        return accumulator.getValue();
    }

    /**
     * @dev Get pending UTXO count
     */
    function getPendingUtxoCount() external view returns (uint256) {
        return pendingUtxos.length;
    }

    // ============ HELPER FUNCTIONS ============

    /**
     * @dev Verify signature
     */
    function verifySignature(
        bytes32 messageHash,
        bytes memory signature,
        address signer
    ) internal pure returns (bool) {
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = splitSignature(signature);
        address recoveredSigner = ecrecover(ethSignedMessageHash, v, r, s);

        return recoveredSigner == signer;
    }

    /**
     * @dev Split signature
     */
    function splitSignature(bytes memory sig)
        internal
        pure
        returns (uint8, bytes32, bytes32)
    {
        require(sig.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        return (v, r, s);
    }
}
