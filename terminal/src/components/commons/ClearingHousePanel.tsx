import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { ClearingAction, FLAG_CLEARABLE, LineStatusV2, feeRateFromApr } from '@suwappu/primitives-client'
import {
  TerminalButton,
  TerminalInset,
  TerminalKeyValueRow,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalSegmentedTabs,
  TerminalStatusPill,
  TerminalTextField,
} from '../foundation'
import { usePersistentState } from '../../lib/persist'
import { addressUrl, aprFromPerSecond, fmt, isAddress, parseAmount, short, toNum } from './contracts'
import { approveIfNeeded, call } from './useCommonsTx'
import { ActivityLog } from './clearing/ActivityLog'
import { BatchPay } from './clearing/BatchPay'
import { Inbox } from './clearing/Inbox'
import { AddressBookTools, ContactEditor, LocalMetaProvider, useLocalMeta } from './clearing/local'
import { Statement } from './clearing/Statement'
import { useActivity } from './clearing/useActivity'
import { ClearingDesk } from './clearing/ClearingDesk'
import { AlertsStrip, KpiStrip, alertsFor } from './clearing/Overview'
import { PositionsTable } from './clearing/PositionsTable'
import { CounterpartyStanding } from './clearing/Standing'
import { useNetwork } from './clearing/useNetwork'
import {
  CH,
  CHA,
  STATUS_LABEL,
  TOKEN,
  ch,
  statusTone,
  useAct,
  type Act,
  type LineV2,
  type Run,
  type SignedIntent,
} from './clearing/shared'

/**
 * Commons v2 · Clearing House — treasury desk.
 * Spec: docs/plans/commons-v2.md §2. Contract: CommonsClearingHouse (Base Sepolia).
 *
 * Layout: exposure KPIs + deadline alerts on top; then Positions (sortable book
 * + line detail with on-chain counterparty standing), Clearing (client-side
 * cycle solver → one clear() batch), Activity (on-chain audit trail, CSV), and
 * Payments (escrow, routing policy, routed payments). Every user action can be
 * sent as a tx or, in relay mode, signed as an EIP-712 intent with decoded params.
 */

type DeskTab = 'inbox' | 'positions' | 'clearing' | 'activity' | 'payments'

export function ClearingHousePanel() {
  return (
    <LocalMetaProvider>
      <Desk />
    </LocalMetaProvider>
  )
}

