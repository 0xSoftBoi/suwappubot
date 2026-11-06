import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { Address } from 'viem'
import { ClearingAction, LineStatusV2 } from '@suwappu/primitives-client'
import { TerminalButton, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../foundation'
import { fmt, isAddress, parseAmount } from '../contracts'
import { call } from '../useCommonsTx'
import { useLocalMeta } from './local'
import { CH, CHA, TOKEN, intentJson, useSignIntent, type Run, type SignedIntent } from './shared'
import type { Position } from './useNetwork'

/**
 * W2 batch payments: paste `counterparty,amount,reference` rows (counterparty =
 * address or address-book label). Every row is validated against LIVE headroom
 * before anything is sent; then one sequential tx run, or (relay mode) one
 * signed intent per row bundled for the relayer.
 */

type Row = { raw: string; to?: Address; amount?: bigint; ref: string; error?: string }

const EXAMPLE = '# counterparty (address or label), amount mUSD, reference\nAcme Supplies, 12.5, INV-1042\n0x…, 3, PO-77'

export function BatchPay({
  me,
  positions,
  run,
  busy,
  relay,
  onSigned,
}: {
  me?: Address
  positions: Position[]
  run: Run
  busy: string | null
  relay: boolean
  onSigned: (s: SignedIntent) => void
}) {
  const { book, name, setRef } = useLocalMeta()
  const sign = useSignIntent()
  const [text, setText] = useState('')

  const byLabel = useMemo(() => {
    const m = new Map<string, Address>()
    for (const [addr, c] of Object.entries(book)) m.set(c.label.toLowerCase(), addr as Address)
    return m
  }, [book])

  const rows: Row[] = useMemo(() => {
    const headroomUsed = new Map<string, bigint>()
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((raw) => {
        const [who = '', amt = '', ...refParts] = raw.split(',').map((x) => x.trim())
        const to = isAddress(who) ? (who as Address) : byLabel.get(who.toLowerCase())
        const amount = parseAmount(amt)
        const ref = refParts.join(',').trim()
        if (!to) return { raw, ref, error: `Unknown counterparty "${who}" — use an address or an address-book label` }
        if (!amount) return { raw, to, ref, error: `Invalid amount "${amt}"` }
        const pos = positions.find((p) => p.counterparty.toLowerCase() === to.toLowerCase())
        if (!pos || pos.line?.status !== LineStatusV2.Active) return { raw, to, amount, ref, error: 'No active line with this counterparty' }
        // Headroom: credit they extend to me minus what I already owe (+ earlier rows in this batch).
        const used = (headroomUsed.get(to.toLowerCase()) ?? 0n) + amount
        headroomUsed.set(to.toLowerCase(), used)
        const headroom = pos.creditTheyExtend - pos.iOwe
        if (used > headroom) return { raw, to, amount, ref, error: `Exceeds headroom (${fmt(headroom > 0n ? headroom : 0n, 2)} mUSD available)` }
        return { raw, to, amount, ref }
      })
  }, [text, byLabel, positions])

  const ok = rows.filter((r) => !r.error)
  const total = ok.reduce((s, r) => s + (r.amount ?? 0n), 0n)
  const allValid = rows.length > 0 && ok.length === rows.length

  const submit = async () => {
    if (!me || !allValid) return
    if (relay) {
      try {
        const payloads = []
        for (const r of ok) payloads.push({ ...(await sign(me, ClearingAction.Pay, [r.to, TOKEN, r.amount])), reference: r.ref || undefined })
        onSigned({
          label: `Batch of ${payloads.length} payments`,
          decoded: ok.map((r) => [`${name(r.to)}${r.ref ? ` · ${r.ref}` : ''}`, `${fmt(r.amount!)} mUSD`]),
          json: intentJson({ intents: payloads }),
        })
        toast.success(`Signed ${payloads.length} intents`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message.split('\n')[0] : String(e))
      }
      return
    }
    const hashes = await run(
      `Batch: ${ok.length} payments`,
      ok.map((r) => call(`Pay ${name(r.to)}`, CH, CHA, 'pay', [r.to, TOKEN, r.amount])),
    )
    if (hashes) {
      ok.forEach((r, i) => r.ref && hashes[i] && setRef(hashes[i], r.ref))
      setText('')
    }
  }

  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Batch" title="Batch payments on credit" description="One row per payment: counterparty (address or label), amount, reference. Validated against live headroom before anything is sent. References are stored locally against the tx hash." />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        rows={5}
        className="terminal-theme-control w-full rounded p-2 font-mono text-[11px] text-terminal-text"
      />
      {rows.length > 0 && (
        <div className="grid gap-0.5 text-[11px]">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <TerminalStatusPill tone={r.error ? 'down' : 'up'}>{r.error ? 'ERR' : 'OK'}</TerminalStatusPill>
              <span className="min-w-0 flex-1 truncate font-mono text-terminal-text-secondary">
                {r.to ? name(r.to) : r.raw} {r.amount ? `· ${fmt(r.amount)} mUSD` : ''} {r.ref ? `· ${r.ref}` : ''}
              </span>
              {r.error && <span className="text-terminal-down">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
      <TerminalButton variant="primary" disabled={!me || !allValid || !!busy} onClick={submit}>
        {rows.length === 0 ? 'Paste rows to begin' : allValid ? `${relay ? 'Sign' : 'Send'} ${ok.length} payment${ok.length === 1 ? '' : 's'} · ${fmt(total, 2)} mUSD` : `Fix ${rows.length - ok.length} row${rows.length - ok.length === 1 ? '' : 's'} first`}
      </TerminalButton>
    </TerminalPanel>
  )
}
