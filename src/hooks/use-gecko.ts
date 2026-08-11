import { useMutation, useQuery } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { getAuthRevision } from '../lib/auth'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
import type { ActivityEntry, AskResponse, EarnActionResponse, EarnSnapshot, MobileSnapshot } from '../types/api'

export function useSnapshot(enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<MobileSnapshot>({
    queryKey: queryKeys.snapshot(authRevision),
    queryFn: ({ signal }) => endpoints.snapshot(signal),
    staleTime: STALE.balance,
    enabled,
  })
}

export function useActivity(limit = 20, offset = 0, enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<ActivityEntry[]>({
    queryKey: queryKeys.activity(authRevision, limit, offset),
    queryFn: ({ signal }) => endpoints.activity(limit, offset, signal),
    staleTime: STALE.activity,
    enabled,
  })
}

export function useAskGecko() {
  return useMutation<AskResponse, Error, string>({
    mutationFn: (text) => endpoints.ask(text),
  })
}

export function useEarn(enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<EarnSnapshot>({
    queryKey: queryKeys.earn(authRevision),
    queryFn: ({ signal }) => endpoints.earn(signal),
    staleTime: STALE.earn,
    enabled,
  })
}

export function useEarnDeposit() {
  return useMutation<EarnActionResponse, Error, string>({
    mutationFn: (amount) => endpoints.earnDeposit(amount),
  })
}

export function useEarnWithdraw() {
  return useMutation<EarnActionResponse, Error, string>({
    mutationFn: (amount) => endpoints.earnWithdraw(amount),
  })
}
