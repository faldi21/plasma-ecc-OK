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
      ROOT_CHAIN_UTXO_ADDRESS: (import.meta.env.VITE_ROOT_CHAIN_UTXO_ADDRESS || '0xA174D1816585662ff34D540CB6E215A18d984B48') as string,
      PLASMA_CHAIN_UTXO_ADDRESS: (import.meta.env.VITE_PLASMA_CHAIN_UTXO_ADDRESS || '0x308e62a9c18E0E4BFfD5F573f3152a1968BbeE61') as string,
      L2_PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_L2_PLASMA_TOKEN_ADDRESS || '0x9E7088C23e5C0B2D02cD7886A1BDbC7FE8b71016') as string,
      PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_PLASMA_TOKEN_ADDRESS || '0x4d43a10b3d8ec0662b84E7C4e718AdCA55d1A09D') as string,
    }
    cachedConfig = fallback
    return fallback
  }
}

export function getBackendApiUrl(): string {
  return BACKEND_API_URL
}
