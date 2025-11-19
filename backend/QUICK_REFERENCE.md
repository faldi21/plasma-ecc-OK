# ⚡ Quick Reference - Viem & TypeScript

## 📦 Common Imports

```typescript
// Viem core
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  type Hash,
} from 'viem';

// Account management
import { privateKeyToAccount } from 'viem/accounts';

// Chains
import { sepolia, mainnet } from 'viem/chains';
```

## 🔧 Setup Clients

### Public Client (Read-only)
```typescript
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http('https://sepolia.infura.io/v3/YOUR_KEY'),
});
```

### Wallet Client (Read + Write)
```typescript
const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY');

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http('https://sepolia.infura.io/v3/YOUR_KEY'),
});
```

## 📖 Read Contract

```typescript
const balance = await publicClient.readContract({
  address: '0xContractAddress',
  abi: contractAbi,
  functionName: 'balanceOf',
  args: ['0xUserAddress'],
}) as bigint;

console.log(`Balance: ${formatEther(balance)} ETH`);
```

## ✍️ Write Contract

```typescript
const hash = await walletClient.writeContract({
  address: '0xContractAddress',
  abi: contractAbi,
  functionName: 'transfer',
  args: ['0xRecipient', parseEther('1.0')],
  gas: 100000n, // optional
});

// Wait for confirmation
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Transaction confirmed:', receipt.transactionHash);
```

## 👁️ Watch Events

```typescript
// Watch single event
publicClient.watchContractEvent({
  address: '0xContractAddress',
  abi: contractAbi,
  eventName: 'Transfer',
  onLogs: (logs) => {
    logs.forEach((log) => {
      const { from, to, value } = log.args as {
        from: Address;
        to: Address;
        value: bigint;
      };
      console.log(`Transfer: ${from} → ${to}, ${formatEther(value)} tokens`);
    });
  },
});

// Watch with filters
publicClient.watchContractEvent({
  address: '0xContractAddress',
  abi: contractAbi,
  eventName: 'Transfer',
  args: {
    from: '0xSpecificAddress', // filter by from address
  },
  onLogs: (logs) => {
    // Handle filtered logs
  },
});
```

## 🔍 Get Past Events

```typescript
const logs = await publicClient.getContractEvents({
  address: '0xContractAddress',
  abi: contractAbi,
  eventName: 'Transfer',
  fromBlock: 1000000n,
  toBlock: 'latest',
});

logs.forEach((log) => {
  console.log('Event at block:', log.blockNumber);
  console.log('Args:', log.args);
});
```

## 💰 Value Conversion

```typescript
// String to Wei (BigInt)
const wei = parseEther('1.5'); // 1500000000000000000n

// Wei to String
const eth = formatEther(1500000000000000000n); // "1.5"

// Gwei
import { parseGwei, formatGwei } from 'viem';
const gwei = parseGwei('50'); // 50000000000n
const formatted = formatGwei(50000000000n); // "50"

// Units
import { parseUnits, formatUnits } from 'viem';
const tokens = parseUnits('100', 6); // 100000000n (for 6 decimals like USDC)
const formatted = formatUnits(100000000n, 6); // "100"
```

## 🔐 Address Utilities

```typescript
import { isAddress, getAddress, isAddressEqual } from 'viem';

// Validate address
if (isAddress('0x123...')) {
  console.log('Valid address');
}

// Checksum address
const checksummed = getAddress('0xabc...'); // 0xAbC...

// Compare addresses (case-insensitive)
const isSame = isAddressEqual(
  '0xabc...',
  '0xABC...'
); // true
```

## 🔢 BigInt Operations

```typescript
// Native BigInt in TypeScript
const a = 1000000000000000000n; // 1 ETH in wei
const b = 500000000000000000n;  // 0.5 ETH in wei

// Arithmetic
const sum = a + b;       // 1500000000000000000n
const diff = a - b;      // 500000000000000000n
const product = a * 2n;  // 2000000000000000000n
const quotient = a / 2n; // 500000000000000000n

// Comparison
a > b; // true
a === 1000000000000000000n; // true

// Convert from/to string
const str = a.toString(); // "1000000000000000000"
const num = BigInt(str);  // 1000000000000000000n
```

## 🎯 Type Definitions

```typescript
import type { Address, Hex, Hash } from 'viem';

// Address (checksummed Ethereum address)
const address: Address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1';

// Hex (any hex string)
const hex: Hex = '0x1234';

// Hash (32-byte hex string, transaction hash)
const hash: Hash = '0x1234567890123456789012345678901234567890123456789012345678901234';

// Custom types
interface Transaction {
  from: Address;
  to: Address;
  value: bigint;
  hash: Hash;
}
```

## 🔄 Transaction Handling

