import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { bank, formatMinor, formatSignedMinor } from '../../lib/bankApi'
import { useBankAccount, useReconcile, useStatement } from '../../hooks/bank/useBankCore'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, QueryState, Row, SectionTitle } from '../../components/bank/BankUI'
import { a11yToast } from '@/lib/a11yToast'

export function AccountDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const acct = useBankAccount(id)
  const rec = useReconcile(id)
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors[cursors.length - 1]
  const stmt = useStatement(id, cursor)
  const sync = useMutation({
    mutationFn: () => bank.syncDeposit(id as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bank'] })
      a11yToast.info('Deposit check finished')
    },
  })
  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); a11yToast.success('Copied') } catch { a11yToast.error('Could not copy. Select the address and copy it manually.') }
  }
  return (
    <BankPage title="Account">
      <QueryState query={acct} rows={2}>
        {(a) => (
          <>
            <Card>
              <p className="text-xs text-suwappu-text-secondary">{a.label || a.kind} · {a.asset} on {a.chain}</p>
              <p className="text-3xl font-heading font-bold tabular-nums mt-1">{formatMinor(a.balanceMinor, a.decimals)} <span className="text-base">{a.asset}</span></p>
              <div className="mt-1"><Chip status={a.status} /></div>
            </Card>
            <SectionTitle>Add money by deposit</SectionTitle>
            <Card className="text-center space-y-3">
              {a.address ? (
                <>
                  <div className="mx-auto w-44 h-44 p-2 bg-white rounded-suwappu-lg shadow-suwappu-1"><QRCodeSVG value={a.address} size={160} level="M" /></div>
                  <p className="font-mono text-xs break-all text-suwappu-text">{a.address}</p>
                  <p className="text-[11px] text-suwappu-text-secondary">Send only {a.asset} on {a.chain} to this address.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Btn variant="ghost" onClick={() => void copy(a.address as string)}>Copy address</Btn>
                    <Btn onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Checking…' : 'Sync deposit'}</Btn>
                  </div>
                  {sync.isError && <ErrorBox error={sync.error} />}
                </>
              ) : (
                <p className="text-sm text-suwappu-text-secondary">This account has no deposit address.</p>
              )}
            </Card>
          </>
        )}
      </QueryState>
      <SectionTitle>Reconciliation</SectionTitle>
      <QueryState query={rec} rows={1}>
        {(r) => (
          <Card>
            <Row label="Status" value={<Chip status={r.status} />} />
            <Row label="Ledger" value={formatMinor(r.ledgerMinor, acct.data?.decimals)} />
            <Row label="On-chain" value={formatMinor(r.onchainMinor, acct.data?.decimals)} />
            <Row label="Difference" value={formatSignedMinor(r.deltaMinor, acct.data?.decimals)} />
            <Row label="In-flight transfers" value={r.inFlightTransfers} />
          </Card>
        )}
      </QueryState>
      <SectionTitle>Statement</SectionTitle>
      <QueryState query={stmt} rows={3} isEmpty={(d) => d.entries.length === 0} empty={<Empty title="No entries" hint={cursors.length ? 'No more entries.' : 'Activity on this account will appear here.'} />}>
        {(p) => (
          <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">
            {p.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{e.direction}{e.phase ? ` · ${e.phase}` : ''}</p>
                  <p className="text-[11px] text-suwappu-text-secondary">{new Date(e.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{e.direction === 'debit' ? '-' : '+'}{formatMinor(e.amountMinor, acct.data?.decimals)}</p>
                  {e.balanceAfter && <p className="text-[11px] text-suwappu-text-secondary tabular-nums">bal {formatMinor(e.balanceAfter, acct.data?.decimals)}</p>}
                </div>
              </div>
            ))}
          </Card>
        )}
      </QueryState>
      <div className="grid grid-cols-2 gap-2">
        <Btn variant="ghost" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>Newer</Btn>
        <Btn variant="ghost" disabled={!stmt.data?.nextCursor} onClick={() => stmt.data?.nextCursor && setCursors((c) => [...c, stmt.data!.nextCursor as string])}>Older</Btn>
      </div>
    </BankPage>
  )
}
