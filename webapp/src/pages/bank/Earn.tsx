import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, transferIdOf, formatMinor, parseToMinor, str, type EarnPosition, type Vault } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useEarnHistory, useEarnPositions, useEarnSettings, useVaults } from '../../hooks/bank/useBankDomains'
import { useIdempotencyKey } from '../../hooks/bank/useIdempotencyKey'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, Field, QueryState, Row, SectionTitle, Sheet, Tabs } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { AmountInput } from '../../components/bank/Amount'
import { ConfirmSheet } from '../../components/bank/ConfirmSheet'
import { TransferTracker } from '../../components/bank/TransferTracker'
import { a11yToast } from '@/lib/a11yToast'

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}%`)

function MoveSheet({ mode, vault, accountId, position, onClose }: { mode: 'deposit' | 'withdraw'; vault: Vault; accountId: string; position?: EarnPosition; onClose: () => void }) {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const acct = accounts.data?.find((a) => a.id === accountId)
  const [amount, setAmount] = useState('')
  const [all, setAll] = useState(false)
  const [review, setReview] = useState(false)
  const key = useIdempotencyKey()
  const minor = parseToMinor(amount, vault.decimals)
  useEffect(() => { key.reset() }, [amount, all, accountId]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => mode === 'deposit'
      ? bank.earnDeposit({ accountId, vault: vault.address, amountMinor: minor as string }, key.current())
      : bank.earnWithdraw({ accountId, vault: vault.address, ...(all ? { all: true } : { amountMinor: minor as string }) }, key.current()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
  const op = m.data?.operation
  const tid = m.data ? transferIdOf.earn(m.data) : null
  const label = mode === 'deposit' ? 'Deposit' : 'Withdraw'
  if (review) {
    return (
      <ConfirmSheet
        title={`Confirm ${label.toLowerCase()}`}
        rows={[
          { label: label, value: all ? `All (${formatMinor(position?.valueMinor, vault.decimals)} ${vault.asset})` : `${formatMinor(minor ?? undefined, vault.decimals)} ${vault.asset}` },
          { label: 'Vault', value: `${vault.name} (${vault.chain})` },
          { label: 'Net APY', value: pct(vault.netApy) },
          { label: 'Vault fee', value: `${vault.feePct}%` },
          { label: mode === 'deposit' ? 'From' : 'To', value: acct ? (acct.label || `${acct.asset} on ${acct.chain}`) : accountId },
        ]}
        confirmLabel={label}
        pending={m.isPending}
        error={m.error}
        onConfirm={() => m.mutate()}
        onClose={onClose}
        result={op && (tid ? <TransferTracker transferId={tid} onDone={onClose} /> : <div className="space-y-2"><Row label="Status" value={<Chip status={op.status} />} />{op.failureReason && <Row label="Reason" value={op.failureReason} />}<Btn className="w-full" onClick={onClose}>Done</Btn></div>)}
      />
    )
  }
  return (
    <Sheet title={`${label} · ${vault.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label={mode === 'deposit' ? 'Amount' : 'Amount to withdraw'}>
          <AmountInput value={amount} onChange={(v) => { setAmount(v); setAll(false) }} symbol={vault.asset} decimals={vault.decimals} />
        </Field>
        {mode === 'withdraw' && position && <Btn variant="ghost" className="w-full" onClick={() => setAll(true)}>Withdraw everything ({formatMinor(position.valueMinor, vault.decimals)})</Btn>}
        {all && <p className="text-xs text-suwappu-text-secondary">Withdrawing your whole position.</p>}
        <Btn className="w-full" disabled={!(all || minor)} onClick={() => setReview(true)}>Review</Btn>
      </div>
    </Sheet>
  )
}

