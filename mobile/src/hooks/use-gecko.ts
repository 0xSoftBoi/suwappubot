import { useMutation, useQuery } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { getAuthRevision } from '../lib/auth'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
import { ApiError } from '../lib/api'
import { analytics } from '../lib/analytics'
import { bucketUsd, type UsdBucket } from '../lib/analytics-privacy'
import type {
  ActivityEntry,
  AskResponse,
  BorrowSnapshot,
  EarnActionResponse,
  EarnSnapshot,
  EnsResolution,
  Goal,
  GoalsSnapshot,
  MobileSnapshot,
  SendActionResponse,
  Statement,
  Wallet,
} from '../types/api'

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

interface EarnActionVars {
  amount: string
  walletId?: number
}

// USDC is ~1:1 with USD on this stablecoin-only surface, so amount strings
// bucket directly through bucketUsd. "max" has no known ceiling here (the
// screen resolves it, not this hook) and buckets as '0' — a known gap, see
// mobile analytics summary.
function bucketAmount(raw: string): UsdBucket {
  return bucketUsd(Number(raw))
}

function httpStatusOf(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined
}

export function useEarnDeposit() {
  return useMutation<EarnActionResponse, Error, EarnActionVars>({
    mutationFn: (vars) => {
      analytics.track('earn_deposit_submitted', { amount_bucket: bucketAmount(vars.amount) })
      return endpoints.earnDeposit(vars.amount, vars.walletId)
    },
    onSuccess: (response, vars) => {
      analytics.track('earn_deposit_result', {
        status: response.ok ? 'ok' : 'pending',
        amount_bucket: bucketAmount(vars.amount),
      })
    },
    onError: (err, vars) => {
      analytics.track('earn_deposit_result', {
        status: 'error',
        http_status: httpStatusOf(err),
        amount_bucket: bucketAmount(vars.amount),
      })
    },
  })
}

export function useEarnWithdraw() {
  return useMutation<EarnActionResponse, Error, EarnActionVars>({
    mutationFn: (vars) => {
      analytics.track('earn_withdraw_submitted', { amount_bucket: bucketAmount(vars.amount) })
      return endpoints.earnWithdraw(vars.amount, vars.walletId)
    },
    onSuccess: (response, vars) => {
      analytics.track('earn_withdraw_result', {
        status: response.ok ? 'ok' : 'pending',
        amount_bucket: bucketAmount(vars.amount),
      })
    },
    onError: (err, vars) => {
      analytics.track('earn_withdraw_result', {
        status: 'error',
        http_status: httpStatusOf(err),
        amount_bucket: bucketAmount(vars.amount),
      })
    },
  })
}

export function useWallets(enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<Wallet[]>({
    queryKey: queryKeys.wallets(authRevision),
    queryFn: ({ signal }) => endpoints.wallets(signal),
    staleTime: STALE.wallets,
    enabled,
  })
}

interface SendVars {
  to: string
  amount: string
  // Never the recipient value itself — only which shape it was, per the
  // instrumentation spec's privacy rule.
  recipientType: 'ens' | 'hex'
}

export function useSend() {
  return useMutation<SendActionResponse, Error, SendVars>({
    mutationFn: (vars) => {
      analytics.track('send_submitted', { recipient_type: vars.recipientType })
      return endpoints.send(vars.to, vars.amount)
    },
    onSuccess: (response, vars) => {
      analytics.track('send_result', {
        status: response.ok ? 'ok' : 'pending',
        amount_bucket: bucketAmount(vars.amount),
        recipient_type: vars.recipientType,
      })
    },
    onError: (err, vars) => {
      analytics.track('send_result', {
        status: 'error',
        http_status: httpStatusOf(err),
        amount_bucket: bucketAmount(vars.amount),
        recipient_type: vars.recipientType,
      })
    },
  })
}

export function useBorrow(enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<BorrowSnapshot>({
    queryKey: queryKeys.borrow(authRevision),
    queryFn: ({ signal }) => endpoints.borrow(signal),
    staleTime: STALE.borrow,
    enabled,
  })
}

export function useStatement(month: string, enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<Statement>({
    queryKey: queryKeys.statement(authRevision, month),
    queryFn: ({ signal }) => endpoints.statement(month, signal),
    staleTime: STALE.statement,
    enabled,
  })
}

/** `name` should already be the debounced, lowercased candidate — pass
 * enabled=false until the caller's debounce window has elapsed. */
export function useResolveEns(name: string, enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<EnsResolution>({
    queryKey: queryKeys.resolveEns(authRevision, name),
    queryFn: ({ signal }) => endpoints.resolveEns(name, signal),
    staleTime: STALE.ensResolve,
    enabled: enabled && name.length > 0,
    retry: false,
  })
}

export function useGoals(enabled = true) {
  const authRevision = getAuthRevision()
  return useQuery<GoalsSnapshot>({
    queryKey: queryKeys.goals(authRevision),
    queryFn: ({ signal }) => endpoints.goals(signal),
    staleTime: STALE.goals,
    enabled,
  })
}

interface CreateGoalVars {
  name: string
  targetUsd: number
}

export function useCreateGoal() {
  return useMutation<Goal, Error, CreateGoalVars>({
    mutationFn: (vars) => endpoints.createGoal(vars.name, vars.targetUsd),
    onSuccess: () => analytics.track('goal_created'),
  })
}

export function useDeleteGoal() {
  return useMutation<{ ok: true }, Error, number>({
    mutationFn: (goalId) => endpoints.deleteGoal(goalId),
    onSuccess: () => analytics.track('goal_deleted'),
  })
}