function Desk() {
  const [relay, setRelay] = usePersistentState<boolean>('commons:v2:relay', false)
  const [tab, setTab] = usePersistentState<DeskTab>('commons:v2:desk', 'inbox')
  const [signed, setSigned] = useState<SignedIntent | null>(null)
  const { act, run, busy, address } = useAct(relay, setSigned)
  const [cpInput, setCpInput] = useState('')
  const cp = isAddress(cpInput) && cpInput.toLowerCase() !== address?.toLowerCase() ? (cpInput.trim() as Address) : undefined

  const net = useNetwork(address)
  const { data: claimableRaw } = useReadContract({ ...ch, functionName: 'claimable', args: [address!, TOKEN], query: { enabled: !!address, refetchInterval: 15_000 } })
  const claimable = (claimableRaw as bigint | undefined) ?? 0n
  const { name } = useLocalMeta()
  const alerts = useMemo(() => (address ? alertsFor(address, net.positions, name) : []), [address, net.positions, name])
  const counterparties = useMemo(() => net.positions.map((p) => p.counterparty), [net.positions])
  const activity = useActivity(address, counterparties)
  const inboxCount = useMemo(
    () =>
      alerts.length +
      net.positions.filter((p) => p.line?.status === LineStatusV2.Proposed && p.line.proposer.toLowerCase() !== address?.toLowerCase()).length +
      (claimable > 0n ? 1 : 0),
    [alerts, net.positions, address, claimable],
  )

  const openLine = (a: Address) => {
    setCpInput(a)
    setTab('positions')
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5 md:gap-2 [&>*]:shrink-0">
      <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
        <TerminalPanelHeader
          eyebrow="Commons v2 · Layer 1"
          title="Clearing House"
          description="An ownerless credit-clearing network. Lines bind to the exact terms both sides accepted, payments route only through intermediaries who opted in, and anyone can clear debt cycles without moving a single net position. Repayment settles into escrow."
          meta={
            <a href={addressUrl(CH)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-terminal-text-muted hover:text-terminal-accent">
              {short(CH)} · verified ↗
            </a>
          }
        />
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-1">
            <TerminalTextField label="Counterparty — open or propose a line" placeholder="0x…" mono value={cpInput} onChange={(e) => setCpInput(e.target.value)} />
            <AddressBookTools />
          </div>
          <label className="flex cursor-pointer items-start gap-2 pb-1 text-xs md:max-w-sm">
            <input type="checkbox" className="mt-0.5" checked={relay} onChange={(e) => setRelay(e.target.checked)} />
            <span>
              <span className="font-semibold text-terminal-text">Relay mode</span>
              <span className="text-terminal-text-muted"> — sign actions as EIP-712 intents (decoded before signing) for a relayer to submit; you pay no gas.</span>
            </span>
          </label>
        </div>
      </TerminalPanel>

      {address && <KpiStrip positions={net.positions} claimable={claimable} alerts={alerts} />}
      {address && tab !== 'inbox' && <AlertsStrip alerts={alerts} onOpen={openLine} />}
      {signed && <SignedIntentCard s={signed} onClose={() => setSigned(null)} />}

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="w-max">
          <TerminalSegmentedTabs
            activeId={tab}
            options={[
              { id: 'inbox', label: `Inbox${inboxCount ? ` · ${inboxCount}` : ''}` },
              { id: 'positions', label: `Positions${net.positions.length ? ` · ${net.positions.length}` : ''}` },
              { id: 'clearing', label: 'Clearing desk' },
              { id: 'activity', label: 'Activity' },
              { id: 'payments', label: 'Payments & routing' },
            ]}
            onChange={(id) => setTab(id as DeskTab)}
          />
        </div>
      </div>

      {!address ? (
        <TerminalPanel className="p-[var(--terminal-space-card)]">
          <p className="text-sm text-terminal-text-secondary">Connect a wallet to see your book. The clearing desk can still scan the whole network.</p>
        </TerminalPanel>
      ) : null}

      {tab === 'inbox' && address && (
        <Inbox me={address} positions={net.positions} claimable={claimable} act={act} run={run} busy={busy} onOpen={openLine} />
      )}

      {tab === 'positions' && address && (
        <div className="grid min-h-0 grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <PositionsTable positions={net.positions} loading={net.loading} selected={cp} onSelect={(a) => setCpInput(a)} me={address} />
          <div className="flex min-h-0 flex-col gap-1.5 md:gap-2 [&>*]:shrink-0">
            {cp ? (
              <>
                <LineView me={address} cp={cp} act={act} run={run} busy={busy} relay={relay} />
                <ContactEditor address={cp} />
                <Statement me={address} cp={cp} activity={activity.data ?? []} />
                <CounterpartyStanding who={cp} />
              </>
            ) : (
              <TerminalPanel className="p-[var(--terminal-space-card)]">
                <p className="text-sm text-terminal-text-secondary">Select a line in the book, or enter a counterparty above to propose one.</p>
              </TerminalPanel>
            )}
          </div>
        </div>
      )}

      {tab === 'clearing' && <ClearingDesk me={address} edges={net.clearableEdges} loading={net.loading} run={run} busy={busy} />}

      {tab === 'activity' && address && <ActivityLog me={address} activity={activity} />}

      {tab === 'payments' && (
        <div className="grid grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-2">
          <BatchPay me={address} positions={net.positions} run={run} busy={busy} relay={relay} onSigned={setSigned} />
          <PathPay me={address} act={act} busy={busy} />
          <Escrow me={address} act={act} busy={busy} />
          <Routing me={address} act={act} busy={busy} />
        </div>
      )}

      {net.error && <p className="text-xs text-terminal-warn">Network scan failed: {net.error.message.slice(0, 120)}</p>}
      {net.truncated && <p className="text-xs text-terminal-warn">Showing the first 300 lines — an indexer is needed beyond testnet scale.</p>}
    </div>
  )
}

function SignedIntentCard({ s, onClose }: { s: SignedIntent; onClose: () => void }) {
  return (
    <TerminalPanel className="flex flex-col gap-2 border border-terminal-accent/40 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Signed intent" title={s.label} meta={<TerminalButton size="sm" variant="ghost" onClick={onClose}>Dismiss</TerminalButton>} />
      <TerminalInset className="grid gap-1 p-3 text-xs">
        {s.decoded.map(([k, v]) => (
          <TerminalKeyValueRow key={k} label={k} value={<span className="font-mono">{v}</span>} />
        ))}
      </TerminalInset>
      <pre className="max-h-48 overflow-auto rounded bg-terminal-panel p-2 font-mono text-[10px] text-terminal-text-secondary">{s.json}</pre>
      <div className="flex gap-1.5">
        <TerminalButton
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(s.json)
            toast.success('Copied')
          }}
        >
          Copy for relayer
        </TerminalButton>
        <span className="self-center text-[11px] text-terminal-text-muted">Submit with execute(intent, signature) from any account.</span>
      </div>
    </TerminalPanel>
  )
}


