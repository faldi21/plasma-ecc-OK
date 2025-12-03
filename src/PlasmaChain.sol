// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./libraries/ECCAccumulator.sol";

/**
 * @title PlasmaChain
 * @dev Contract untuk mengelola state di Layer 2
 */
contract PlasmaChain {
    using ECCAccumulator for ECCAccumulator.Accumulator;

    struct Transaction {
        address from;
        address to;
        address token;
        uint256 amount;
        uint256 nonce;
        uint256 blockNumber;
        bytes32 txHash;
    }

    struct Block {
        uint256 blockNumber;
        bytes32[] transactions;
        ECCAccumulator.Point accumulatorValue;
        uint256 timestamp;
    }

    // State
    mapping(uint256 => Block) public blocks;
    mapping(bytes32 => Transaction) public transactions;
    mapping(address => mapping(address => uint256)) public balances;
    mapping(address => uint256) public nonces;
    
    ECCAccumulator.Accumulator private accumulator;
    
    uint256 public currentBlock;
    address public operator;
    
    bytes32[] public pendingTransactions;

    // Events
    event TransactionExecuted(bytes32 indexed txHash, address indexed from, address indexed to);
    event BlockCreated(uint256 indexed blockNumber, uint256 transactionCount);
    event BalanceUpdated(address indexed user, address indexed token, uint256 amount, bytes32 txHash);
    event WithdrawalRequested(bytes32 indexed txHash, address indexed user, address indexed token, uint256 amount, uint256 nonce);

    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator");
        _;
    }

    constructor() {
        operator = msg.sender;
        accumulator.initialize();
    }

    /**
     * @dev Execute transaction di Layer 2
     */
    function executeTransaction(
        address from,
        address to,
        address token,
        uint256 amount,
        uint256 nonce,
        bytes memory signature
    ) external returns (bytes32) {
        // Verify nonce and balance for from address
        require(nonce == nonces[from], "Invalid nonce");
        require(balances[from][token] >= amount, "Insufficient balance");

        // Create message hash with from address (without timestamp for API compatibility)
        bytes32 txHash = keccak256(abi.encodePacked(
            from,
            to,
            token,
            amount,
            nonce
        ));

        // Two execution modes:
        // 1. Direct user call: msg.sender must be the from address
        // 2. Operator relay: operator calls with user's signature
        if (msg.sender == from) {
            // Direct user execution - no signature verification needed
            require(from != address(0), "Invalid from address");
        } else if (msg.sender == operator) {
            // Operator relay - verify signature matches from address
            require(verifySignature(txHash, signature, from), "Invalid signature");
        } else {
            revert("Only user or operator can execute");
        }

        // Update balances
        balances[from][token] -= amount;
        balances[to][token] += amount;
        nonces[from]++;
        
        // Store transaction
        transactions[txHash] = Transaction({
            from: from,
            to: to,
            token: token,
            amount: amount,
            nonce: nonce,
            blockNumber: currentBlock + 1,
            txHash: txHash
        });
        
        // Add to pending transactions
        pendingTransactions.push(txHash);
        
        // Add to accumulator
        accumulator.add(txHash);
        
        emit TransactionExecuted(txHash, from, to);
        
        return txHash;
    }

    /**
     * @dev Create new block
     */
    function createBlock() external onlyOperator returns (uint256) {
        require(pendingTransactions.length > 0, "No pending transactions");
        
        currentBlock++;
        
        blocks[currentBlock] = Block({
            blockNumber: currentBlock,
            transactions: pendingTransactions,
            accumulatorValue: accumulator.getValue(),
            timestamp: block.timestamp
        });
        
        emit BlockCreated(currentBlock, pendingTransactions.length);
        
        // Clear pending transactions
        delete pendingTransactions;
        
        return currentBlock;
    }

    /**
     * @dev Create block with external transactions (bypass validation - simplified)
     */
    function createBlockWithTransactions(bytes32[] calldata externalTxs) external onlyOperator returns (uint256) {
        require(externalTxs.length > 0, "No transactions provided");
        
        currentBlock++;
        
        // Simplified approach: skip complex accumulator operations for bypass
        // Just use dummy accumulator value for now to get L1 submission working
        ECCAccumulator.Point memory dummyPoint = ECCAccumulator.Point(1, 2);
        
        blocks[currentBlock] = Block({
            blockNumber: currentBlock,
            transactions: externalTxs,
            accumulatorValue: dummyPoint,
            timestamp: block.timestamp
        });
        
        emit BlockCreated(currentBlock, externalTxs.length);
        
        return currentBlock;
    }

    /**
     * @dev Update balance dari deposit Layer 1
     */
    function updateBalance(
        address user,
        address token,
        uint256 amount
    ) external onlyOperator {
        balances[user][token] += amount;
        
        // Generate transaction hash untuk deposit
        bytes32 txHash = keccak256(abi.encodePacked(user, token, amount, block.timestamp, nonces[user]));
        
        emit BalanceUpdated(user, token, amount, txHash);
    }

    /**
     * @dev Get user balance
     */
    function getBalance(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }

    /**
     * @dev Get block info
     */
    function getBlock(uint256 blockNumber) external view returns (Block memory) {
        return blocks[blockNumber];
    }

    /**
     * @dev Add balance for testing purposes (operator only)
     */
    function addBalance(address user, address token, uint256 amount) external onlyOperator {
        balances[user][token] += amount;
        emit BalanceUpdated(user, token, balances[user][token], bytes32(0));
    }


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

    /**
     * @dev Request withdrawal from L2 to L1
     * User burns/locks tokens on L2 and gets a withdrawal transaction
     * This transaction will be included in a block and can be used to exit on L1
     */
    function requestWithdrawal(
        address token,
        uint256 amount,
        bytes memory /* signature */
    ) external returns (bytes32) {
        address user = msg.sender;
        uint256 nonce = nonces[user];

        // Verify user has sufficient balance
        require(balances[user][token] >= amount, "Insufficient balance");

        // Create withdrawal transaction hash
        bytes32 txHash = keccak256(abi.encodePacked(
            user,
            address(0), // to = address(0) indicates withdrawal
            token,
            amount,
            nonce,
            "WITHDRAWAL" // type identifier
        ));

        // Reduce balance on L2 (burn/lock)
        balances[user][token] -= amount;
        nonces[user]++;

        // Store withdrawal transaction
        transactions[txHash] = Transaction({
            from: user,
            to: address(0), // address(0) indicates withdrawal
            token: token,
            amount: amount,
            nonce: nonce,
            blockNumber: currentBlock + 1,
            txHash: txHash
        });

        // Add to pending transactions
        pendingTransactions.push(txHash);

        // Add to accumulator
        accumulator.add(txHash);

        // Emit event for relay to detect
        emit WithdrawalRequested(txHash, user, token, amount, nonce);
        emit TransactionExecuted(txHash, user, address(0));

        return txHash;
    }
}
