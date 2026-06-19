// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./libraries/ECCAccumulator.sol";

/**
 * @title RootChainUTXO
 * @dev Contract utama di Layer 1 untuk mengelola Plasma chain dengan UTXO model
 *
 * UTXO Model:
 * - Setiap deposit membuat UTXO unik
 * - Transfer di L2 consume UTXO lama, create UTXO baru
 * - Hanya unspent UTXO yang bisa di-withdraw
 * - Mencegah double-spending
 */
contract RootChainUTXO is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using ECCAccumulator for ECCAccumulator.Accumulator;

    // ============ STRUCTS ============

    struct PlasmaBlock {
        uint256 blockNumber;
        ECCAccumulator.Point accumulatorValue;
        uint256 timestamp;
        address operator;
        uint256 transactionCount;
    }

    struct UTXO {
        bytes32 utxoId;         // Unique identifier
        address owner;          // Current owner
        address token;          // Token address (address(0) for ETH)
        uint256 amount;         // Amount in this UTXO
        uint256 createdInBlock; // Block where UTXO was created
        bool spent;             // Whether UTXO has been spent on L2
        bool exited;            // Whether UTXO has been exited (withdrawn)
    }

    struct Exit {
        address owner;
        bytes32 utxoId;
        address token;
        uint256 amount;
        uint256 blockNumber;
        uint256 exitTime;
        bool processed;
        bool challenged;
    }

    // ============ STATE VARIABLES ============

    // Block tracking
    mapping(uint256 => PlasmaBlock) public plasmaBlocks;
    uint256 public currentPlasmaBlock;

    // UTXO tracking
    mapping(bytes32 => UTXO) public utxos;
    mapping(address => bytes32[]) public userUtxos;
    uint256 public depositNonce;

    // Exit tracking
    mapping(bytes32 => Exit) public exits;
    mapping(bytes32 => bool) public exitedUtxos;

    // Accumulator
    ECCAccumulator.Accumulator private accumulator;

    // Config
    uint256 public constant EXIT_PERIOD = 7 minutes;      // For testing (production: 7 days)
    uint256 public constant CHALLENGE_PERIOD = 4 minutes; // For testing (production: 3 days)

    address public plasmaOperator;
    bool public isPlasmaActive;

    // ============ EVENTS ============

    event DepositCreated(
        bytes32 indexed utxoId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 depositNonce
    );

    event BlockSubmitted(
        uint256 indexed blockNumber,
        ECCAccumulator.Point accumulatorValue
    );

    event UtxoSpentSynced(
        bytes32 indexed utxoId,
        bytes32 indexed spendingTxHash
    );

    event ExitStarted(
        bytes32 indexed exitId,
        address indexed user,
        uint256 amount,
        bytes32 indexed utxoId
    );

    event ExitFinalized(
        bytes32 indexed exitId,
        address indexed user,
        uint256 amount
    );

    event ExitChallenged(
        bytes32 indexed exitId,
        address indexed challenger,
        bytes32 spendingTxHash
    );

    event ExitUtxoRegistered(
        bytes32 indexed exitUtxoId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 blockNumber
    );

    // ============ MODIFIERS ============

    modifier onlyOperator() {
        require(msg.sender == plasmaOperator, "Only operator");
        _;
    }

    modifier plasmaActive() {
        require(isPlasmaActive, "Plasma chain not active");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(address _operator) Ownable(msg.sender) {
        plasmaOperator = _operator;
        isPlasmaActive = true;
        accumulator.initialize();
    }

    // ============ DEPOSIT FUNCTIONS ============

    /**
     * @dev Deposit ERC20 token ke Plasma chain
     * Creates a new UTXO for the deposited amount
     */
    function deposit(address token, uint256 amount) external nonReentrant plasmaActive returns (bytes32) {
        require(amount > 0, "Amount must be greater than 0");
        require(token != address(0), "Use depositETH for ETH");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        bytes32 utxoId = _createDepositUtxo(msg.sender, token, amount);

        return utxoId;
    }

    /**
     * @dev Deposit ETH ke Plasma chain
     * Creates a new UTXO for the deposited ETH
     */
    function depositETH() external payable nonReentrant plasmaActive returns (bytes32) {
        require(msg.value > 0, "Must send ETH");

        bytes32 utxoId = _createDepositUtxo(msg.sender, address(0), msg.value);

        return utxoId;
    }

    /**
     * @dev Internal function to create a deposit UTXO
     */
    function _createDepositUtxo(
        address user,
        address token,
        uint256 amount
    ) internal returns (bytes32) {
        depositNonce++;

        // Generate unique UTXO ID
        bytes32 utxoId = keccak256(abi.encodePacked(
            user,
            token,
            amount,
            depositNonce,
            block.timestamp,
            block.number
        ));

        // Create UTXO record
        utxos[utxoId] = UTXO({
            utxoId: utxoId,
            owner: user,
            token: token,
            amount: amount,
            createdInBlock: 0,  // Will be set when included in L2 block
            spent: false,
            exited: false
        });

        // Add to user's UTXO list
        userUtxos[user].push(utxoId);

        emit DepositCreated(utxoId, user, token, amount, depositNonce);

        return utxoId;
    }

    // ============ BLOCK SUBMISSION ============

    /**
     * @dev Submit block dari Plasma operator
     * Block berisi accumulator value dari semua transaksi termasuk UTXO
     */
    function submitBlock(
        ECCAccumulator.Point memory accumulatorValue,
        uint256 transactionCount
    ) external onlyOperator {
        currentPlasmaBlock++;

        accumulator.value = accumulatorValue;

        plasmaBlocks[currentPlasmaBlock] = PlasmaBlock({
            blockNumber: currentPlasmaBlock,
            accumulatorValue: accumulatorValue,
            timestamp: block.timestamp,
            operator: msg.sender,
            transactionCount: transactionCount
        });

        emit BlockSubmitted(currentPlasmaBlock, accumulatorValue);
    }

    /**
     * @dev Operator sync UTXO spent status from L2
     * Called when a UTXO is spent on L2 (transfer or L2 withdrawal request)
     */
    function syncUtxoSpent(
        bytes32 utxoId,
        bytes32 spendingTxHash
    ) external onlyOperator {
        UTXO storage utxo = utxos[utxoId];
        require(utxo.utxoId != bytes32(0), "UTXO does not exist");
        require(!utxo.spent, "UTXO already marked as spent");

        utxo.spent = true;

        emit UtxoSpentSynced(utxoId, spendingTxHash);
    }

    /**
     * @dev Batch sync multiple UTXOs as spent
     * More gas efficient for multiple updates
     */
    function batchSyncUtxoSpent(
        bytes32[] calldata utxoIds,
        bytes32[] calldata spendingTxHashes
    ) external onlyOperator {
        require(utxoIds.length == spendingTxHashes.length, "Array length mismatch");

        for (uint256 i = 0; i < utxoIds.length; i++) {
            UTXO storage utxo = utxos[utxoIds[i]];
            if (utxo.utxoId != bytes32(0) && !utxo.spent) {
                utxo.spent = true;
                emit UtxoSpentSynced(utxoIds[i], spendingTxHashes[i]);
            }
        }
    }

    /**
     * @dev Update UTXO block number when included in L2 block
     */
    function updateUtxoBlock(
        bytes32 utxoId,
        uint256 blockNumber
    ) external onlyOperator {
        UTXO storage utxo = utxos[utxoId];
        require(utxo.utxoId != bytes32(0), "UTXO does not exist");
        require(utxo.createdInBlock == 0, "Block already set");

        utxo.createdInBlock = blockNumber;
    }

    /**
     * @dev Register an Exit UTXO created from L2 aggregation
     * This allows users to withdraw arbitrary amounts (up to their L2 balance)
     * by aggregating multiple L2 UTXOs into a single Exit UTXO.
     *
     * Called by operator after aggregateForWithdrawal on L2.
     * The Exit UTXO is created on L1 so user can start exit process.
     *
     * @param exitUtxoId The UTXO ID generated on L2 (from aggregateForWithdrawal)
     * @param user The owner of the Exit UTXO
     * @param token The token address
     * @param amount The amount to withdraw
     * @param blockNumber The L2 block where Exit UTXO was created
     */
    function registerExitUtxo(
        bytes32 exitUtxoId,
        address user,
        address token,
        uint256 amount,
        uint256 blockNumber
    ) external onlyOperator {
        require(utxos[exitUtxoId].utxoId == bytes32(0), "Exit UTXO already registered");
        require(user != address(0), "Invalid user address");
        require(amount > 0, "Invalid amount");
        require(blockNumber > 0 && blockNumber <= currentPlasmaBlock, "Invalid block number");

        // Create UTXO record for the Exit UTXO
        utxos[exitUtxoId] = UTXO({
            utxoId: exitUtxoId,
            owner: user,
            token: token,
            amount: amount,
            createdInBlock: blockNumber,
            spent: false,
            exited: false
        });

        // Add to user's UTXO list
        userUtxos[user].push(exitUtxoId);

        emit ExitUtxoRegistered(exitUtxoId, user, token, amount, blockNumber);
    }

    // ============ EXIT FUNCTIONS ============

    /**
     * @dev Start exit process for a UTXO
     * User must prove UTXO inclusion in a block using witness
     */
    function startExit(
        bytes32 utxoId,
        uint256 blockNumber,
        ECCAccumulator.Point memory witness
    ) external nonReentrant {
        UTXO storage utxo = utxos[utxoId];

        // Validate UTXO exists and ownership
        require(utxo.utxoId != bytes32(0), "UTXO does not exist");
        require(utxo.owner == msg.sender, "Not UTXO owner");
        require(!utxo.spent, "UTXO already spent on L2");
        require(!utxo.exited, "UTXO already exited");
        require(!exitedUtxos[utxoId], "UTXO already has pending exit");
        require(blockNumber <= currentPlasmaBlock, "Invalid block number");

        // Get block accumulator and verify inclusion
        ECCAccumulator.Point memory blockAccumulator = plasmaBlocks[blockNumber].accumulatorValue;
        require(
            ECCAccumulator.verifyWithAccumulator(utxoId, witness, blockAccumulator),
            "Invalid UTXO proof"
        );

        // Create exit
        bytes32 exitId = keccak256(abi.encodePacked(
            msg.sender,
            utxoId,
            blockNumber,
            block.timestamp
        ));

        require(exits[exitId].owner == address(0), "Exit already exists");

        exits[exitId] = Exit({
            owner: msg.sender,
            utxoId: utxoId,
            token: utxo.token,
            amount: utxo.amount,
            blockNumber: blockNumber,
            exitTime: block.timestamp + EXIT_PERIOD,
            processed: false,
            challenged: false
        });

        exitedUtxos[utxoId] = true;

        emit ExitStarted(exitId, msg.sender, utxo.amount, utxoId);
    }

    /**
     * @dev Finalize exit after challenge period
     * Transfers tokens/ETH back to user
     */
    function finalizeExit(bytes32 exitId) external nonReentrant {
        Exit storage exit = exits[exitId];

        require(exit.owner == msg.sender, "Not exit owner");
        require(!exit.processed, "Exit already processed");
        require(!exit.challenged, "Exit was challenged");
        require(block.timestamp >= exit.exitTime, "Exit period not ended");

        exit.processed = true;

        // Mark UTXO as exited
        utxos[exit.utxoId].exited = true;

        // Transfer funds
        if (exit.token == address(0)) {
            // Withdraw ETH
            (bool success, ) = payable(exit.owner).call{value: exit.amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Withdraw ERC20
            IERC20(exit.token).safeTransfer(exit.owner, exit.amount);
        }

        emit ExitFinalized(exitId, exit.owner, exit.amount);
    }

    /**
     * @dev Challenge exit with proof that UTXO was spent on L2
     * Anyone can challenge by providing:
     * 1. The spending transaction hash
     * 2. Block number where spending occurred
     * 3. Witness proving inclusion in that block
     */
    function challengeExitWithSpendProof(
        bytes32 exitId,
        bytes32 spendingTxHash,
        uint256 spendBlockNumber,
        ECCAccumulator.Point memory spendWitness
    ) external {
        Exit storage exit = exits[exitId];

        require(!exit.processed, "Exit already processed");
        require(!exit.challenged, "Exit already challenged");
        require(block.timestamp < exit.exitTime, "Challenge period ended");

        // Spending must be after the UTXO was created
        require(spendBlockNumber > exit.blockNumber, "Spend must be after creation");
        require(spendBlockNumber <= currentPlasmaBlock, "Invalid spend block");

        // Verify the spending transaction was included in the specified block
        ECCAccumulator.Point memory blockAccumulator = plasmaBlocks[spendBlockNumber].accumulatorValue;
        require(
            ECCAccumulator.verifyWithAccumulator(spendingTxHash, spendWitness, blockAccumulator),
            "Invalid spend proof"
        );

        // Mark exit as challenged
        exit.challenged = true;
        exit.processed = true;

        // Mark UTXO as spent to prevent future exit attempts
        utxos[exit.utxoId].spent = true;

        emit ExitChallenged(exitId, msg.sender, spendingTxHash);
    }

    /**
     * @dev Simple challenge if operator already synced UTXO as spent
     */
    function challengeExitSimple(bytes32 exitId) external {
        Exit storage exit = exits[exitId];
        UTXO storage utxo = utxos[exit.utxoId];

        require(!exit.processed, "Exit already processed");
        require(!exit.challenged, "Exit already challenged");
        require(block.timestamp < exit.exitTime, "Challenge period ended");

        // Check if UTXO is already marked as spent by operator
        require(utxo.spent, "UTXO not marked as spent");

        // Mark exit as challenged
        exit.challenged = true;
        exit.processed = true;

        emit ExitChallenged(exitId, msg.sender, bytes32(0));
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

        // Count unspent
        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && !utxo.exited) {
                count++;
            }
        }

        // Create result array
        bytes32[] memory unspent = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && !utxo.exited) {
                unspent[j] = allUtxos[i];
                j++;
            }
        }

        return unspent;
    }

    /**
     * @dev Get user's total balance from unspent UTXOs
     */
    function getUserBalance(address user, address token) external view returns (uint256) {
        bytes32[] memory allUtxos = userUtxos[user];
        uint256 total = 0;

        for (uint256 i = 0; i < allUtxos.length; i++) {
            UTXO storage utxo = utxos[allUtxos[i]];
            if (!utxo.spent && !utxo.exited && utxo.token == token) {
                total += utxo.amount;
            }
        }

        return total;
    }

    /**
     * @dev Get current accumulator value
     */
    function getAccumulatorValue() external view returns (ECCAccumulator.Point memory) {
        return accumulator.getValue();
    }

    /**
     * @dev Get exit details
     */
    function getExit(bytes32 exitId) external view returns (Exit memory) {
        return exits[exitId];
    }

    /**
     * @dev Check if UTXO can be exited
     */
    function canExit(bytes32 utxoId) external view returns (bool, string memory) {
        UTXO storage utxo = utxos[utxoId];

        if (utxo.utxoId == bytes32(0)) {
            return (false, "UTXO does not exist");
        }
        if (utxo.spent) {
            return (false, "UTXO already spent on L2");
        }
        if (utxo.exited) {
            return (false, "UTXO already exited");
        }
        if (exitedUtxos[utxoId]) {
            return (false, "UTXO has pending exit");
        }

        return (true, "Can exit");
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Emergency pause Plasma chain
     */
    function pausePlasma() external onlyOwner {
        isPlasmaActive = false;
    }

    /**
     * @dev Resume Plasma chain
     */
    function resumePlasma() external onlyOwner {
        isPlasmaActive = true;
    }

    /**
     * @dev Update operator
     */
    function updateOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Invalid operator");
        plasmaOperator = newOperator;
    }
}
