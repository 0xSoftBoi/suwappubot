import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Macro calendar — FOMC/CPI/options-expiry dates. Changes rarely; poll gently.
export function useCatalysts() {
  return useQuery({
    queryKey: ['catalysts'],
    queryFn: () => api.getCatalysts(),
    staleTime: 600_000,
  })
}
