import { useMemo, useState } from 'react'
import { useReadContracts } from 'wagmi'
import { encodePacked, keccak256, type Abi, type Address } from 'viem'
import {
  TerminalButton,
  TerminalEmptyState,
  TerminalInset,
  TerminalKeyValueRow,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
  TerminalTextField,
} from '../foundation'
import { usePersistentState } from '../../lib/persist'
import {
  aprFromPerSecond,
  COMMONS,
  COMMONS_CHAIN,
  fmt,
  isAddress,
  LINE_STATUS_LABEL,
  LineStatus,
  mutualCreditAbi,
  parseAmount,
  perSecondFromApr,
  short,
  toNum,
} from './contracts'
import { approveIfNeeded, call, useCommonsTx } from './useCommonsTx'

/** Unit of account for lines opened here. Any ERC-20 works on-chain; the UI uses mUSD. */
const TOKEN = COMMONS.reserveAsset
const mc = { address: COMMONS.mutualCredit, abi: mutualCreditAbi, chainId: COMMONS_CHAIN.id } as const
const MC = mutualCreditAbi as Abi

function lineKey(x: Address, y: Address): `0x${string}` {
  const [lo, hi] = x.toLowerCase() < y.toLowerCase() ? [x, y] : [y, x]
  return keccak256(encodePacked(['address', 'address', 'address'], [lo, hi, TOKEN]))
}

type Line = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, Address, Address]

export function MutualCreditPanel() {
  const { run, busy, address } = useCommonsTx()
  const [cpInput, setCpInput] = useState('')
  const [recent, setRecent] = usePersistentState<string[]>('commons:counterparties', [])
  const cp = isAddress(cpInput) && cpInput.toLowerCase() !== address?.toLowerCase() ? (cpInput.trim() as Address) : undefined

  const remember = (a: string) => setRecent((r) => [a, ...r.filter((x) => x.toLowerCase() !== a.toLowerCase())].slice(0, 6))

  return (
    <div className="grid min-h-0 grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex min-h-0 flex-col gap-1.5 md:gap-2">
        <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
          <TerminalPanelHeader
            eyebrow="Primitive 03"
            title="MutualCredit"
            description="Credit between people who trust each other, with no bank in the middle. Two addresses agree on how much each will let the other owe; payments move along the line as IOUs. Anyone can net a cycle of debts (A owes B owes C owes A) so only the residue ever settles in real tokens. Default is a public on-chain record — the base layer for reputation and insurance."
          />
          <TerminalTextField
            label="Counterparty address"
            placeholder="0x…"
            mono
            value={cpInput}
            onChange={(e) => setCpInput(e.target.value)}
          />
          {recent.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {recent.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setCpInput(a)}
                  className="terminal-theme-control rounded px-2 py-0.5 font-mono text-[11px] text-terminal-text-secondary hover:text-terminal-accent"
                >
                  {short(a)}
                </button>
              ))}
            </div>
          )}
        </TerminalPanel>
        {!address ? (
          <TerminalPanel className="p-[var(--terminal-space-card)]">
            <TerminalEmptyState title="Connect a wallet" description="Credit lines are between your address and a counterparty's." />
          </TerminalPanel>
        ) : cp ? (
          <LineView me={address} cp={cp} run={run} busy={busy} onTouched={() => remember(cp)} />
        ) : (
          <TerminalPanel className="p-[var(--terminal-space-card)]">
            <TerminalEmptyState
              title="Pick a counterparty"
              description="Paste an address to view or open a mUSD credit line with them. To try it solo, open a second wallet account and trade IOUs between the two."
            />
          </TerminalPanel>
        )}
      </div>
      <NetCycle me={address} run={run} busy={busy} />
    </div>
  )
}

type Run = ReturnType<typeof useCommonsTx>['run']

