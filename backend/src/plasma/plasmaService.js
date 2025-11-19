const { ethers } = require('ethers');
const AccumulatorService = require('../accumulator/accumulatorService');

class PlasmaService {
    constructor() {
        // Setup providers
        this.l1Provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
        this.l2Provider = new ethers.JsonRpcProvider(process.env.L2_RPC_URL || 'http://localhost:8545');
        console.log('L2 Provider URL:', process.env.L2_RPC_URL || 'http://localhost:8545');
        
        // Setup wallets L1 - use OPERATOR_PRIVATE_KEY as that's the operator the L1 contract expects
        this.operatorWallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, this.l1Provider);
        // Setup wallets L2
        this.l2Operator = new ethers.Wallet(process.env.L2_OPERATOR_PRIVATE_KEY, this.l2Provider);
        
        // Load contracts
        this.loadContracts();
        
        // Initialize accumulator
        this.accumulator = new AccumulatorService();
        
        // Transaction pool
        this.pendingTransactions = [];
        
        // Block creation mutex to prevent race conditions
        this.isCreatingBlock = false;
        
        // Start L2 event monitoring
        this.startL2EventMonitoring();
        
        // Start block production
        this.startBlockProduction();
    }

    async loadContracts() {
        // Load contract ABIs and addresses
        const rootChainABI = require('../../abi/RootChain.json');
        const plasmaChainABI = require('../../abi/PlasmaChain.json');
        
        // L1 contracts
        this.rootChain = new ethers.Contract(
            process.env.ROOT_CHAIN_ADDRESS,
            rootChainABI.abi,
            this.operatorWallet
        );
        
        // L2 contracts - use L2 operator
        this.plasmaChain = new ethers.Contract(
            process.env.L2_PLASMA_CHAIN_ADDRESS,
            plasmaChainABI.abi,
            this.l2Operator
        );
    }

    async processDeposit(userAddress, tokenAddress, amount) {
        try {
            // Monitor deposit event on L1
            const filter = this.rootChain.filters.Deposit(userAddress, tokenAddress);
            const events = await this.rootChain.queryFilter(filter);
            
            if (events.length > 0) {
                // Update balance on L2
                const tx = await this.plasmaChain.updateBalance(
                    userAddress,
                    tokenAddress,
                    amount
                );
                await tx.wait();
                
                return {
                    success: true,
                    txHash: tx.hash,
                    userAddress,
                    tokenAddress,
                    amount
                };
            }
            
            throw new Error('Deposit not found on L1');
        } catch (error) {
            console.error('Process deposit error:', error);
            throw error;
        }
    }

    async processTransfer(from, to, tokenAddress, amount, signature, nonce, timestamp) {
        try {
            console.log('Processing transfer:', { from, to, tokenAddress, amount, nonce, timestamp });
            
            // Verify nonce matches
            const currentNonce = await this.plasmaChain.nonces(from);
            console.log('Current nonce for', from, ':', currentNonce.toString(), 'Provided nonce:', nonce);
            
            if (currentNonce.toString() !== nonce) {
                throw new Error(`Nonce mismatch. Current: ${currentNonce}, Provided: ${nonce}`);
            }
            
            // Execute transaction on L2 - the operator acts as relayer for user's signed transaction
            const tx = await this.plasmaChain.executeTransaction(
                from,
                to,
                tokenAddress,
                ethers.parseEther(amount.toString()),
                nonce,
                signature
            );
            const receipt = await tx.wait();
            
            console.log('Transfer transaction executed:', receipt.hash);
            
            // Get transaction hash from event
            let txHash;
            const event = receipt.logs.find(log => {
                try {
                    const parsed = this.plasmaChain.interface.parseLog(log);
                    if (parsed.name === 'TransactionExecuted') {
                        txHash = parsed.args.txHash;
                        return true;
                    }
                } catch { return false; }
            });
            
            if (!txHash) {
                throw new Error('Transaction hash not found in events');
            }
            
            console.log('Transaction hash from event:', txHash);
            
            // Add to pending transactions
            this.pendingTransactions.push({
                txHash,
                from,
                to,
                tokenAddress,
                amount,
                timestamp: Date.now(),
                l2TxHash: receipt.hash
            });
            console.log(`🔍 [DEBUG] Transaction added to pending pool. Total pending: ${this.pendingTransactions.length}`);
        console.log(`🔍 [DEBUG] Pending transactions:`, this.pendingTransactions);
            // Add to accumulator
            await this.accumulator.add(txHash);
            
            console.log(`Transaction added to pending pool. Total pending: ${this.pendingTransactions.length}`);
            
            return {
                success: true,
                txHash,
                l2TxHash: receipt.hash,
                from,
                to,
                amount
            };
        } catch (error) {
            console.error('Process transfer error:', error.message);
            if (error.data) {
                console.error('Error data:', error.data);
            }
            throw error;
        }
    }

    async startExit(userAddress, tokenAddress, amount, blockNumber, txHash) {
        try {
            // Generate witness for accumulator proof
            const witness = await this.accumulator.generateWitness(txHash);
            
            // Start exit on L1
            const tx = await this.rootChain.startExit(
                tokenAddress,
                amount,
                blockNumber,
                txHash,
                witness
            );
            const receipt = await tx.wait();
            
            return {
                success: true,
                exitTxHash: tx.hash,
                exitId: receipt.events[0].args.exitId
            };
        } catch (error) {
            console.error('Start exit error:', error);
            throw error;
        }
    }

    async createBlock(force = false) {
        // Prevent concurrent block creation
        if (this.isCreatingBlock) {
            console.log('⏸️ Block creation already in progress, skipping...');
            return null;
        }

        // Get timestamp when block creation started for timeout detection
        const blockCreationStartTime = Date.now();

        try {
            // Set mutex
            this.isCreatingBlock = true;

            if (!force && this.pendingTransactions.length === 0) {
                console.log('No pending transactions to include in block');
                this.isCreatingBlock = false; // Release mutex early
                return null;
            }

            console.log(`Creating block with ${this.pendingTransactions.length} pending transactions (started at ${new Date().toISOString()})`);

            // Limit transactions per block to avoid gas overflow
            const MAX_TX_PER_BLOCK = 100;
            const transactionsToInclude = this.pendingTransactions.slice(0, MAX_TX_PER_BLOCK);
            const remainingTransactions = this.pendingTransactions.slice(MAX_TX_PER_BLOCK);

            if (transactionsToInclude.length < this.pendingTransactions.length) {
                console.log(`⚠️  Limiting block to ${MAX_TX_PER_BLOCK} transactions (${remainingTransactions.length} will remain pending)`);
            }

            // Extract transaction hashes from pending transactions
            const txHashes = transactionsToInclude.map(tx => tx.txHash);

            // Double check we have transactions before calling contract
            if (txHashes.length === 0) {
                console.log('No transaction hashes available');
                this.isCreatingBlock = false; // Release mutex early
                return null;
            }
            
            // Always use bypass method since we manage transactions in backend
            console.log('🔄 Using bypass method: createBlockWithTransactions');
            
            // Predict resulting block number without mutating state
            let predictedBlockNumber;
            try {
                predictedBlockNumber = await this.plasmaChain.createBlockWithTransactions.staticCall(txHashes);
            } catch (staticCallError) {
                console.warn('Warning: staticCall for createBlockWithTransactions failed:', staticCallError?.message || staticCallError);
            }

            // Use bypass function
            const tx = await this.plasmaChain.createBlockWithTransactions(txHashes);
            const receipt = await tx.wait();

            // Get block number from event if available, fall back to contract state otherwise
            let blockNumber;
            try {
                const eventLog = receipt.logs.find(log => {
                    try {
                        const parsed = this.plasmaChain.interface.parseLog(log);
                        return parsed.name === 'BlockCreated';
                    } catch {
                        return false;
                    }
                });

                if (eventLog) {
                    const parsedEvent = this.plasmaChain.interface.parseLog(eventLog);
                    blockNumber = parsedEvent.args.blockNumber;
                }
            } catch (parseError) {
                console.warn('Warning: failed to parse BlockCreated event:', parseError?.message || parseError);
            }

            if (blockNumber === undefined) {
                if (predictedBlockNumber !== undefined) {
                    blockNumber = predictedBlockNumber;
                    console.warn('BlockCreated event not found – using staticCall prediction for block number');
                } else {
                    console.warn('BlockCreated event not found and staticCall unavailable – falling back to currentBlock()');
                    blockNumber = await this.plasmaChain.currentBlock();
                }
            }

            console.log(`L2 block ${blockNumber} created successfully`);

            // Get block info from L2
            const blockInfo = await this.plasmaChain.getBlock(blockNumber);
            
            // Submit to L1 with real ECC accumulator
            const transactionHashes = transactionsToInclude.map(tx => tx.txHash);
            
            // Get real ECC accumulator value
            const accumulatorValue = await this.accumulator.getValue();
            console.log('Submitting block to L1...', {
                blockNumber: blockNumber.toString(),
                accumulatorValue: accumulatorValue,
                transactionCount: transactionHashes.length,
                transactions: transactionHashes.slice(0, 3) // Show first 3 for logging
            });
            
            // Convert ECC point to format expected by L1 contract
            const accumulatorArray = [
                accumulatorValue.x,
                accumulatorValue.y
            ];
            
            let submitTx = null;
            try {
                // Estimate gas first to catch errors early
                let gasEstimate;
                try {
                    gasEstimate = await this.rootChain.submitBlock.estimateGas(
                        accumulatorArray,
                        transactionHashes.length,
                        transactionHashes
                    );
                    console.log(`  Gas estimate: ${gasEstimate.toString()}`);
                } catch (estimateError) {
                    console.log(`  ⚠️ Gas estimation failed: ${estimateError.message.substring(0, 100)}...`);
                    // Continue with manual gas limit
                    gasEstimate = 5000000n; // 5M gas as fallback
                }

                // Submit with explicit gas limit
                submitTx = await this.rootChain.submitBlock(
                    accumulatorArray,
                    transactionHashes.length,
                    transactionHashes,
                    {
                        gasLimit: gasEstimate * 12n / 10n // Add 20% buffer
                    }
                );
                const submitReceipt = await submitTx.wait();

                console.log(`✅ Block submitted to L1: ${submitTx.hash} (gas used: ${submitReceipt.gasUsed.toString()})`);
            } catch (error) {
                if (error.message.includes('OVERFLOW') || error.message.includes('CALL_EXCEPTION')) {
                    console.log(`⚠️  L1 submission skipped due to error: ${error.message.substring(0, 100)}...`);
                    console.log(`   Block would be submitted with ${transactionHashes.length} transactions`);
                    console.log(`   L2 block ${blockNumber} created successfully, but L1 submission failed (this is OK for testing)`);
                } else {
                    console.error(`  ❌ L1 submission error:`, error.message);
                    // Don't throw - L2 block is already created
                }
            }
            
            // Clear only the processed transactions, keep remaining ones
            this.pendingTransactions = remainingTransactions;

            const blockCreationDuration = ((Date.now() - blockCreationStartTime) / 1000).toFixed(2);
            console.log(`✅ Block creation completed in ${blockCreationDuration}s (ended at ${new Date().toISOString()})`);
            console.log(`📊 Block included ${transactionHashes.length} transactions, ${this.pendingTransactions.length} still pending`);

            return {
                blockNumber: blockNumber.toString(),
                transactionCount: transactionHashes.length,
                remainingPending: this.pendingTransactions.length,
                l1TxHash: submitTx ? submitTx.hash : null,
                l2TxHash: tx.hash
            };
        } catch (error) {
            const blockCreationDuration = ((Date.now() - blockCreationStartTime) / 1000).toFixed(2);
            console.error(`❌ Create block error after ${blockCreationDuration}s:`, error.message);
            if (error.data) {
                console.error('Error data:', error.data);
            }
            throw error;
        } finally {
            // Always release mutex
            this.isCreatingBlock = false;
            console.log(`🔓 Mutex released at ${new Date().toISOString()}`);
        }
    }

    async startL2EventMonitoring() {
        console.log('🔍 Starting L2 event monitoring for all transactions...');
        
        try {
            // Listen to TransactionExecuted events (from transfers)
            this.plasmaChain.on('TransactionExecuted', async (txHash, from, to, event) => {
                try {
                    if (txHash && from && to) {
                        console.log(`🔄 [L2 Transfer] Detected: ${from} → ${to}, hash: ${txHash}`);
                        await this.addTransactionToPending(txHash, from, to, 'transfer', event);
                    } else {
                        console.log('⚠️ [L2 Transfer] Skipped event with null/undefined values:', { txHash, from, to });
                    }
                } catch (error) {
                    console.error('Error processing TransactionExecuted event:', error.message);
                }
            });

            // Listen to BalanceUpdated events (from deposits via enhanced-relay)  
            this.plasmaChain.on('BalanceUpdated', async (user, token, amount, txHash, event) => {
                try {
                    if (txHash && user && token && amount) {
                        console.log(`💰 [L2 Deposit] Detected: ${user}, token: ${token}, amount: ${amount}, hash: ${txHash}`);
                        await this.addTransactionToPending(txHash, 'L1_DEPOSIT', user, 'deposit', event);
                    } else {
                        console.log('⚠️ [L2 Deposit] Skipped event with null/undefined values:', { user, token, amount, txHash });
                    }
                } catch (error) {
                    console.error('Error processing BalanceUpdated event:', error.message);
                }
            });

            console.log('✅ L2 event listeners set up');
        } catch (error) {
            console.error('Error setting up L2 event monitoring:', error.message);
        }
    }

    async detectNewL2Transactions() {
        try {
            // Get recent blocks from L2 to detect new transactions
            const currentL2Block = await this.l2Provider.getBlockNumber();
            const lastCheckedBlock = this.lastCheckedL2Block || currentL2Block - 10;
            
            if (currentL2Block > lastCheckedBlock) {
                // Check for updateBalance transactions (deposits)
                const filter = this.plasmaChain.filters.TransactionExecuted();
                const logs = await this.plasmaChain.queryFilter(filter, lastCheckedBlock + 1, currentL2Block);
                
                for (const log of logs) {
                    const { txHash, from, to } = log.args;
                    if (!this.processedTxHashes.has(txHash)) {
                        console.log(`🔄 [L2 Detected] Transaction: ${txHash}`);
                        await this.addTransactionToPending(txHash, from, to, 'detected', log);
                        this.processedTxHashes.add(txHash);
                    }
                }
                
                this.lastCheckedL2Block = currentL2Block;
            }
        } catch (error) {
            console.error('Error detecting L2 transactions:', error?.message || error);
        }
    }

    async addTransactionToPending(txHash, from, to, type, event) {
        try {
            // Add to ECC accumulator
            await this.accumulator.add(txHash);

            // Add to pending transactions
            const pendingTx = {
                txHash,
                from,
                to,
                type,
                blockNumber: event?.blockNumber || 'unknown',
                timestamp: Date.now()
            };

            this.pendingTransactions.push(pendingTx);
            this.processedTxHashes = this.processedTxHashes || new Set();
            this.processedTxHashes.add(txHash);

            console.log(`📦 [Pending] Added transaction ${txHash}. Total pending: ${this.pendingTransactions.length}`);

            // Debounce block creation - wait a bit for more transactions to arrive
            this.scheduleBlockCreation();
        } catch (error) {
            console.error('Error adding transaction to pending:', error);
        }
    }

    scheduleBlockCreation() {
        // Clear any existing timer
        if (this.blockCreationTimer) {
            clearTimeout(this.blockCreationTimer);
        }

        // Schedule block creation after a short delay (allows batching of rapid transactions)
        this.blockCreationTimer = setTimeout(async () => {
            if (this.pendingTransactions.length > 0 && !this.isCreatingBlock) {
                console.log(`⏰ [Scheduled Block] Creating block with ${this.pendingTransactions.length} pending transactions`);
                await this.createBlock();
            }
            this.blockCreationTimer = null;
        }, 2000); // 2 seconds debounce
    }

    startBlockProduction() {
        // Backup timer - create block every 60 seconds if there are still pending transactions
        // This is a safety net in case debounced creation somehow fails
        setInterval(async () => {
            try {
                if (this.pendingTransactions.length > 0 && !this.isCreatingBlock) {
                    console.log(`🕐 [Backup Timer] Creating block with ${this.pendingTransactions.length} pending transactions`);
                    await this.createBlock();
                }
            } catch (error) {
                console.error('Block production error:', error?.shortMessage || error?.message || error);
            }
        }, 60000); // 60 seconds (backup only)
    }

    async getBalance(address, token) {
        try {
            console.log('Calling getBalance with:', address, token);
            
            // Create a fresh contract instance for this call to avoid caching issues
            const plasmaChainABI = require('../../abi/PlasmaChain.json').abi;
            const tempContract = new ethers.Contract(
                process.env.L2_PLASMA_CHAIN_ADDRESS,
                plasmaChainABI,
                this.l2Provider // Use provider instead of wallet for read-only calls
            );
            
            const balance = await tempContract.getBalance(address, token);
            console.log('DEBUG balance:', balance);
            
            if (balance === undefined || balance === null) {
                return '0.0';
            }
            return ethers.formatEther(balance);
        } catch (error) {
            console.error('Get balance error:', error);
            throw error;
        }
    }

    async getBlock(blockNumber) {
        try {
            const block = await this.plasmaChain.getBlock(blockNumber);
            return {
                blockNumber: block.blockNumber.toString(),
                transactions: block.transactions,
                timestamp: block.timestamp.toString(),
                accumulatorValue: {
                    x: block.accumulatorValue.x.toString(),
                    y: block.accumulatorValue.y.toString()
                }
            };
        } catch (error) {
            console.error('Get block error:', error);
            throw error;
        }
    }

    getPendingTransactions() {
        return this.pendingTransactions.map(tx => ({
            ...tx,
            amount: tx.amount.toString(),
            timestamp: new Date(tx.timestamp).toISOString()
        }));
    }

    async registerERC20Transfer(txHash, from, to, amount, tokenAddress, blockNumber) {
        try {
            console.log('Registering ERC-20 transfer:', { txHash, from, to, amount, tokenAddress, blockNumber });

            // Add to pending transactions pool
            const pendingTx = {
                txHash: txHash,
                from,
                to,
                tokenAddress,
                amount: parseFloat(amount),
                timestamp: Date.now(),
                l2TxHash: txHash,
                type: 'erc20_transfer',
                blockNumber
            };

            this.pendingTransactions.push(pendingTx);
            console.log(`🔍 [ERC-20] Transfer registered. Total pending: ${this.pendingTransactions.length}`);

            // Add to accumulator
            await this.accumulator.add(txHash);

            return {
                success: true,
                txHash,
                pendingCount: this.pendingTransactions.length
            };
        } catch (error) {
            console.error('Register ERC-20 transfer error:', error);
            throw error;
        }
    }

    async scanAndRegisterERC20Transfers(fromBlock = 'latest') {
        try {
            console.log('Scanning ERC-20 transfers from block:', fromBlock);

            // Load ERC-20 token contract
            const tokenABI = [
                "event Transfer(address indexed from, address indexed to, uint256 value)"
            ];
            
            const tokenContract = new ethers.Contract(
                process.env.L2_PLASMA_TOKEN_ADDRESS,
                tokenABI,
                this.l2Provider
            );

            // Get recent blocks to scan
            const latestBlock = await this.l2Provider.getBlockNumber();
            const startBlock = fromBlock === 'latest' ? Math.max(latestBlock - 10, 0) : parseInt(fromBlock);

            console.log(`Scanning blocks ${startBlock} to ${latestBlock}`);

            // Query Transfer events
            const filter = tokenContract.filters.Transfer();
            const events = await tokenContract.queryFilter(filter, startBlock, latestBlock);

            console.log(`Found ${events.length} transfer events`);

            const processedTransfers = [];
            for (const event of events) {
                const { from, to, value } = event.args;
                const amount = ethers.formatEther(value);

                // Skip mint/burn transactions (from/to zero address)
                if (from === ethers.ZeroAddress || to === ethers.ZeroAddress) {
                    continue;
                }

                // Check if this transfer is already registered
                const existingTx = this.pendingTransactions.find(tx => tx.l2TxHash === event.transactionHash);
                if (existingTx) {
                    continue;
                }

                // Register the transfer
                const result = await this.registerERC20Transfer(
                    event.transactionHash,
                    from,
                    to,
                    amount,
                    process.env.L2_PLASMA_TOKEN_ADDRESS,
                    event.blockNumber
                );

                processedTransfers.push({
                    txHash: event.transactionHash,
                    from,
                    to,
                    amount,
                    blockNumber: event.blockNumber
                });
            }

            return {
                scannedBlocks: `${startBlock}-${latestBlock}`,
                totalEvents: events.length,
                processedTransfers: processedTransfers.length,
                transfers: processedTransfers
            };
        } catch (error) {
            console.error('Scan ERC-20 transfers error:', error);
            throw error;
        }
    }
    async startExit(userAddress, tokenAddress, amount, blockNumber, txHash) {
        try {
            console.log(`🚪 Starting exit for user ${userAddress}`);
            console.log(`Token: ${tokenAddress}, Amount: ${amount}`);
            console.log(`Block: ${blockNumber}, TX: ${txHash}`);

            // Parse amount properly
            const amountWei = typeof amount === 'string' ? ethers.parseEther(amount) : amount;
            
            // Call RootChain.startExit on L1 Sepolia
            const tx = await this.rootChain.startExit(
                tokenAddress,
                amountWei,
                blockNumber,
                txHash,
                {
                    gasLimit: 200000,
                    gasPrice: ethers.parseUnits('20', 'gwei')
                }
            );

            const receipt = await tx.wait();
            console.log(`✅ Exit started: ${tx.hash}`);

            // Find ExitStarted event
            const exitEvent = receipt.logs.find(log => {
                try {
                    const parsed = this.rootChain.interface.parseLog(log);
                    return parsed.name === 'ExitStarted';
                } catch { return false; }
            });

            if (exitEvent) {
                const parsedEvent = this.rootChain.interface.parseLog(exitEvent);
                const exitId = parsedEvent.args.exitId;
                
                return {
                    success: true,
                    txHash: tx.hash,
                    exitId: exitId,
                    userAddress,
                    tokenAddress,
                    amount,
                    blockNumber,
                    l1TxHash: txHash,
                    exitTime: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days from now
                    status: 'pending'
                };
            } else {
                throw new Error('ExitStarted event not found');
            }

        } catch (error) {
            console.error('Start exit error:', error);
            throw error;
        }
    }

    async finalizeExit(exitId) {
        try {
            console.log(`🏁 Finalizing exit: ${exitId}`);

            const tx = await this.rootChain.finalizeExit(exitId, {
                gasLimit: 200000,
                gasPrice: ethers.parseUnits('20', 'gwei')
            });

            const receipt = await tx.wait();
            console.log(`✅ Exit finalized: ${tx.hash}`);

            return {
                success: true,
                txHash: tx.hash,
                exitId: exitId,
                status: 'finalized'
            };

        } catch (error) {
            console.error('Finalize exit error:', error);
            throw error;
        }
    }

    async getExitInfo(exitId) {
        try {
            const exit = await this.rootChain.exits(exitId);
            
            return {
                owner: exit.owner,
                token: exit.token,
                amount: ethers.formatEther(exit.amount),
                blockNumber: exit.blockNumber.toString(),
                txHash: exit.txHash,
                exitTime: exit.exitTime.toString(),
                processed: exit.processed,
                canFinalize: exit.exitTime <= Math.floor(Date.now() / 1000) && !exit.processed
            };
        } catch (error) {
            console.error('Get exit info error:', error);
            throw error;
        }
    }
}

module.exports = new PlasmaService();
