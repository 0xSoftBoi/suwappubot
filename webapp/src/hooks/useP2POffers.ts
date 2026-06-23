import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { P2POffersQuery } from '../types/p2p'

export function useP2POffers(query: P2POffersQuery) {
  return useQuery({
    queryKey: ['p2p', 'offers', query],
    queryFn: () => api.getP2POffers(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.offers,
  })
}
