import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTransferPoll, isTerminalTransfer } from '../../hooks/bank/useTransferPoll'
import { Btn, Chip, ErrorBox, Row } from './BankUI'

/** Polls the transfer until confirmed/failed and shows the real status. */
export function TransferTracker({ transferId, onDone }: { transferId: string; onDone: () => void }) {
  const q = useTransferPoll(transferId)
  const qc = useQueryClient()
  const status = q.data?.status
  useEffect(() => {
    if (isTerminalTransfer(status)) void qc.invalidateQueries({ queryKey: ['bank'] })
  }, [status, qc])
  return (
    <div className="space-y-2" aria-live="polite">
      {q.isLoading && <p className="text-sm text-suwappu-text-secondary animate-pulse">Checking status…</p>}
      {q.isError && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <Row label="Status" value={<Chip status={q.data.status} />} />
          {q.data.txHash && <Row label="Transaction" value={q.data.txHash} mono />}
          {q.data.failureReason && <Row label="Reason" value={q.data.failureReason} />}
          {!isTerminalTransfer(q.data.status) && <p className="text-xs text-suwappu-text-secondary">Waiting for confirmation. You can close this; the transfer continues.</p>}
        </>
      )}
      <Btn className="w-full" onClick={onDone}>{isTerminalTransfer(status) ? 'Done' : 'Close'}</Btn>
    </div>
  )
}