function LineView({ me, cp, run, busy, onTouched }: { me: Address; cp: Address; run: Run; busy: string | null; onTouched: () => void }) {
  const key = lineKey(me, cp)
  const { data } = useReadContracts({
    contracts: [
      { ...mc, functionName: 'lines', args: [key] },
      { ...mc, functionName: 'owedBy', args: [me, cp, TOKEN] },
      { ...mc, functionName: 'owedBy', args: [cp, me, TOKEN] },
      { ...mc, functionName: 'defaults', args: [cp] },
      { ...mc, functionName: 'defaults', args: [me] },
    ],
    query: { refetchInterval: 10_000 },
  })
  const line = data?.[0]?.result as Line | undefined
  const iOwe = (data?.[1]?.result as bigint | undefined) ?? 0n
  const theyOwe = (data?.[2]?.result as bigint | undefined) ?? 0n
  const cpDefaults = data?.[3]?.result as bigint | undefined
  const myDefaults = data?.[4]?.result as bigint | undefined

  const [limitIn, setLimitIn] = useState('100')
  const [aprIn, setAprIn] = useState('0')
  const [graceIn, setGraceIn] = useState('7')
  const [amtIn, setAmtIn] = useState('')
  const limit = parseAmount(limitIn)
  const amt = parseAmount(amtIn)

  if (!line) return <TerminalPanel className="h-40 animate-pulse p-[var(--terminal-space-card)]">{null}</TerminalPanel>

  const [limitA, limitB, , feeRate, grace, , demandTs, status, demandBy, proposer] = line
  const meIsLo = me.toLowerCase() < cp.toLowerCase()
  // limitA = credit lo extends to hi (how much hi may owe lo).
  const creditIExtend = meIsLo ? limitA : limitB
  const creditTheyExtend = meIsLo ? limitB : limitA
  const iAmProposer = proposer.toLowerCase() === me.toLowerCase()
  const now = Date.now() / 1000
  const demandOpen = demandTs > 0n
  const iDemanded = demandOpen && demandBy.toLowerCase() === me.toLowerCase()
  const graceEnds = demandOpen ? Number(demandTs) + Number(grace) : undefined
  const canDefault = iDemanded && graceEnds !== undefined && now > graceEnds && theyOwe > 0n && status === LineStatus.Active
  const go = (name: string, steps: Parameters<Run>[1]) => run(name, steps).then((ok) => (ok && onTouched(), ok))

  const tone = status === LineStatus.Active ? 'up' : status === LineStatus.Defaulted ? 'down' : status === LineStatus.Proposed ? 'warm' : 'neutral'

  return (
    <TerminalPanel className="flex min-h-0 flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow={`Line · mUSD`}
        title={`You ⇄ ${short(cp)}`}
        meta={<TerminalStatusPill tone={tone}>{LINE_STATUS_LABEL[status]}</TerminalStatusPill>}
      />

      {(status === LineStatus.Active || status === LineStatus.Defaulted) && (
        <BalanceBar iOwe={iOwe} theyOwe={theyOwe} creditIExtend={creditIExtend} creditTheyExtend={creditTheyExtend} />
      )}

      <TerminalInset className="grid gap-1 p-3 text-xs">
        <TerminalKeyValueRow label="Credit you extend (they may owe you)" value={`${fmt(creditIExtend, 2)} mUSD`} />
        <TerminalKeyValueRow label="Credit they extend (you may owe them)" value={`${fmt(creditTheyExtend, 2)} mUSD`} />
        <TerminalKeyValueRow label="Fee on outstanding balance" value={aprFromPerSecond(feeRate)} />
        <TerminalKeyValueRow label="Settlement grace" value={`${(Number(grace) / 86_400).toFixed(2)} days`} />
        {demandOpen && (
          <TerminalKeyValueRow
            label={iDemanded ? 'You demanded settlement' : 'They demanded settlement'}
            value={graceEnds ? (now > graceEnds ? 'grace elapsed' : `grace ends ${new Date(graceEnds * 1000).toLocaleString()}`) : '—'}
          />
        )}
        <TerminalKeyValueRow label="Their recorded defaults" value={String(cpDefaults ?? '—')} />
        <TerminalKeyValueRow label="Your recorded defaults" value={String(myDefaults ?? '—')} />
      </TerminalInset>

      {(status === LineStatus.None || status === LineStatus.Closed) && (
        <div className="grid gap-2">
          <p className="text-xs text-terminal-text-muted">Terms are fixed forever once accepted. Your counterparty chooses their own limit when they accept.</p>
          <div className="grid grid-cols-3 gap-1.5">
            <TerminalTextField label="Credit you extend" inputMode="decimal" mono value={limitIn} onChange={(e) => setLimitIn(e.target.value)} suffix="mUSD" />
            <TerminalTextField label="Fee APR" inputMode="decimal" mono value={aprIn} onChange={(e) => setAprIn(e.target.value)} suffix="%" />
            <TerminalTextField label="Grace" inputMode="decimal" mono value={graceIn} onChange={(e) => setGraceIn(e.target.value)} suffix="days" />
          </div>
          <TerminalButton
            variant="primary"
            disabled={!!busy || Number(aprIn) > 50 || !(Number(graceIn) >= 0)}
            onClick={() =>
              go('Propose line', [
                call('Propose', COMMONS.mutualCredit, MC, 'proposeLine', [
                  cp,
                  TOKEN,
                  limit ?? 0n,
                  perSecondFromApr(Number(aprIn)),
                  BigInt(Math.round(Number(graceIn) * 86_400)),
                ]),
              ])
            }
          >
            Propose credit line
          </TerminalButton>
          {Number(aprIn) > 50 && <span className="text-xs text-terminal-down">Fee is capped on-chain at ~50% APR.</span>}
        </div>
      )}

      {status === LineStatus.Proposed &&
        (iAmProposer ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-terminal-text-muted">Waiting for {short(cp)} to accept.</span>
            <TerminalButton size="sm" variant="ghost" disabled={!!busy} onClick={() => go('Cancel proposal', [call('Cancel', COMMONS.mutualCredit, MC, 'cancelProposal', [cp, TOKEN])])}>
              Cancel proposal
            </TerminalButton>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-xs text-terminal-text-muted">{short(cp)} offered you {fmt(creditTheyExtend, 2)} mUSD of credit. Choose how much you extend back.</p>
            <TerminalTextField label="Credit you extend" inputMode="decimal" mono value={limitIn} onChange={(e) => setLimitIn(e.target.value)} suffix="mUSD" />
            <div className="flex gap-1.5">
              <TerminalButton variant="primary" disabled={!!busy} onClick={() => go('Accept line', [call('Accept', COMMONS.mutualCredit, MC, 'acceptLine', [cp, TOKEN, limit ?? 0n])])}>
                Accept
              </TerminalButton>
              <TerminalButton variant="ghost" disabled={!!busy} onClick={() => go('Reject proposal', [call('Reject', COMMONS.mutualCredit, MC, 'rejectProposal', [cp, TOKEN])])}>
                Reject
              </TerminalButton>
            </div>
          </div>
        ))}

      {(status === LineStatus.Active || status === LineStatus.Defaulted) && (
        <div className="grid gap-2">
          <TerminalTextField label="Amount" inputMode="decimal" placeholder="0.0" mono value={amtIn} onChange={(e) => setAmtIn(e.target.value)} suffix="mUSD" />
          <div className="flex flex-wrap gap-1.5">
            {status === LineStatus.Active && (
              <TerminalButton
                variant="primary"
                disabled={!!busy || !amt}
                onClick={() => amt && go(`Pay ${fmt(amt)} on credit`, [call('Pay', COMMONS.mutualCredit, MC, 'pay', [cp, TOKEN, amt])]).then((ok) => ok && setAmtIn(''))}
              >
                Pay on credit
              </TerminalButton>
            )}
            <TerminalButton
              variant="secondary"
              disabled={!!busy || !amt || iOwe === 0n}
              onClick={() =>
                amt &&
                go(`Settle ${fmt(amt)} mUSD`, [
                  approveIfNeeded(TOKEN, COMMONS.mutualCredit, amt, 'Approve mUSD'),
                  call('Settle', COMMONS.mutualCredit, MC, 'settle', [cp, TOKEN, amt]),
                ]).then((ok) => ok && setAmtIn(''))
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
              disabled={!!busy || theyOwe === 0n || demandOpen || status !== LineStatus.Active}
              onClick={() => go('Demand settlement', [call('Demand', COMMONS.mutualCredit, MC, 'demandSettlement', [cp, TOKEN])])}
            >
              Demand settlement
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || !canDefault}
              onClick={() => go('Mark default', [call('Mark default', COMMONS.mutualCredit, MC, 'markDefault', [cp, TOKEN])])}
            >
              Mark default
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={!!busy || iOwe > 0n || theyOwe > 0n || status !== LineStatus.Active}
              onClick={() => go('Close line', [call('Close', COMMONS.mutualCredit, MC, 'closeLine', [cp, TOKEN])])}
            >
              Close line
            </TerminalButton>
          </div>
        </div>
      )}
    </TerminalPanel>
  )
}

