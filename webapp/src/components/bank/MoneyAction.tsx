import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { findTransferId, str } from '../../lib/bankApi'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { Btn, Row } from './BankUI'
import { ConfirmSheet, type ConfirmRow } from './ConfirmSheet'
import { TransferTracker } from './TransferTracker'

/**
 * Generic confirm-then-submit sheet for money-moving actions. The idempotency key is created on
 * mount of the intent and reused if the user retries after an error; a new intent = a new mount.
 */
export function MoneyAction({ title, rows, confirmLabel, note, run, onClose }: {
  title: string
  rows: ConfirmRow[]
  confirmLabel: string
  note?: string
  run: (idempotencyKey: string) => Promise<unknown>
  onClose: () => void
}) {
  const qc = useQueryClient()
  const key = useIdempotencyKey()
  const [done, setDone] = useState(false)
  const m = useMutation({ mutationFn: () => run(key.current()), onSuccess: () => { setDone(true); void qc.invalidateQueries({ queryKey: ['bank'] }) } })
  const tid = m.data ? findTransferId(m.data) : null
  const status = m.data ? str((m.data as Record<string, unknown>).status) ?? str(((m.data as Record<string, any>).run ?? (m.data as Record<string, any>).escrow ?? {}).status) : undefined
  return (
    <ConfirmSheet
      title={title} rows={rows} confirmLabel={confirmLabel} note={note}
      pending={m.isPending} error={m.error}
      onConfirm={() => m.mutate()} onClose={onClose}
      result={done ? (tid ? <TransferTracker transferId={tid} onDone={onClose} /> : <div className="space-y-2">{status && <Row label="Status" value={status} />}<Btn className="w-full" onClick={onClose}>Done</Btn></div>) : undefined}
    />
  )
}
