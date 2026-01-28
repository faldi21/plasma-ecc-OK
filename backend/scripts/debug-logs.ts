
import { createPublicClient, http, getEventSelector } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const L2_RPC_URL = process.env.L2_RPC_URL || 'http://localhost:8545';

const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  network: 'plasma-l2',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [L2_RPC_URL] },
    public: { http: [L2_RPC_URL] },
  },
};

const client = createPublicClient({
  chain: l2Chain,
  transport: http(L2_RPC_URL),
});

const txHash = '0xcbce6c9b4a3b90f8f214467d157dc19ab96b3873b78714b2e5bfff9714b3ff20';
const PLASMA_CHAIN_UTXO_ADDRESS = process.env.PLASMA_CHAIN_UTXO_ADDRESS;

async function main() {
  console.log('Fetching receipt for:', txHash);
  console.log('Expected Address:', PLASMA_CHAIN_UTXO_ADDRESS);

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    console.log('Status:', receipt.status);
    console.log('Logs found:', receipt.logs.length);

    const expectedSelector = getEventSelector('AggregatedWithdrawalCreated(bytes32,address,address,uint256,uint256,bytes32[])');
    console.log('Expected Selector:', expectedSelector);

    receipt.logs.forEach((log, index) => {
        console.log(`\nLog #${index}:`);
        console.log('  Address:', log.address);
        console.log('  Topics:', log.topics);
        
        const addressMatch = log.address.toLowerCase() === PLASMA_CHAIN_UTXO_ADDRESS?.toLowerCase();
        const topicMatch = log.topics[0] === expectedSelector;
        
        console.log('  Address match:', addressMatch);
        console.log('  Selector match:', topicMatch);
    });


    const operator = await client.readContract({
      address: PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`,
      abi: [{
        name: 'operator',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'address' }],
      }, {
        name: 'nonces',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ type: 'address' }],
        outputs: [{ type: 'uint256' }],
      }],
      functionName: 'operator',
    });
    console.log('\nContract Operator:', operator);

    const user = '0x62dc14Fe819A241e176ee6A813f51045d04A0cda';
    const nonce = await client.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`,
        abi: [{
            name: 'nonces',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ type: 'address' }],
            outputs: [{ type: 'uint256' }],
        }],
        functionName: 'nonces',
        args: [user],
    });

    // Check User UTXOs
    const userUtxos = await client.readContract({
        address: PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`,
        abi: [{
            name: 'getUserUtxos',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ type: 'address' }],
            outputs: [{ type: 'bytes32[]' }],
        }],
        functionName: 'getUserUtxos',
        args: [user],
    });
    console.log(`\nUser UTXOs (${userUtxos.length}):`);

    const L2_PLASMA_TOKEN = process.env.L2_PLASMA_TOKEN_ADDRESS;
    console.log('Expected Token (L2_PLASMA_TOKEN_ADDRESS):', L2_PLASMA_TOKEN);

    for (const utxoId of userUtxos) {
        const utxo = await client.readContract({
            address: PLASMA_CHAIN_UTXO_ADDRESS as `0x${string}`,
            abi: [{
                name: 'utxos',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ type: 'bytes32' }],
                outputs: [
                    { name: 'utxoId', type: 'bytes32' },
                    { name: 'owner', type: 'address' },
                    { name: 'token', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                    { name: 'createdInBlock', type: 'uint256' },
                    { name: 'spent', type: 'bool' },
                    { name: 'spentInTx', type: 'bytes32' }
                ],
            }],
            functionName: 'utxos',
            args: [utxoId],
        });
        
        // @ts-ignore
        const isMatch = utxo[2].toLowerCase() === L2_PLASMA_TOKEN?.toLowerCase();
        // @ts-ignore
        console.log(`  - ${utxoId}: Token=${utxo[2]}, Amount=${utxo[3]}, Spent=${utxo[5]} [${isMatch ? 'MATCH' : 'MISMATCH'}]`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();

