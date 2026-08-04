import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import type { SwapToken } from '../types/api'
import {
  approvalsApi,
  ApprovalApiError,
  type AuditQueryParams,
  type PendingApproval,
} from '../lib/approvalsApi'

const NATIVE_SENTINELS = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
])

/**
 * Resolves a single token's decimals/symbol for a given chain+address by
 * reusing the same token search the swap UI's TokenInput/useTokenSelectorTokens
 * hits (GET /webapp/tokens/search, wrapping api.searchTokens — see
 * terminal/src/lib/api.ts and terminal/src/hooks/useTokens usage in
 * TokenInput.tsx). No separate decimals table is maintained here: if the
 * search endpoint can't resolve the address, the caller must fall back to a
 * clearly-labelled raw/unscaled display rather than guessing.
 */
export function useApprovalTokenMetadata(chain: string, address: string) {
  const normalizedChain = chain === 'solana' ? 'solana' : chain
  const normalizedAddress = address?.toLowerCase?.() ?? address

  return useQuery<SwapToken | null>({
    queryKey: ['agent-control-plane', 'token-meta', normalizedChain, normalizedAddress],
    queryFn: async () => {
      if (!address) return null
      const results = await api.searchTokens(address, normalizedChain)
      const match = results.find((t) => {
        const tAddr = t.address?.toLowerCase?.() ?? t.address
        if (NATIVE_SENTINELS.has(normalizedAddress) && NATIVE_SENTINELS.has(tAddr)) return true
        return tAddr === normalizedAddress
      })
      return match ?? null
    },
    enabled: Boolean(address),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  })
}

export function usePendingApprovals() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'approvals', 'pending'],
    queryFn: () => approvalsApi.listPendingApprovals(),
    enabled: isAuthenticated,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useApprovalDecision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) => {
      try {
        return await approvalsApi.decideApproval(id, decision)
      } catch (err) {
        // If step-up re-confirmation is required (APPROVAL_STEP_UP_REQUIRED
        // on, approve only), mint a fresh challenge and retry exactly once.
        if (
          decision === 'approve' &&
          err instanceof ApprovalApiError &&
          err.code === 'STEP_UP_REQUIRED'
        ) {
          const { challenge } = await approvalsApi.getStepUpChallenge(id)
          return approvalsApi.decideApproval(id, decision, challenge)
        }
        throw err
      }
    },
    onMutate: async ({ id }) => {
      const queryKey = ['agent-control-plane', 'approvals', 'pending']
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueriesData<PendingApproval[]>({ queryKey })
      prev.forEach(([key, data]) => {
        if (!data) return
        queryClient.setQueryData(
          key,
          data.filter((a) => a.id !== id),
        )
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-control-plane', 'approvals'] })
    },
  })
}

/**
 * NOTE: hits GET /v1/agent/audit, which is gated by agentFlexAuth() — org API
 * key or agent bearer token ONLY, not the terminal's human session JWT. This
 * will 401 for the terminal's caller until a JWT-compatible audit route
 * exists server-side. See approvalsApi.ts's getAuditLog doc comment. Kept
 * wired (not stubbed/faked) so the real failure surfaces in the UI.
 */
export function useAuditLog(params: AuditQueryParams) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'audit', 'list', params],
    queryFn: () => approvalsApi.getAuditLog(params),
    enabled: isAuthenticated,
    staleTime: 15_000,
    retry: false,
  })
}

/** Same auth caveat as useAuditLog — see that doc comment. */
export function useAuditVerify(limit?: number) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'audit', 'verify', limit ?? null],
    queryFn: () => approvalsApi.verifyAuditChain(limit),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })
}
