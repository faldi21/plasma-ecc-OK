// Centralized config fetching for UTXO mode
const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3001'

export interface ContractConfig {
  mode: 'UTXO'
  ROOT_CHAIN_UTXO_ADDRESS: string
  PLASMA_CHAIN_UTXO_ADDRESS: string
  L2_PLASMA_TOKEN_ADDRESS: string
  PLASMA_TOKEN_ADDRESS: string
}

let cachedConfig: ContractConfig | null = null

export async function getContractConfig(): Promise<ContractConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig
  }

  try {
    const response = await fetch(`${BACKEND_API_URL}/api/config`)
    if (!response.ok) throw new Error('Failed to fetch config')
    const data = await response.json()
    cachedConfig = data as ContractConfig
    return cachedConfig
  } catch (err) {
    console.error('Error fetching config from backend:', err)
    // Fallback to env vars
    const fallback: ContractConfig = {
      mode: 'UTXO',
      ROOT_CHAIN_UTXO_ADDRESS: (import.meta.env.VITE_ROOT_CHAIN_UTXO_ADDRESS || '0x353f1e8535197d51effa85e1b5aa4e0b4376c5a7') as string,
      PLASMA_CHAIN_UTXO_ADDRESS: (import.meta.env.VITE_PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as string,
      L2_PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_L2_PLASMA_TOKEN_ADDRESS || '0x9E7088C23e5C0B2D02cD7886A1BDbC7FE8b71016') as string,
      PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_PLASMA_TOKEN_ADDRESS || '0x7c408cf9ade8df74b92d69d960e8036054c819c3') as string,
    }
    cachedConfig = fallback
    return fallback
  }
}

export function getBackendApiUrl(): string {
  return BACKEND_API_URL
}
