import { useQuery } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'

const TERMINAL = new Set(['confirmed', 'failed', 'reversed'])

/** Polls GET /transfers/:id every 2.5s until confirmed/failed/reversed. */
export function useTransferPoll(transferId: string | null | undefined) {
  return useQuery({
    queryKey: ['bank', 'transfer', transferId],
    queryFn: async () => (await bank.getTransfer(transferId as string)).transfer,
    enabled: !!transferId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s && TERMINAL.has(s) ? false : 2500
    },
    retry: 2,
  })
}

export const isTerminalTransfer = (s?: string) => !!s && TERMINAL.has(s)