function LineView({ me, cp, act, run, busy, relay }: { me: Address; cp: Address; act: Act; run: Run; busy: string | null; relay: boolean }) {
  const { data } = useReadContracts({
    contracts: [
      { ...ch, functionName: 'getLine', args: [me, cp, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [me, cp, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [cp, me, TOKEN] },
      { ...ch, functionName: 'routeCap', args: [me, cp, TOKEN] },
    ],
    query: { refetchInterval: 10_000 },
  })
  const line = data?.[0]?.result as LineV2 | undefined
  const iOwe = (data?.[1]?.result as bigint | undefined) ?? 0n
  const theyOwe = (data?.[2]?.result as bigint | undefined) ?? 0n
  const myRouteCap = (data?.[3]?.result as bigint | undefined) ?? 0n

  const [limitIn, setLimitIn] = useState('100')
  const [aprIn, setAprIn] = useState('0')
  const [graceIn, setGraceIn] = useState('7')
  const [clearable, setClearable] = useState(true)
  const [amtIn, setAmtIn] = useState('')
  const [capIn, setCapIn] = useState('')
  const [newLimitIn, setNewLimitIn] = useState('')
  const [refIn, setRefIn] = useState('')
  const [countering, setCountering] = useState(false)
  const { name, setRef } = useLocalMeta()
  const limit = parseAmount(limitIn) ?? 0n
  const amt = parseAmount(amtIn)
  const cap = parseAmount(capIn)
  // '0' is a valid new limit (stop extending credit); parseAmount rejects zero.
  const newLimit = newLimitIn.trim() === '0' ? 0n : parseAmount(newLimitIn)

  if (!line) return <TerminalPanel className="h-40 animate-pulse p-[var(--terminal-space-card)]">{null}</TerminalPanel>

  const meIsLo = me.toLowerCase() < cp.toLowerCase()
  const creditIExtend = meIsLo ? line.limitLo : line.limitHi
  const creditTheyExtend = meIsLo ? line.limitHi : line.limitLo
  const iAmProposer = line.proposer.toLowerCase() === me.toLowerCase()
  const now = Date.now() / 1000
  const demandOpen = line.demandTs > 0n
  const iDemanded = demandOpen && line.demandBy.toLowerCase() === me.toLowerCase()
  const graceEnds = demandOpen ? Number(line.demandTs) + Number(line.grace) : undefined
  const canDefault = iDemanded && graceEnds !== undefined && now > graceEnds && theyOwe > 0n && line.status === LineStatusV2.Active
  const isClearable = (line.flags & FLAG_CLEARABLE) !== 0
  const graceSec = BigInt(Math.max(86_400, Math.round(Number(graceIn) * 86_400)))
  const feeRate = feeRateFromApr(Number(aprIn))

  const C = (label: string, fn: string, args: readonly unknown[]) => call(label, CH, CHA, fn, args)

  return (
    <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Line · mUSD"
        title={`You ⇄ ${name(cp)}`}
        meta={<TerminalStatusPill tone={statusTone(line.status)}>{STATUS_LABEL[line.status]}</TerminalStatusPill>}
      />
      <Lifecycle line={line} me={me} iOwe={iOwe} theyOwe={theyOwe} />

      {(line.status === LineStatusV2.Active || line.status === LineStatusV2.Defaulted) && (
        <Balance iOwe={iOwe} theyOwe={theyOwe} creditIExtend={creditIExtend} creditTheyExtend={creditTheyExtend} />
      )}

      {line.status !== LineStatusV2.None && (
        <TerminalInset className="grid gap-1 p-3 text-xs">
          <TerminalKeyValueRow label="Credit you extend" value={`${fmt(creditIExtend, 2)} mUSD`} />
          <TerminalKeyValueRow label="Credit they extend" value={`${fmt(creditTheyExtend, 2)} mUSD`} />
          <TerminalKeyValueRow label="Fee on balance" value={aprFromPerSecond(line.feeRate)} />
          <TerminalKeyValueRow label="Grace after demand" value={`${(Number(line.grace) / 86_400).toFixed(2)} days`} />
          <TerminalKeyValueRow label="Clearable" value={isClearable ? 'yes — both consented' : 'no'} />
          <TerminalKeyValueRow label="Terms hash" value={<span className="font-mono">{line.termsHash.slice(0, 10)}… · v{line.nonce}</span>} />
          {demandOpen && (
            <TerminalKeyValueRow
              label={iDemanded ? 'You demanded settlement' : 'They demanded settlement'}
              value={graceEnds ? (now > graceEnds ? 'grace elapsed' : `until ${new Date(graceEnds * 1000).toLocaleString()}`) : '—'}
            />
          )}
        </TerminalInset>
      )}

      {(line.status === LineStatusV2.None || line.status === LineStatusV2.Closed) && (
        <div className="grid gap-2">
          <p className="text-xs text-terminal-text-muted">Your counterparty accepts these exact terms (they're hashed) and chooses the credit they extend back.</p>
          <div className="grid grid-cols-3 gap-1.5">
            <TerminalTextField label="Credit you extend" inputMode="decimal" mono value={limitIn} onChange={(e) => setLimitIn(e.target.value)} suffix="mUSD" />
            <TerminalTextField label="Fee APR" inputMode="decimal" mono value={aprIn} onChange={(e) => setAprIn(e.target.value)} suffix="%" />
            <TerminalTextField label="Grace" inputMode="decimal" mono value={graceIn} onChange={(e) => setGraceIn(e.target.value)} suffix="days" />
          </div>
          <label className="flex items-center gap-2 text-xs text-terminal-text-secondary">
            <input type="checkbox" checked={clearable} onChange={(e) => setClearable(e.target.checked)} />
            Allow multilateral clearing on this line (recommended)
          </label>
          <TerminalButton
            variant="primary"
            disabled={!!busy || Number(aprIn) > 50 || Number(graceIn) < 1}
            onClick={() =>
              act(
                'Propose line',
                ClearingAction.Propose,
                [cp, TOKEN, limit, feeRate, graceSec, clearable ? FLAG_CLEARABLE : 0],
                [
                  ['counterparty', cp],
                  ['credit you extend', `${fmt(limit, 2)} mUSD`],
                  ['fee', `${aprIn}% APR`],
                  ['grace', `${Number(graceSec) / 86_400} days`],
                  ['clearable', String(clearable)],
                ],
                [C('Propose', 'proposeLine', [cp, TOKEN, limit, feeRate, graceSec, clearable ? FLAG_CLEARABLE : 0])],
              )
            }
          >
            Propose credit line
          </TerminalButton>
          {Number(graceIn) < 1 && <span className="text-xs text-terminal-down">Minimum grace is 1 day (contract MIN_GRACE).</span>}
          {Number(aprIn) > 50 && <span className="text-xs text-terminal-down">Fee is capped on-chain at ~50% APR.</span>}
        </div>
      )}

      {line.status === LineStatusV2.Proposed &&
        (iAmProposer ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-terminal-text-muted">Waiting for {short(cp)} to accept.</span>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => act('Cancel proposal', ClearingAction.Cancel, [cp, TOKEN], [['counterparty', cp]], [C('Cancel', 'cancelProposal', [cp, TOKEN])])}
            >
              Cancel proposal
            </TerminalButton>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-xs text-terminal-text-muted">
              {short(cp)} offers {fmt(creditTheyExtend, 2)} mUSD of credit at {aprFromPerSecond(line.feeRate)}, {(Number(line.grace) / 86_400).toFixed(1)}-day grace{isClearable ? ', clearable' : ''}. Accepting binds to terms hash <span className="font-mono">{line.termsHash.slice(0, 10)}…</span> — if they change the terms, your accept fails.
            </p>
            <TerminalTextField label="Credit you extend back" inputMode="decimal" mono value={limitIn} onChange={(e) => setLimitIn(e.target.value)} suffix="mUSD" />
            <div className="flex gap-1.5">
              <TerminalButton
                variant="primary"
                disabled={!!busy}
                onClick={() =>
                  act(
                    'Accept line',
                    ClearingAction.Accept,
                    [cp, TOKEN, limit, line.termsHash],
                    [
                      ['proposer', cp],
                      ['their credit to you', `${fmt(creditTheyExtend, 2)} mUSD`],
                      ['fee', aprFromPerSecond(line.feeRate)],
                      ['your credit to them', `${fmt(limit, 2)} mUSD`],
                      ['terms hash', line.termsHash],
                    ],
                    [C('Accept', 'acceptLine', [cp, TOKEN, limit, line.termsHash])],
                  )
                }
              >
                Accept these terms
              </TerminalButton>
              <TerminalButton
                variant="ghost"
                disabled={!!busy}
                onClick={() => act('Reject proposal', ClearingAction.Reject, [cp, TOKEN], [['proposer', cp]], [C('Reject', 'rejectProposal', [cp, TOKEN])])}
              >
                Reject
              </TerminalButton>
              <TerminalButton variant="ghost" disabled={!!busy || relay} onClick={() => setCountering((c) => !c)} title={relay ? 'Counter-proposals need two actions — use tx mode' : undefined}>
                {countering ? 'Cancel counter' : 'Counter-propose'}
              </TerminalButton>
            </div>
            {countering && (
              <div className="grid gap-2 rounded border border-terminal-accent/40 p-2">
                <p className="text-[11px] text-terminal-text-muted">Rejects their proposal and proposes your terms in one run (two transactions). They then accept, reject or counter.</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <TerminalTextField label="Credit you extend" inputMode="decimal" mono value={limitIn} onChange={(e) => setLimitIn(e.target.value)} suffix="mUSD" />
                  <TerminalTextField label="Fee APR" inputMode="decimal" mono value={aprIn} onChange={(e) => setAprIn(e.target.value)} suffix="%" />
                  <TerminalTextField label="Grace" inputMode="decimal" mono value={graceIn} onChange={(e) => setGraceIn(e.target.value)} suffix="days" />
                </div>
                <label className="flex items-center gap-2 text-xs text-terminal-text-secondary">
                  <input type="checkbox" checked={clearable} onChange={(e) => setClearable(e.target.checked)} />
                  Clearable
                </label>
                <TerminalButton
                  variant="primary"
                  disabled={!!busy || Number(aprIn) > 50 || Number(graceIn) < 1}
                  onClick={() =>
                    run(`Counter-propose to ${name(cp)}`, [
                      C('Reject theirs', 'rejectProposal', [cp, TOKEN]),
                      C('Propose yours', 'proposeLine', [cp, TOKEN, limit, feeRate, graceSec, clearable ? FLAG_CLEARABLE : 0]),
                    ]).then((ok) => ok && setCountering(false))
                  }
                >
                  Send counter-proposal
                </TerminalButton>
              </div>
            )}
          </div>
        ))}

      {(line.status === LineStatusV2.Active || line.status === LineStatusV2.Defaulted) && (
        <div className="grid gap-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TerminalTextField label="Amount" inputMode="decimal" placeholder="0.0" mono value={amtIn} onChange={(e) => setAmtIn(e.target.value)} suffix="mUSD" />
            <TerminalTextField label="Reference (local) — invoice / PO" placeholder="INV-1042" value={refIn} onChange={(e) => setRefIn(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {line.status === LineStatusV2.Active && (
              <TerminalButton
                variant="primary"
                disabled={!!busy || !amt}
                onClick={() =>
                  amt &&
                  act('Pay on credit', ClearingAction.Pay, [cp, TOKEN, amt], [['to', `${name(cp)} (${cp})`], ['amount', `${fmt(amt)} mUSD`], ...(refIn ? ([['reference', refIn]] as [string, string][]) : [])], [C('Pay', 'pay', [cp, TOKEN, amt])]).then(
                    (res) => {
                      if (Array.isArray(res) && res.length && refIn) setRef(res[res.length - 1], refIn)
                      if (res) {
                        setAmtIn('')
                        setRefIn('')
                      }
                    },
                  )
                }
              >
                Pay on credit
              </TerminalButton>
            )}
            <TerminalButton
              variant="secondary"
              disabled={!!busy || !amt || iOwe === 0n}
              onClick={() =>
                amt &&
                (relay
                  ? act('Settle in mUSD', ClearingAction.Settle, [cp, TOKEN, amt], [['creditor', cp], ['amount', `${fmt(amt)} mUSD`], ['note', 'needs prior mUSD approval to the clearing house']], [])
                  : run('Settle in mUSD', [approveIfNeeded(TOKEN, CH, amt, 'Approve mUSD'), C('Settle', 'settle', [cp, TOKEN, amt])])
                ).then((ok) => ok && setAmtIn(''))
              }
            >
              Settle in mUSD
            </TerminalButton>
            {iOwe > 0n && (
              <button type="button" className="text-[11px] text-terminal-accent" onClick={() => setAmtIn(String(toNum(iOwe)))}>
                fill amount owed
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || theyOwe === 0n || demandOpen || line.status !== LineStatusV2.Active}
              onClick={() => act('Demand settlement', ClearingAction.Demand, [cp, TOKEN], [['debtor', cp]], [C('Demand', 'demandSettlement', [cp, TOKEN])])}
            >
              Demand settlement
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || !canDefault}
              onClick={() => act('Mark default', ClearingAction.MarkDefault, [cp, TOKEN], [['debtor', cp]], [C('Mark default', 'markDefault', [cp, TOKEN])])}
            >
              Mark default
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || theyOwe === 0n}
              onClick={() => act('Write off debt', ClearingAction.WriteOff, [cp, TOKEN], [['debtor', cp], ['forgives', `${fmt(theyOwe)} mUSD (recorded publicly)`]], [C('Write off', 'writeOff', [cp, TOKEN])])}
            >
              Write off
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || iOwe > 0n || theyOwe > 0n || line.status !== LineStatusV2.Active}
              onClick={() => act('Close line', ClearingAction.Close, [cp, TOKEN], [['counterparty', cp]], [C('Close', 'closeLine', [cp, TOKEN])])}
            >
              Close line
            </TerminalButton>
          </div>
          {line.status === LineStatusV2.Active && (
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5">
              <TerminalTextField
                label="Credit you extend (move any time)"
                inputMode="decimal"
                mono
                placeholder={`now ${fmt(creditIExtend, 2)}`}
                value={newLimitIn}
                onChange={(e) => setNewLimitIn(e.target.value)}
                suffix="mUSD"
              />
              <TerminalButton
                size="sm"
                variant="secondary"
                disabled={!!busy || newLimit === undefined}
                onClick={() =>
                  newLimit !== undefined &&
                  act('Set my limit', ClearingAction.SetLimit, [cp, TOKEN, newLimit], [['counterparty', cp], ['new limit', `${fmt(newLimit, 2)} mUSD`]], [C('Set limit', 'setMyLimit', [cp, TOKEN, newLimit])]).then(
                    (ok) => ok && setNewLimitIn(''),
                  )
                }
              >
                Set limit
              </TerminalButton>
              <span className="pb-2 text-[10px] text-terminal-text-muted">lowering only blocks new debt</span>
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] items-end gap-1.5">
            <TerminalTextField
              label={`Routing cap toward ${short(cp)} (now ${fmt(myRouteCap, 2)})`}
              inputMode="decimal"
              placeholder="0 = never route through me to them"
              mono
              value={capIn}
              onChange={(e) => setCapIn(e.target.value)}
              suffix="mUSD"
            />
            <TerminalButton
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() =>
                act('Set route cap', ClearingAction.SetRouteCap, [cp, TOKEN, cap ?? 0n], [['toward', cp], ['max routed debt', `${fmt(cap ?? 0n, 2)} mUSD`]], [C('Route cap', 'setRouteCap', [cp, TOKEN, cap ?? 0n])])
              }
            >
              Set cap
            </TerminalButton>
          </div>
        </div>
      )}
    </TerminalPanel>
  )
}

function Balance({ iOwe, theyOwe, creditIExtend, creditTheyExtend }: { iOwe: bigint; theyOwe: bigint; creditIExtend: bigint; creditTheyExtend: bigint }) {
  const left = creditTheyExtend > 0n ? Math.min(1, toNum(iOwe) / toNum(creditTheyExtend)) : iOwe > 0n ? 1 : 0
  const right = creditIExtend > 0n ? Math.min(1, toNum(theyOwe) / toNum(creditIExtend)) : theyOwe > 0n ? 1 : 0
  return (
    <div className="grid gap-1">
      <div className="flex justify-between font-mono text-[11px]">
        <span className={iOwe > 0n ? 'text-terminal-down' : 'text-terminal-text-muted'}>you owe {fmt(iOwe, 4)}</span>
        <span className={theyOwe > 0n ? 'text-terminal-up' : 'text-terminal-text-muted'}>they owe {fmt(theyOwe, 4)}</span>
      </div>
      <div className="relative grid h-3 grid-cols-2 overflow-hidden rounded-full bg-terminal-panel">
        <div className="relative">
          <div className="absolute inset-y-0 right-0 bg-terminal-down/70" style={{ width: `${left * 100}%` }} />
        </div>
        <div className="relative border-l border-terminal-text/40">
          <div className="absolute inset-y-0 left-0 bg-terminal-up/70" style={{ width: `${right * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

function Escrow({ me, act, busy }: { me?: Address; act: Act; busy: string | null }) {
  const { data: claimable } = useReadContract({ ...ch, functionName: 'claimable', args: [me!, TOKEN], query: { enabled: !!me, refetchInterval: 15_000 } })
  const amount = (claimable as bigint | undefined) ?? 0n
  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Escrow" title="Repayments owed to you" description="Debtors settle into escrow (pull payments). Withdraw to any address." />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-lg text-terminal-text">{fmt(amount, 4)} mUSD</span>
        <TerminalButton
          variant="secondary"
          disabled={!me || amount === 0n || !!busy}
          onClick={() => me && act('Withdraw', ClearingAction.Withdraw, [TOKEN, me], [['token', 'mUSD'], ['to', me]], [call('Withdraw', CH, CHA, 'withdraw', [TOKEN, me])])}
        >
          Withdraw
        </TerminalButton>
      </div>
    </TerminalPanel>
  )
}

function Routing({ me, act, busy }: { me?: Address; act: Act; busy: string | null }) {
  const { data } = useReadContract({ ...ch, functionName: 'routing', args: [me!, TOKEN], query: { enabled: !!me, refetchInterval: 20_000 } })
  const [enabled, feeBps] = ((data as readonly [boolean, number] | undefined) ?? [false, 0]) as [boolean, number]
  const [feeIn, setFeeIn] = useState('')
  const fee = feeIn === '' ? feeBps : Math.round(Number(feeIn) * 100)
  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Routing"
        title={enabled ? `Routing on · ${feeBps / 100}% fee` : 'Routing off'}
        description="Earn a fee for passing payments through your lines. You also set a cap per counterparty (in each line) on how much routed debt you'll carry toward them."
      />
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5">
        <TerminalTextField label="Fee" inputMode="decimal" mono placeholder={String(feeBps / 100)} value={feeIn} onChange={(e) => setFeeIn(e.target.value)} suffix="%" />
        <TerminalButton
          size="sm"
          variant="secondary"
          disabled={!me || !!busy || fee > 1000 || fee < 0}
          onClick={() => act('Enable routing', ClearingAction.SetRouting, [TOKEN, true, fee], [['token', 'mUSD'], ['fee', `${fee / 100}%`]], [call('Routing', CH, CHA, 'setRoutingPolicy', [TOKEN, true, fee])])}
        >
          {enabled ? 'Update' : 'Enable'}
        </TerminalButton>
        <TerminalButton
          size="sm"
          variant="ghost"
          disabled={!me || !!busy || !enabled}
          onClick={() => act('Disable routing', ClearingAction.SetRouting, [TOKEN, false, 0], [['token', 'mUSD'], ['routing', 'off']], [call('Routing', CH, CHA, 'setRoutingPolicy', [TOKEN, false, 0])])}
        >
          Disable
        </TerminalButton>
      </div>
      {fee > 1000 && <span className="text-xs text-terminal-down">Max routing fee is 10%.</span>}
    </TerminalPanel>
  )
}

function PathPay({ me, act, busy }: { me?: Address; act: Act; busy: string | null }) {
  const [hops, setHops] = useState<string[]>(['', ''])
  const [amtIn, setAmtIn] = useState('')
  const amt = parseAmount(amtIn)
  const path = useMemo(() => (me ? [me, ...hops.map((h) => h.trim())] : []), [me, hops])
  const valid = path.length >= 3 && path.every((p) => isAddress(p))
  const { data: quote, error } = useReadContract({
    ...ch,
    functionName: 'quotePath',
    args: [TOKEN, path as Address[], amt ?? 0n],
    query: { enabled: valid && !!amt, refetchInterval: 15_000 },
  })
  const q = quote as readonly [readonly bigint[], bigint] | undefined
  const fee = q?.[1]
  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Route" title="Pay through intermediaries" description="Atomic: every hop settles in one transaction or none do. Last address is the payee." />
      {hops.map((h, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-1.5">
          <TerminalTextField
            label={i === hops.length - 1 ? 'Payee' : `Via ${i + 1}`}
            placeholder="0x…"
            mono
            value={h}
            onChange={(e) => setHops((hs) => hs.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {hops.length > 2 && (
            <TerminalButton size="sm" variant="ghost" onClick={() => setHops((hs) => hs.filter((_, j) => j !== i))}>
              ✕
            </TerminalButton>
          )}
        </div>
      ))}
      {hops.length < 7 && (
        <button type="button" className="justify-self-start text-[11px] text-terminal-accent" onClick={() => setHops((hs) => [...hs.slice(0, -1), '', hs[hs.length - 1]])}>
          + add intermediary
        </button>
      )}
      <TerminalTextField label="Payee receives" inputMode="decimal" mono placeholder="0.0" value={amtIn} onChange={(e) => setAmtIn(e.target.value)} suffix="mUSD" />
      <TerminalInset className="grid gap-1 p-3 text-xs">
        <TerminalKeyValueRow label="Routing fees" value={fee !== undefined ? `${fmt(fee, 6)} mUSD` : error ? 'route unavailable' : '—'} />
        <TerminalKeyValueRow label="You owe the first hop" value={q ? `${fmt(q[0][0], 6)} mUSD` : '—'} />
      </TerminalInset>
      <TerminalButton
        variant="primary"
        disabled={!me || !valid || !amt || fee === undefined || !!busy}
        onClick={() =>
          amt &&
          fee !== undefined &&
          act(
            'Routed payment',
            ClearingAction.PayPath,
            [TOKEN, path, amt, fee],
            [['path', path.map((p) => short(p)).join(' → ')], ['payee receives', `${fmt(amt)} mUSD`], ['max fee', `${fmt(fee, 6)} mUSD`]],
            [call('Pay path', CH, CHA, 'payPath', [TOKEN, path, amt, fee])],
          ).then((ok) => ok && setAmtIn(''))
        }
      >
        Send routed payment
      </TerminalButton>
    </TerminalPanel>
  )
}

/** W3 lifecycle indicator: where this line is, and the next legal step for ME. */
function Lifecycle({ line, me, iOwe, theyOwe }: { line: LineV2; me: Address; iOwe: bigint; theyOwe: bigint }) {
  const now = Date.now() / 1000
  const mine = line.proposer.toLowerCase() === me.toLowerCase()
  const demand = line.demandTs > 0n
  const byMe = demand && line.demandBy.toLowerCase() === me.toLowerCase()
  const ends = demand ? Number(line.demandTs) + Number(line.grace) : 0
  const S = LineStatusV2
  const stage =
    line.status === S.Proposed ? 1 : line.status === S.Active ? (demand ? 3 : 2) : line.status === S.Defaulted ? 4 : line.status === S.Closed ? 5 : 0
  let next = 'Propose terms to open a line.'
  if (line.status === S.Proposed) next = mine ? 'Waiting for them to accept, reject or counter. You can cancel.' : 'Review the terms: accept, counter-propose or reject.'
  else if (line.status === S.Active && !demand) next = theyOwe > 0n ? 'Operating. They owe you — you may demand settlement, or clear cycles.' : iOwe > 0n ? 'Operating. Settle any time; clear cycles to reduce gross debt.' : 'Operating, nothing owed. Pay on credit, or close the line.'
  else if (line.status === S.Active && demand && !byMe) next = now < ends ? `Settle before ${new Date(ends * 1000).toLocaleString()} to avoid default.` : 'Grace elapsed — settle now; they can record a default.'
  else if (line.status === S.Active && demand && byMe) next = now < ends ? `In grace until ${new Date(ends * 1000).toLocaleString()}.` : 'Grace elapsed — mark default, or write off.'
  else if (line.status === S.Defaulted) next = iOwe > 0n ? 'You are in default — settle in full to cure (closes the line).' : 'Counterparty in default — await cure, or write off.'
  else if (line.status === S.Closed) next = 'Closed. Propose new terms to reopen.'
  const steps = ['Proposed', 'Active', 'Demand', 'Default', 'Closed']
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1">
        {steps.map((st, i) => {
          const idx = i + 1
          const on = idx === stage
          const past = stage > idx && !(idx === 4 && stage === 5 && line.status !== S.Defaulted)
          return (
            <div key={st} className="flex flex-1 items-center gap-1">
              <div className={`h-1.5 flex-1 rounded-full ${on ? 'bg-terminal-accent' : past ? 'bg-terminal-accent/40' : 'bg-terminal-panel'}`} />
              <span className={`text-[9px] uppercase tracking-wide ${on ? 'text-terminal-accent' : 'text-terminal-text-muted'}`}>{st}</span>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-terminal-text-secondary">
        <span className="font-semibold text-terminal-text">Next: </span>
        {next}
      </p>
    </div>
  )
}
