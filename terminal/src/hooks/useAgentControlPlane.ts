import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import {
  approvalsApi,
  ApprovalApiError,
  type AuditQueryParams,
  type PendingApproval,
} from '../lib/approvalsApi'

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
