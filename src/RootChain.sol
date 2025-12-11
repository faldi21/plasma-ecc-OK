// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./libraries/ECCAccumulator.sol";

/**
 * @title RootChain
 * @dev Contract utama di Layer 1 untuk mengelola Plasma chain
 */
contract RootChain is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using ECCAccumulator for ECCAccumulator.Accumulator;

    // Structs
    struct PlasmaBlock {
        uint256 blockNumber;
        ECCAccumulator.Point accumulatorValue;
        uint256 timestamp;
        address operator;
        uint256 transactionCount;
    }

    struct Exit {
        address owner;
        address token;
        uint256 amount;
        uint256 blockNumber;
        bytes32 txHash;
        uint256 exitTime;
        bool processed;
    }

    // State variables
    mapping(uint256 => PlasmaBlock) public plasmaBlocks;
    mapping(bytes32 => Exit) public exits;
    mapping(address => mapping(address => uint256)) public balances;
    
    ECCAccumulator.Accumulator private accumulator;
    
    uint256 public currentPlasmaBlock;
    uint256 public constant EXIT_PERIOD = 7 days;
    uint256 public constant CHALLENGE_PERIOD = 3 days;
    
    address public plasmaOperator;
    bool public isPlasmaActive;

    // Events
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event BlockSubmitted(uint256 indexed blockNumber, ECCAccumulator.Point accumulatorValue);
    event ExitStarted(bytes32 indexed exitId, address indexed user, uint256 amount);
    event ExitFinalized(bytes32 indexed exitId, address indexed user, uint256 amount);
    event ExitChallenged(bytes32 indexed exitId, address indexed challenger);

    modifier onlyOperator() {
        require(msg.sender == plasmaOperator, "Only operator");
        _;
    }

    modifier plasmaActive() {
        require(isPlasmaActive, "Plasma chain not active");
        _;
    }

    constructor(address _operator) Ownable(msg.sender) {
        plasmaOperator = _operator;
        isPlasmaActive = true;
        accumulator.initialize();
    }

    /**
     * @dev Deposit token ke Plasma chain
     */
    function deposit(address token, uint256 amount) external nonReentrant plasmaActive {
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        
        emit Deposit(msg.sender, token, amount);
    }

    /**
     * @dev Deposit ETH ke Plasma chain
     */
    function depositETH() external payable nonReentrant plasmaActive {
        require(msg.value > 0, "Must send ETH");
        
        balances[msg.sender][address(0)] += msg.value;
        
        emit Deposit(msg.sender, address(0), msg.value);
    }

    /**
     * @dev Submit block dari Plasma operator
     */
    function submitBlock(
        ECCAccumulator.Point memory accumulatorValue,
        uint256 transactionCount,
        bytes32[] memory transactionHashes
    ) external onlyOperator {
        currentPlasmaBlock++;
        
        // Gunakan accumulator value yang dikirim oleh L2 operator (tidak perlu add lagi)
        // Karena L2 sudah menghitung accumulator dengan benar
        
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
     * @dev Mulai proses exit dari Plasma chain
     */
    function startExit(
        address token,
        uint256 amount,
        uint256 blockNumber,
        bytes32 txHash,
        ECCAccumulator.Point memory witness
    ) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(blockNumber <= currentPlasmaBlock, "Invalid block");
        
        // Verifikasi transaksi menggunakan accumulator
        require(
            accumulator.verify(txHash, witness),
            "Invalid transaction proof"
        );
        
        bytes32 exitId = keccak256(abi.encodePacked(msg.sender, token, blockNumber, txHash));
        require(!exits[exitId].processed, "Exit already processed");
        
        exits[exitId] = Exit({
            owner: msg.sender,
            token: token,
            amount: amount,
            blockNumber: blockNumber,
            txHash: txHash,
            exitTime: block.timestamp + EXIT_PERIOD,
            processed: false
        });
        
        emit ExitStarted(exitId, msg.sender, amount);
    }

    /**
     * @dev Finalisasi exit setelah challenge period
     */
    function finalizeExit(bytes32 exitId) external nonReentrant {
        Exit storage exit = exits[exitId];
        require(exit.owner == msg.sender, "Not exit owner");
        require(!exit.processed, "Already processed");
        require(block.timestamp >= exit.exitTime, "Exit period not ended");
        
        exit.processed = true;
        
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
     * @dev Challenge exit yang tidak valid
     */
    function challengeExit(
        bytes32 exitId,
        bytes memory proof
    ) external {
        Exit storage exit = exits[exitId];
        require(!exit.processed, "Exit already processed");
        require(block.timestamp < exit.exitTime - CHALLENGE_PERIOD, "Challenge period ended");
        
        // TODO: Implement challenge verification logic
        // Untuk saat ini, kita asumsikan challenge valid
        
        exit.processed = true;
        emit ExitChallenged(exitId, msg.sender);
    }

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
        plasmaOperator = newOperator;
    }

    /**
     * @dev Get current accumulator value
     */
    function getAccumulatorValue() external view returns (ECCAccumulator.Point memory) {
        return accumulator.getValue();
    }
}
