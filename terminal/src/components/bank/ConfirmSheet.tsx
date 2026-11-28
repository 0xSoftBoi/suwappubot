import type { ReactNode } from 'react'
import { Btn, ErrorBox, Row, Sheet } from './BankUI'

export interface ConfirmRow { label: string; value: ReactNode; mono?: boolean }

/**
 * Confirm-before-submit sheet for every money-moving action. Shows the exact amount, asset,
 * recipient and fee returned by the API; submit is disabled while pending. Once `result` is
 * provided (e.g. a <TransferTracker/>), the confirm button is replaced by it.
 */
export function ConfirmSheet({
  title,
  rows,
  confirmLabel,
  pending,
  error,
  result,
  onConfirm,
  onClose,
  note,
}: {
  title: string
  rows: ConfirmRow[]
  confirmLabel: string
  pending: boolean
  error?: unknown
  result?: ReactNode
  onConfirm: () => void
  onClose: () => void
  note?: string
}) {
  return (
    <Sheet title={title} onClose={onClose} dismissible={!pending}>
      <div className="divide-y divide-terminal-border">
        {rows.map((r) => (
          <Row key={r.label} {...r} />
        ))}
      </div>
      {note && <p className="text-xs text-terminal-text-secondary mt-2">{note}</p>}
      {!!error && <div className="mt-3"><ErrorBox error={error} /></div>}
      <div className="mt-4">
        {result ?? (
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="ghost" onClick={onClose} disabled={pending}>Cancel</Btn>
            <Btn onClick={onConfirm} disabled={pending} aria-busy={pending}>{pending ? 'Submitting…' : confirmLabel}</Btn>
          </div>
        )}
      </div>
    </Sheet>
  )
}
