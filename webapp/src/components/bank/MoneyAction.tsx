import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { str } from '../../lib/bankApi'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { Btn, Row } from './BankUI'
import { ConfirmSheet, type ConfirmRow } from './ConfirmSheet'
import { TransferTracker } from './TransferTracker'

/**
 * Generic confirm-then-submit sheet for money-moving actions. The idempotency key is created on
 * mount of the intent and reused if the user retries after an error; a new intent = a new mount.
 */
export function MoneyAction({ title, rows, confirmLabel, note, run, onClose, trackId, renderResult }: {
  title: string
  rows: ConfirmRow[]
  confirmLabel: string
  note?: string
  run: (idempotencyKey: string) => Promise<unknown>
  onClose: () => void
  /** Per-endpoint typed accessor (bankApi transferIdOf.*). Omit when the endpoint returns no transfer id; the real status is shown instead. */
  trackId?: (res: any) => string | null // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Extra result detail derived from the real response. */
  renderResult?: (res: any) => ReactNode // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const qc = useQueryClient()
  const key = useIdempotencyKey()
  const [done, setDone] = useState(false)
  const m = useMutation({ mutationFn: () => run(key.current()), onSuccess: () => { setDone(true); void qc.invalidateQueries({ queryKey: ['bank'] }) } })
  const tid = m.data && trackId ? trackId(m.data) : null
  const rec = (m.data ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const status = m.data ? str(rec.status) ?? str(rec.transferStatus) ?? str((rec.run ?? rec.escrow ?? rec.stream ?? rec.invoice ?? rec.operation ?? {}).status) : undefined
  return (
    <ConfirmSheet
      title={title} rows={rows} confirmLabel={confirmLabel} note={note}
      pending={m.isPending} error={m.error}
      onConfirm={() => m.mutate()} onClose={onClose}
      result={done ? (tid ? <TransferTracker transferId={tid} onDone={onClose} /> : <div className="space-y-2">{status && <Row label="Status" value={status} />}{renderResult && renderResult(m.data)}<Btn className="w-full" onClick={onClose}>Done</Btn></div>) : undefined}
    />
  )
}
