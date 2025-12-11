// Centralized config fetching
const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3001'

interface ContractConfig {
  L2_PLASMA_CHAIN_ADDRESS: string
  L2_PLASMA_TOKEN_ADDRESS: string
  PLASMA_TOKEN_ADDRESS: string
  ROOT_CHAIN_ADDRESS?: string
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
    cachedConfig = await response.json()
    return cachedConfig
  } catch (err) {
    console.error('Error fetching config from backend:', err)
    // Fallback to env vars
    return {
      L2_PLASMA_CHAIN_ADDRESS: (import.meta.env.VITE_L2_PLASMA_CHAIN_ADDRESS || '0x2E983A1Ba5e8b38AAAeC4B440B9dDcFBf72E15d1') as string,
      L2_PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_L2_PLASMA_TOKEN_ADDRESS || '0x663F3ad617193148711d28f5334eE4Ed07016602') as string,
      PLASMA_TOKEN_ADDRESS: (import.meta.env.VITE_PLASMA_TOKEN_ADDRESS || '0x89decaece5440a11bd8084717ec1bd8723d4b62e') as string,
      ROOT_CHAIN_ADDRESS: (import.meta.env.VITE_ROOT_CHAIN_ADDRESS || '0x2846d7ecdca682a5cf251f3ccee4f13b974255a2') as string,
    }
  }
}
