import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useP2PMyOffers() {
  return useQuery({
    queryKey: ['p2p', 'offers', 'mine'],
    queryFn: () => api.getP2PMyOffers(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.offers,
  })
}
