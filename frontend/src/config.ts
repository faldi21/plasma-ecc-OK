import { http } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { defineChain } from 'viem'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

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

export const config = getDefaultConfig({
  appName: 'Plasma ECC Dashboard',
  projectId: 'plasma-ecc-dashboard',
  chains: [sepolia, plasmaL2],
})
