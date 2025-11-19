// deploy-l1-fixed.js
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployL1RootChain() {
    console.log("🚀 Deploying fixed RootChain contract to Sepolia...\n");

    // Connect to Sepolia network
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    
    console.log("Deployer address:", deployer.address);
    console.log("Network:", await provider.getNetwork());
    
    const balance = await provider.getBalance(deployer.address);
    console.log("Deployer balance:", ethers.formatEther(balance), "ETH\n");

    try {
        // Load contract ABI and bytecode
        const RootChain = require("../../out/RootChain.sol/RootChain.json");
        
        const factory = new ethers.ContractFactory(
            RootChain.abi,
            RootChain.bytecode.object || RootChain.bytecode,
            deployer
        );

        // Deploy with operator address from .env
        console.log("Deploying RootChain with operator:", process.env.OPERATOR_ADDRESS);
        
        const rootChain = await factory.deploy(process.env.OPERATOR_ADDRESS, {
            gasLimit: 3000000, // Set explicit gas limit
            gasPrice: ethers.parseUnits("10", "gwei") // 10 gwei
        });
        
        await rootChain.waitForDeployment();
        const receipt = await rootChain.deploymentTransaction().wait(2); // Wait for 2 confirmations
        
        console.log("✅ RootChain deployed at:", rootChain.target);
        console.log("   Transaction hash:", receipt.hash);
        console.log("   Block number:", receipt.blockNumber);
        console.log("   Gas used:", receipt.gasUsed.toString());

        // Update .env file
        const envPath = path.resolve(__dirname, "../../.env");
        let envContent = fs.readFileSync(envPath, "utf8");
        
        // Replace or add ROOT_CHAIN_ADDRESS
        if (envContent.includes("ROOT_CHAIN_ADDRESS=")) {
            envContent = envContent.replace(
                /ROOT_CHAIN_ADDRESS=.*/,
                `ROOT_CHAIN_ADDRESS=${rootChain.target}`
            );
        } else {
            envContent += `\nROOT_CHAIN_ADDRESS=${rootChain.target}`;
        }
        
        // Write back to .env
        fs.writeFileSync(envPath, envContent);
        console.log("\n✅ Updated .env with new ROOT_CHAIN_ADDRESS");
        
        console.log("\n🔗 View on Etherscan:");
        console.log(`   https://sepolia.etherscan.io/address/${rootChain.target}`);
        console.log(`   https://sepolia.etherscan.io/tx/${receipt.hash}`);
        
        return {
            address: rootChain.target,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber
        };
        
    } catch (error) {
        console.error("❌ Deployment failed:", error.message);
        if (error.data) {
            console.error("Error data:", error.data);
        }
        throw error;
    }
}

// Run deployment
deployL1RootChain().catch(console.error);