export function Earn() {
  const qc = useQueryClient()
  const accounts = useBankAccounts()
  const [openName, setOpenName] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [tab, setTab] = useState<'vaults' | 'positions' | 'auto'>('vaults')
  const acct = accounts.data?.find((a) => a.id === accountId)
  const vaults = useVaults(acct?.asset, acct?.chain)
  const positions = useEarnPositions()
  const settings = useEarnSettings()
  const history = useEarnHistory()
  const [move, setMove] = useState<{ mode: 'deposit' | 'withdraw'; vault: Vault; position?: EarnPosition } | null>(null)
  const [sweepVault, setSweepVault] = useState('')
  const [floor, setFloor] = useState('')
  const floorMinor = acct?.decimals != null ? (floor === '0' || floor === '0.0' ? '0' : parseToMinor(floor, acct.decimals)) : null
  const save = useMutation({
    mutationFn: (enabled: boolean) => bank.setEarnSettings({ accountId, vault: sweepVault, enabled, floorMinor: floorMinor as string }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'earn-settings'] }); a11yToast.success('Auto-sweep settings saved') },
  })
  const vaultByAddr = new Map((vaults.data ?? []).map((v) => [v.address.toLowerCase(), v]))
  return (
    <BankPage title="Earn">
      <Card className="space-y-2">
        <Field label="Account">{accounts.isLoading ? <p className="text-xs animate-pulse">Loading accounts…</p> : <AccountSelect accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} />}</Field>
        {accounts.isError && <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />}
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'vaults', label: 'Vaults' }, { id: 'positions', label: 'Positions' }, { id: 'auto', label: 'Auto-sweep' }]} />
      {tab === 'vaults' && (!acct ? <Empty title="Choose an account" hint="Vaults are listed for the account's asset and network." /> : (
        <QueryState query={vaults} isEmpty={(d) => d.length === 0} empty={<Empty title="No vaults for this asset" />}>
          {(list) => <div className="space-y-2">{list.map((v) => (
            <Card key={v.address}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><button type="button" className={`text-sm font-semibold text-left block max-w-full ${openName === v.address ? 'break-words' : 'truncate'}`} title={v.name} onClick={(e) => { e.stopPropagation(); setOpenName(openName === v.address ? null : v.address) }}>{v.name}</button><p className="text-[11px] text-suwappu-text-secondary">{v.asset} · {v.chain} · fee {v.feePct}%</p></div>
                <div className="text-right shrink-0"><p className="text-lg font-heading font-bold text-green-600">{pct(v.netApy)}</p><p className="text-[11px] text-suwappu-text-secondary">net APY</p></div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Btn onClick={() => setMove({ mode: 'deposit', vault: v })}>Deposit</Btn>
                <Btn variant="ghost" onClick={() => setMove({ mode: 'withdraw', vault: v, position: positions.data?.find((p) => p.vault.toLowerCase() === v.address.toLowerCase()) })}>Withdraw</Btn>
              </div>
            </Card>
          ))}</div>}
        </QueryState>
      ))}
      {tab === 'positions' && (
        <>
          <QueryState query={positions} isEmpty={(d) => d.length === 0} empty={<Empty title="No positions yet" hint="Deposit into a vault to start earning." />}>
            {(list) => <div className="space-y-2">{list.map((p) => (
              <Card key={p.savingsAccountId}>
                <Row label="Vault" value={vaultByAddr.get(p.vault.toLowerCase())?.name ?? p.vault} mono={!vaultByAddr.has(p.vault.toLowerCase())} />
                <Row label="Value" value={`${formatMinor(p.valueMinor, accounts.data?.find((a) => a.id === p.checkingAccountId)?.decimals ?? vaultByAddr.get(p.vault.toLowerCase())?.decimals)} ${p.asset}`} />
                <Row label="Deposited" value={formatMinor(p.principalMinor, accounts.data?.find((a) => a.id === p.checkingAccountId)?.decimals ?? vaultByAddr.get(p.vault.toLowerCase())?.decimals)} />
                <Row label="Earned" value={formatMinor(p.yieldMinor, accounts.data?.find((a) => a.id === p.checkingAccountId)?.decimals ?? vaultByAddr.get(p.vault.toLowerCase())?.decimals)} />
                <Row label="APY" value={pct(p.apy)} />
              </Card>
            ))}</div>}
          </QueryState>
          <SectionTitle>Recent operations</SectionTitle>
          <QueryState query={history} isEmpty={(d) => d.length === 0} empty={<Empty title="No operations yet" />}>
            {(ops) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{ops.map((o) => <div key={o.id} className="flex items-center justify-between py-2.5"><span className="text-sm capitalize">{o.kind}</span><Chip status={o.status} /></div>)}</Card>}
          </QueryState>
        </>
      )}
      {tab === 'auto' && (
        <>
          <Card className="space-y-3">
            <p className="text-xs text-suwappu-text-secondary">Automatically move balance above a floor into a vault. Pick an account above, then a vault.</p>
            {!acct ? <p className="text-sm">Choose an account first.</p> : (
              <>
                <Field label="Vault"><select className="w-full min-h-[44px] px-3 rounded-suwappu-lg border border-suwappu-sakura-mid/40 bg-white text-sm" value={sweepVault} onChange={(e) => setSweepVault(e.target.value)}><option value="">Select vault</option>{(vaults.data ?? []).map((v) => <option key={v.address} value={v.address}>{v.name}</option>)}</select></Field>
                <Field label={`Keep at least (${acct.asset})`} hint="Only the balance above this amount is swept."><AmountInput value={floor} onChange={setFloor} symbol={acct.asset} decimals={acct.decimals} /></Field>
                {save.isError && <ErrorBox error={save.error} />}
                <div className="grid grid-cols-2 gap-2">
                  <Btn disabled={!sweepVault || !floorMinor || save.isPending} onClick={() => save.mutate(true)}>{save.isPending ? 'Saving…' : 'Turn on'}</Btn>
                  <Btn variant="ghost" disabled={!sweepVault || !floorMinor || save.isPending} onClick={() => save.mutate(false)}>Turn off</Btn>
                </div>
              </>
            )}
          </Card>
          <SectionTitle>Current settings</SectionTitle>
          <QueryState query={settings} isEmpty={(d) => d.length === 0} empty={<Empty title="Auto-sweep is not set up" />}>
            {(list) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{list.map((s) => <div key={s.accountId} className="py-2.5 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm truncate">{accounts.data?.find((a) => a.id === s.accountId)?.label ?? s.accountId}</p><p className="text-[11px] text-suwappu-text-secondary font-mono truncate">{str(s.vault)}</p></div><Chip status={s.enabled ? 'active' : 'off'} tone={s.enabled ? 'good' : 'neutral'} /></div>)}</Card>}
          </QueryState>
        </>
      )}
      {move && acct && <MoveSheet {...move} accountId={accountId} onClose={() => setMove(null)} />}
    </BankPage>
  )
}
