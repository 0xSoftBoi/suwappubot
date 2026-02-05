/**
 * React Query hooks for the referral system.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useReferralCode() {
  return useQuery({
    queryKey: ['referralCode'],
    queryFn: () => api.getReferralCode(),
  })
}

export function useReferralStats() {
  return useQuery({
    queryKey: ['referralStats'],
    queryFn: () => api.getReferralStats(),
  })
}

export function useReferralList() {
  return useQuery({
    queryKey: ['referralList'],
    queryFn: () => api.getReferrals(),
  })
}
