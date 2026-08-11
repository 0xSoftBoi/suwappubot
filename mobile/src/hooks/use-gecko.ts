import { useMutation, useQuery } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { getAuthRevision } from '../lib/auth'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
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

export function useEarnDeposit() {
  return useMutation<EarnActionResponse, Error, EarnActionVars>({
    mutationFn: (vars) => endpoints.earnDeposit(vars.amount, vars.walletId),
  })
}

export function useEarnWithdraw() {
  return useMutation<EarnActionResponse, Error, EarnActionVars>({
    mutationFn: (vars) => endpoints.earnWithdraw(vars.amount, vars.walletId),
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
}

export function useSend() {
  return useMutation<SendActionResponse, Error, SendVars>({
    mutationFn: (vars) => endpoints.send(vars.to, vars.amount),
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
  })
}

export function useDeleteGoal() {
  return useMutation<{ ok: true }, Error, number>({
    mutationFn: (goalId) => endpoints.deleteGoal(goalId),
  })
}