/** Centered bar: left = you owe them (up to their limit), right = they owe you (up to yours). */
function BalanceBar({ iOwe, theyOwe, creditIExtend, creditTheyExtend }: { iOwe: bigint; theyOwe: bigint; creditIExtend: bigint; creditTheyExtend: bigint }) {
  const left = creditTheyExtend > 0n ? Math.min(1, toNum(iOwe) / toNum(creditTheyExtend)) : 0
  const right = creditIExtend > 0n ? Math.min(1, toNum(theyOwe) / toNum(creditIExtend)) : 0
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
      <div className="flex justify-between font-mono text-[10px] text-terminal-text-muted">
        <span>−{fmt(creditTheyExtend, 0)}</span>
        <span>0</span>
        <span>+{fmt(creditIExtend, 0)}</span>
      </div>
    </div>
  )
}

/** Permissionless netting: anyone submits A→B→…→A; each leg shrinks by the cycle minimum. */
function NetCycle({ me, run, busy }: { me?: Address; run: Run; busy: string | null }) {
  const [nodes, setNodes] = useState<string[]>(() => [me ?? '', '', ''])
  const valid = nodes.length >= 3 && nodes.every(isAddress) && new Set(nodes.map((n) => n.toLowerCase())).size === nodes.length
  const legs = useMemo(() => (valid ? nodes.map((n, i) => [n, nodes[(i + 1) % nodes.length]] as [Address, Address]) : []), [nodes, valid])
  const { data } = useReadContracts({
    contracts: legs.map(([d, c]) => ({ ...mc, functionName: 'owedBy' as const, args: [d, c, TOKEN] as const })),
    query: { enabled: legs.length > 0, refetchInterval: 10_000 },
  })
  const owed = legs.map((_, i) => data?.[i]?.result as bigint | undefined)
  const min = owed.length && owed.every((o) => o !== undefined) ? owed.reduce((a, b) => (b! < a! ? b : a))! : undefined

  return (
    <TerminalPanel className="flex min-h-0 flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Clearing"
        title="Net a debt cycle"
        description="Each address must owe the next; the last owes the first. Every leg is reduced by the smallest debt in the loop. Anyone can submit — no permission from the parties needed, because nobody's net position changes."
      />
      <div className="grid gap-1.5">
        {nodes.map((n, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-1.5">
            <TerminalTextField
              label={i === 0 ? 'Start' : `Then`}
              placeholder="0x…"
              mono
              value={n}
              onChange={(e) => setNodes((ns) => ns.map((x, j) => (j === i ? e.target.value.trim() : x)))}
              suffix={owed[i] !== undefined ? <span className="text-[10px] text-terminal-text-muted">owes next {fmt(owed[i], 2)}</span> : undefined}
            />
            {nodes.length > 3 && (
              <TerminalButton size="sm" variant="ghost" onClick={() => setNodes((ns) => ns.filter((_, j) => j !== i))}>
                ✕
              </TerminalButton>
            )}
          </div>
        ))}
        <button type="button" className="justify-self-start text-[11px] text-terminal-accent" onClick={() => setNodes((ns) => [...ns, ''])}>
          + add hop
        </button>
      </div>
      <TerminalInset className="grid gap-1 p-3 text-xs">
        {legs.length === 0 ? (
          <span className="text-terminal-text-muted">Enter 3+ distinct addresses.</span>
        ) : (
          legs.map(([d, c], i) => (
            <TerminalKeyValueRow key={i} label={`${short(d)} → ${short(c)}`} value={owed[i] !== undefined ? `${fmt(owed[i], 4)} → ${fmt(owed[i]! - (min ?? 0n), 4)}` : '…'} />
          ))
        )}
        {min !== undefined && <TerminalKeyValueRow label="Cleared on every leg" value={`${fmt(min, 4)} mUSD`} />}
      </TerminalInset>
      <TerminalButton
        variant="primary"
        disabled={!me || !valid || !min || !!busy}
        onClick={() => run('Net cycle', [call('Net cycle', COMMONS.mutualCredit, MC, 'netCycle', [TOKEN, nodes])])}
      >
        {min === 0n ? 'A leg owes nothing — nothing to net' : 'Net cycle'}
      </TerminalButton>
    </TerminalPanel>
  )
}
