const { ethers } = require('ethers');
require('dotenv').config();
const PlasmaService = require('./plasmaService');

class PlasmaBridge {
    constructor() {
        // L1 Provider (Sepolia)
        this.l1Provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
        
        // L2 Provider (Local)
        this.l2Provider = new ethers.JsonRpcProvider(process.env.L2_RPC_URL);
        
        // Operator wallets
        this.l1Operator = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, this.l1Provider);
        //this.l2Operator = new ethers.Wallet(process.env.L2_OPERATOR_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY, this.l2Provider);
        this.l2Operator = new ethers.Wallet(process.env.L2_OPERATOR_PRIVATE_KEY, this.l2Provider);
        // Contract instances
        this.rootChainABI = require('../../../out/RootChain.sol/RootChain.json').abi;
        this.plasmaChainABI = require('../../../out/PlasmaChain.sol/PlasmaChain.json').abi;
        // Load contract ABIs and addresses
        //const rootChainABI = require('../../abi/RootChain.json');
        //const plasmaChainABI = require('../../abi/PlasmaChain.json');
        

        this.rootChain = new ethers.Contract(
            process.env.ROOT_CHAIN_ADDRESS,
            this.rootChainABI,
            this.l1Operator
        );
        
        // PlasmaService instance
        this.plasmaService = new PlasmaService();
        
        // Track processed deposits
        this.processedDeposits = new Set();
    }

    async start() {
        console.log('🌉 Starting Plasma Bridge...');
        console.log(`L1 RootChain: ${this.rootChain.address}`);
        console.log(`Operator: ${this.l1Operator.address}`);
        
        // Listen for Deposit events on L1
        this.rootChain.on('Deposit', async (user, token, amount, depositId, event) => {
            console.log('\n💰 New Deposit Detected!');
            console.log(`User: ${user}`);
            console.log(`Token: ${token}`);
            console.log(`Amount: ${ethers.formatEther(amount)}`);
            console.log(`Deposit ID: ${depositId.toString()}`);
            
            // Process deposit
            await this.processDeposit(user, token, amount, depositId, event);
        });
        
        // Also check past deposits
        await this.syncPastDeposits();
        
        console.log('✅ Bridge is running and listening for deposits...\n');
    }

    async processDeposit(user, token, amount, depositId, event) {
        const depositKey = `${depositId.toString()}-${event.transactionHash}`;
        
        // Avoid double processing
        if (this.processedDeposits.has(depositKey)) {
            console.log('⚠️  Deposit already processed');
            return;
        }
        
        try {
            console.log('🔄 Processing deposit to L2...');
            
            // Update balance in PlasmaService (our L2 state)
            const currentBalance = await this.plasmaService.getBalance(user, token);
            const newBalance = ethers.BigNumber.from(currentBalance).add(amount);
            
            // Update L2 state
            if (!this.plasmaService.balances[user]) {
                this.plasmaService.balances[user] = {};
            }
            this.plasmaService.balances[user][token] = ethers.formatEther(newBalance);
            
            // Create deposit transaction in L2
            const depositTx = {
                type: 'deposit',
                from: 'PLASMA_BRIDGE',
                to: user,
                token: token,
                amount: ethers.formatEther(amount),
                depositId: depositId.toString(),
                l1TxHash: event.transactionHash,
                l1BlockNumber: event.blockNumber,
                timestamp: Date.now()
            };
            
            // Add to transaction pool
            this.plasmaService.transactionPool.push(depositTx);
            
            // Mark as processed
            this.processedDeposits.add(depositKey);
            
            console.log('✅ Deposit processed to L2!');
            console.log(`New L2 balance for ${user}: ${this.plasmaService.balances[user][token]} tokens`);
            
            // If we have PlasmaChain deployed on L2, also update there
            if (process.env.L2_PLASMA_CHAIN_ADDRESS) {
                await this.updateL2Contract(user, token, amount);
            }
            
        } catch (error) {
            console.error('❌ Error processing deposit:', error);
        }
    }

    async updateL2Contract(user, token, amount) {
        try {
            // Deploy PlasmaToken on L2 if not exists
            const l2TokenAddress = await this.getOrDeployL2Token(token);
            
            // Mint tokens on L2
            const l2TokenABI = require('../../../out/PlasmaToken.sol/PlasmaToken.json').abi;
            const l2Token = new ethers.Contract(l2TokenAddress, l2TokenABI, this.l2Operator);
            
            console.log('🪙 Minting tokens on L2 contract...');
            const mintTx = await l2Token.mint(user, amount);
            await mintTx.wait();
            console.log('✅ Tokens minted on L2!');
            
        } catch (error) {
            console.error('⚠️  L2 contract update failed:', error.message);
        }
    }

    async getOrDeployL2Token(l1TokenAddress) {
        // For simplicity, return the same address
        // In production, you'd maintain a mapping
        return l1TokenAddress;
    }

    async syncPastDeposits() {
        console.log('🔍 Checking for past deposits...');
        
        try {
            // Get past Deposit events
            const filter = this.rootChain.filters.Deposit();
            const fromBlock = (await this.l1Provider.getBlockNumber()) - 1000; // Last 1000 blocks
            const events = await this.rootChain.queryFilter(filter, fromBlock);
            
            console.log(`Found ${events.length} past deposits`);
            
            for (const event of events) {
                const { user, token, amount, depositId } = event.args;
                await this.processDeposit(user, token, amount, depositId, event);
            }
            
        } catch (error) {
            console.error('Error syncing past deposits:', error);
        }
    }

    async getDepositInfo(depositId) {
        try {
            const deposit = await this.rootChain.deposits(depositId);
            return {
                user: deposit.user,
                token: deposit.token,
                amount: ethers.formatEther(deposit.amount),
                blockNumber: deposit.blockNumber.toString()
            };
        } catch (error) {
            console.error('Error getting deposit info:', error);
            return null;
        }
    }
}

module.exports = PlasmaBridge;
