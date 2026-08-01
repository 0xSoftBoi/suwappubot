import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import {
  approvalsApi,
  type AuditQueryParams,
  type PendingApproval,
} from '../lib/approvalsApi'

export function usePendingApprovals(agentId?: string) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'approvals', 'pending', agentId ?? null],
    queryFn: () => approvalsApi.listPendingApprovals({ agentId }),
    enabled: isAuthenticated,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useApprovalDecision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
      approvalsApi.decideApproval(id, decision),
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

export function useAuditLog(params: AuditQueryParams) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'audit', 'list', params],
    queryFn: () => approvalsApi.getAuditLog(params),
    enabled: isAuthenticated,
    staleTime: 15_000,
  })
}

export function useAuditVerify(limit?: number) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['agent-control-plane', 'audit', 'verify', limit ?? null],
    queryFn: () => approvalsApi.verifyAuditChain(limit),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
