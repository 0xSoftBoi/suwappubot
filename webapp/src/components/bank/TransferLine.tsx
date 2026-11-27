import { useTransferPoll } from '../../hooks/bank/useTransferPoll'
import { Chip } from './BankUI'

/** Compact live status of one ledger transfer (polls until confirmed/failed). */
export function TransferLine({ label, transferId }: { label: string; transferId: string }) {
  const q = useTransferPoll(transferId)
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-suwappu-text-secondary shrink-0">{label}</span>
      <span className="text-right min-w-0">
        {q.isLoading ? <span className="text-xs animate-pulse">Checking…</span> : q.isError ? <span className="text-xs text-red-500">Status unavailable</span> : q.data ? <Chip status={q.data.status} /> : null}
        {q.data?.failureReason && <span className="block text-[11px] text-red-500 break-words">{q.data.failureReason}</span>}
      </span>
    </div>
  )
}