```typescript
// Send transaction
const hash = await walletClient.sendTransaction({
  to: '0xRecipient',
  value: parseEther('1.0'),
  gas: 21000n,
});

// Get transaction
const tx = await publicClient.getTransaction({ hash });
console.log('Tx data:', tx);

// Wait for receipt
const receipt = await publicClient.waitForTransactionReceipt({
  hash,
  confirmations: 2, // wait for 2 confirmations
  timeout: 60_000,  // timeout after 60 seconds
});

// Check status
if (receipt.status === 'success') {
  console.log('Transaction successful!');
} else {
  console.log('Transaction failed');
}
```

## ⚙️ Gas Estimation

```typescript
// Estimate gas for contract call
const gasEstimate = await publicClient.estimateContractGas({
  address: '0xContractAddress',
  abi: contractAbi,
  functionName: 'transfer',
  args: ['0xRecipient', parseEther('1.0')],
  account: account.address,
});

console.log('Estimated gas:', gasEstimate);

// Use estimate with buffer
await walletClient.writeContract({
  address: '0xContractAddress',
  abi: contractAbi,
  functionName: 'transfer',
  args: ['0xRecipient', parseEther('1.0')],
  gas: gasEstimate * 12n / 10n, // +20% buffer
});
```

## 📡 Block Information

```typescript
// Get current block number
const blockNumber = await publicClient.getBlockNumber();

// Get block
const block = await publicClient.getBlock({
  blockNumber: 1000000n,
  includeTransactions: true,
});

console.log('Block hash:', block.hash);
console.log('Timestamp:', block.timestamp);
console.log('Transactions:', block.transactions.length);
```

## 🌐 Custom Chain

```typescript
const customChain = {
  id: 31337, // chain ID
  name: 'Local Anvil',
  network: 'anvil',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
    public: { http: ['http://localhost:8545'] },
  },
} as const;

const client = createPublicClient({
  chain: customChain,
  transport: http(),
});
```

## 🔥 Error Handling

```typescript
import {
  ContractFunctionExecutionError,
  TransactionExecutionError,
} from 'viem';

try {
  await walletClient.writeContract({...});
} catch (error) {
  if (error instanceof ContractFunctionExecutionError) {
    console.error('Contract error:', error.shortMessage);
    console.error('Cause:', error.cause);
  } else if (error instanceof TransactionExecutionError) {
    console.error('Transaction error:', error.shortMessage);
  } else {
    console.error('Unknown error:', error);
  }
}
```

## 🎨 ABI Types

```typescript
// Define ABI
const abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const; // ← Important: "as const" for type inference

// Use with proper types
const balance = await publicClient.readContract({
  address: '0x...',
  abi,
  functionName: 'balanceOf', // ← Autocomplete works!
  args: ['0x...'],           // ← Type-checked!
}) as bigint;
```

## 🧪 Common Patterns

### Pattern 1: Safe Contract Call
```typescript
async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error('Call failed:', error);
    return null;
  }
}

const balance = await safeCall(() =>
  publicClient.readContract({
    address: '0x...',
    abi,
    functionName: 'balanceOf',
    args: ['0x...'],
  })
);

if (balance === null) {
  console.log('Failed to get balance');
}
```

### Pattern 2: Retry with Exponential Backoff
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries reached');
}
```

### Pattern 3: Batch Read Calls
```typescript
async function batchRead() {
  const [balance1, balance2, totalSupply] = await Promise.all([
    publicClient.readContract({
      address: '0x...',
      abi,
      functionName: 'balanceOf',
      args: ['0xUser1'],
    }),
    publicClient.readContract({
      address: '0x...',
      abi,
      functionName: 'balanceOf',
      args: ['0xUser2'],
    }),
    publicClient.readContract({
      address: '0x...',
      abi,
      functionName: 'totalSupply',
    }),
  ]);

  return { balance1, balance2, totalSupply };
}
```

## 🐛 Debugging Tips

```typescript
// 1. Log transaction data before sending
const txData = {
  address: '0x...',
  abi,
  functionName: 'transfer',
  args: ['0x...', parseEther('1.0')],
};
console.log('Sending transaction:', txData);
const hash = await walletClient.writeContract(txData);

// 2. Use try-catch for better error messages
try {
  await walletClient.writeContract({...});
} catch (error: any) {
  console.error('Error:', error.message);
  console.error('Data:', error.data);
  console.error('Cause:', error.cause);
}

// 3. Check balance before sending
const balance = await publicClient.getBalance({
  address: account.address,
});
console.log('Balance:', formatEther(balance));
```

## 📚 Resources

- [Viem Docs](https://viem.sh)
- [Type Reference](https://viem.sh/docs/typescript)
- [Examples](https://viem.sh/docs/actions/public/readContract)

---

**Quick Reference v1.0**
**Last Updated:** 2025-11-18
