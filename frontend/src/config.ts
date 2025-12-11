import { http, createConfig } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { defineChain } from 'viem'

export const plasmaL2 = defineChain({
  id: 31337,
  name: 'Plasma L2',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
})

export const config = createConfig({
  chains: [sepolia, plasmaL2],
  transports: {
    [sepolia.id]: http(),
    [plasmaL2.id]: http(),
  },
})
