import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor, type BankAccount } from '../../lib/bankApi'
import { groupByCurrency, useBankAccounts, useBankAssets, useBankTransfers } from '../../hooks/bank/useBankCore'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, Input, QueryState, QuickLink, SectionTitle, Select, Sheet } from '../../components/bank/BankUI'
import { a11yToast } from '@/lib/a11yToast'

function OpenAccount({ onClose }: { onClose: () => void }) {
  const assets = useBankAssets()
  const qc = useQueryClient()
  const [pick, setPick] = useState('')
  const [label, setLabel] = useState('')
  const m = useMutation({
    mutationFn: () => {
      const [asset, chain] = pick.split('|')
      return bank.openAccount({ kind: 'checking', asset, chain, label: label.trim() || undefined })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bank', 'accounts'] })
      a11yToast.success('Account opened')
      onClose()
    },
  })
  return (
    <Sheet title="Open an account" onClose={onClose} dismissible={!m.isPending}>
      <div className="space-y-3">
        {assets.isError && <ErrorBox error={assets.error} onRetry={() => void assets.refetch()} />}
        <Field label="Currency and network">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={assets.isLoading}>
            <option value="">{assets.isLoading ? 'Loading…' : 'Select'}</option>
            {(assets.data ?? []).map((a) => (
              <option key={`${a.symbol}|${a.chain}`} value={`${a.symbol}|${a.chain}`}>{a.symbol} · {a.currency} · {a.chain}</option>
            ))}
          </Select>
        </Field>
        <Field label="Label (optional)"><Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
        {m.isError && <ErrorBox error={m.error} />}
        <Btn className="w-full" disabled={!pick || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Opening…' : 'Open account'}</Btn>
      </div>
    </Sheet>
  )
}

function AccountRow({ a, onOpen }: { a: BankAccount; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full flex items-center justify-between gap-3 py-3 text-left min-h-[56px]">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-suwappu-text truncate">{a.label || a.kind}</p>
        <p className="text-[11px] text-suwappu-text-secondary truncate">{a.asset} · {a.chain}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold tabular-nums">{formatMinor(a.balanceMinor, a.decimals)}</p>
        {a.status !== 'active' && <Chip status={a.status} />}
      </div>
    </button>
  )
}

export function BankHome() {
  const nav = useNavigate()
  const accounts = useBankAccounts()
  const transfers = useBankTransfers(undefined, 5)
  const [opening, setOpening] = useState(false)
  const links: Array<[string, string, string]> = [
    ['Send', '↗', '/bank/send'], ['Add money', '＋', '/bank/add'], ['Earn', '%', '/bank/earn'], ['Card', '▭', '/bank/cards'], ['Borrow', '⇄', '/bank/credit'],
  ]
  const more: Array<[string, string]> = [['Convert', '/bank/convert'], ['Payments', '/bank/payments'], ['Payroll', '/bank/payroll'], ['Business', '/bank/business'], ['Agents', '/bank/agents'], ['Privacy', '/bank/privacy'], ['Developers', '/bank/developers'], ['Settings', '/bank/settings']]
  return (
    <BankPage title="Suwappu Bank" back="/home">
      <div className="grid grid-cols-5 gap-2">
        {links.map(([l, i, p]) => <QuickLink key={l} label={l} icon={i} onClick={() => nav(p)} />)}
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {more.map(([l, p]) => <button key={l} type="button" onClick={() => nav(p)} className="min-h-[40px] px-3 rounded-full bg-white border border-suwappu-sakura-mid/30 text-xs font-semibold text-suwappu-purple-deep whitespace-nowrap">{l}</button>)}
      </div>
      <SectionTitle right={<button type="button" className="min-h-[44px] px-2 text-xs font-semibold text-suwappu-magenta-mid" onClick={() => setOpening(true)}>Open account</button>}>Accounts</SectionTitle>
      <QueryState query={accounts} rows={2} isEmpty={(d) => d.length === 0} empty={<Empty title="No accounts yet" hint="Open your first currency account to get started." action={<Btn onClick={() => setOpening(true)}>Open account</Btn>} />}>
        {(list) => (
          <div className="space-y-3">
            {groupByCurrency(list).map((g) => (
              <Card key={g.currency}>
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-semibold text-suwappu-text-secondary">{g.currency}</p>
                  <p className="text-xl font-heading font-bold tabular-nums">{g.decimals === null ? '—' : formatMinor(g.totalMinor, g.decimals)}</p>
                </div>
                <div className="divide-y divide-suwappu-sakura-mid/20 mt-1">
                  {g.accounts.map((a) => <AccountRow key={a.id} a={a} onOpen={() => nav(`/bank/accounts/${a.id}`)} />)}
                </div>
              </Card>
            ))}
            <p className="text-[11px] text-suwappu-text-secondary px-1">Totals are per currency; different currencies are never added together.</p>
          </div>
        )}
      </QueryState>
      <SectionTitle>Recent transfers</SectionTitle>
      <QueryState query={transfers} rows={2} isEmpty={(d) => d.length === 0} empty={<Empty title="No transfers yet" />}>
        {(list) => (
          <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">
            {list.map((t) => {
              const dec = accounts.data?.find((a) => a.asset === t.asset && a.chain === t.chain)?.decimals ?? null
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.memo || t.type}</p>
                    <p className="text-[11px] text-suwappu-text-secondary">{new Date(t.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatMinor(t.amountMinor, dec)} {t.asset}</p>
                    <Chip status={t.status} />
                  </div>
                </div>
              )
            })}
          </Card>
        )}
      </QueryState>
      {opening && <OpenAccount onClose={() => setOpening(false)} />}
    </BankPage>
  )
}
