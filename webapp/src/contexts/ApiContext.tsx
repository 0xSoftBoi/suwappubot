/**
 * API Context for Suwappu Webapp
 *
 * Provides a unified API interface that can switch between the real API client
 * and mock API for Storybook/testing. Components use this context to access
 * API methods without needing to know which implementation is active.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { api } from '../lib/api'
import { mockApi } from '../lib/api-mock'
import type { Portfolio, Swap, HealthStatus, LinkedWallet, AuthChallenge, LinkWalletResponse } from '@suwappu/shared'

/**
 * API interface that both real and mock clients implement
 */
export interface ApiInterface {
  // Portfolio & Swaps
  getPortfolio(): Promise<Portfolio>
  getSwaps(limit?: number, offset?: number): Promise<Swap[]>
  getSwap(id: string): Promise<Swap>

  // Auth
  validateAuth(): Promise<{ valid: boolean; user?: unknown }>

  // Health
  getHealth(): Promise<HealthStatus>

  // Wallet Linking
  requestWalletChallenge(address: string): Promise<AuthChallenge>
  linkWallet(address: string, signature: string, nonce: string): Promise<LinkWalletResponse>
  getLinkedWallets(): Promise<LinkedWallet[]>
  unlinkWallet(address: string): Promise<{ success: boolean; message: string }>
}

// Context defaults to real API
const ApiContext = createContext<ApiInterface>(api)

interface ApiProviderProps {
  children: ReactNode
  /**
   * When true, uses mock API that returns test data without network requests.
   * Useful for Storybook, tests, and development without a backend.
   */
  useMock?: boolean
}

/**
 * Provider that supplies the API client to the component tree.
 *
 * @example
 * // In production app (uses real API)
 * <ApiProvider>
 *   <App />
 * </ApiProvider>
 *
 * @example
 * // In Storybook (uses mock API)
 * <ApiProvider useMock>
 *   <MyComponent />
 * </ApiProvider>
 */
export function ApiProvider({ children, useMock = false }: ApiProviderProps) {
  const apiClient = useMock ? mockApi : api

  return <ApiContext.Provider value={apiClient}>{children}</ApiContext.Provider>
}

/**
 * Hook to access the API client from any component.
 *
 * @example
 * function MyComponent() {
 *   const api = useApi()
 *   const { data } = useQuery({
 *     queryKey: ['portfolio'],
 *     queryFn: () => api.getPortfolio(),
 *   })
 * }
 */
export function useApi(): ApiInterface {
  return useContext(ApiContext)
}

/**
 * Export the default API for direct imports where context isn't needed.
 * Prefer using useApi() hook in components for testability.
 */
export { api, mockApi }
