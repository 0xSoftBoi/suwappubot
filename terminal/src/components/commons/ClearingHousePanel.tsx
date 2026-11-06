import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useConfig, useReadContract, useReadContracts } from 'wagmi'
import { signTypedData } from 'wagmi/actions'
import { createPublicClient, http, type Abi, type Address, type Hex } from 'viem'
import {
  ClearingAction,
  FLAG_CLEARABLE,
  LineStatusV2,
  buildIntent,
  clearingHouseAbi,
  clearingHouseDeployments,
  feeRateFromApr,
  intentTypedData,
} from '@suwappu/primitives-client'
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
  addressUrl,
  aprFromPerSecond,
  COMMONS,
  COMMONS_CHAIN,
  fmt,
  isAddress,
  parseAmount,
  short,
  toNum,
} from './contracts'
import { approveIfNeeded, call, useCommonsTx } from './useCommonsTx'

/**
 * Commons v2 · CommonsClearingHouse (layer 1) front end.
 * Spec: docs/plans/commons-v2.md §2. Unit of account here: test mUSD.
 *
 * Every user action can either be sent as a tx, or — in relay mode — signed as
 * an EIP-712 intent that any relayer (chat bot, agent) can submit via execute().
 * Relay mode always shows the decoded params before signing (the contract signs
 * a params hash, so the UI is where the user sees what they authorise).
 */

const DEPLOYMENT = clearingHouseDeployments[COMMONS_CHAIN.id]
const CH = DEPLOYMENT.address
const TOKEN = COMMONS.reserveAsset
const CHA = clearingHouseAbi as unknown as Abi
const ch = { address: CH, abi: clearingHouseAbi, chainId: COMMONS_CHAIN.id } as const

const STATUS_LABEL: Record<number, string> = {
  [LineStatusV2.None]: 'No line',
  [LineStatusV2.Proposed]: 'Proposed',
  [LineStatusV2.Active]: 'Active',
  [LineStatusV2.Closed]: 'Closed',
  [LineStatusV2.Defaulted]: 'Defaulted',
}

type Run = ReturnType<typeof useCommonsTx>['run']
type Step = Parameters<Run>[1][number]

type LineV2 = {
  limitLo: bigint
  limitHi: bigint
  balance: bigint
  feeRate: bigint
  grace: bigint
  lastAccrual: bigint
  demandTs: bigint
  demandBy: Address
  status: number
  flags: number
  nonce: number
  proposer: Address
  termsHash: Hex
}

type SignedIntent = { label: string; decoded: [string, string][]; json: string }

/** Send as a tx, or (relay mode) sign the equivalent intent and surface it. */
function useAct(relay: boolean, onSigned: (s: SignedIntent) => void) {
  const { run, busy, address } = useCommonsTx()
  const config = useConfig()
  const act = async (
    label: string,
    action: ClearingAction,
    values: readonly unknown[],
    decoded: [string, string][],
    steps: Step[],
  ): Promise<boolean> => {
    if (!relay) return run(label, steps)
    if (!address) {
      toast.error('Connect a wallet first')
      return false
    }
    try {
      const it = buildIntent(address, action, values)
      const signature = await signTypedData(config, intentTypedData(it, COMMONS_CHAIN.id, CH) as never)
      const json = JSON.stringify(
        { chainId: COMMONS_CHAIN.id, clearingHouse: CH, intent: it, signature },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      )
      onSigned({ label, decoded, json })
      toast.success(`${label}: intent signed — hand it to any relayer`)
      return true
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      return false
    }
  }
  return { act, run, busy, address }
}

export function ClearingHousePanel() {
  const [relay, setRelay] = usePersistentState<boolean>('commons:v2:relay', false)
  const [signed, setSigned] = useState<SignedIntent | null>(null)
  const { act, run, busy, address } = useAct(relay, setSigned)
  const [cpInput, setCpInput] = useState('')
  const cp = isAddress(cpInput) && cpInput.toLowerCase() !== address?.toLowerCase() ? (cpInput.trim() as Address) : undefined

  return (
    <div className="grid min-h-0 grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex min-h-0 flex-col gap-1.5 md:gap-2 [&>*]:shrink-0">
        <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
          <TerminalPanelHeader
            eyebrow="Commons v2 · Layer 1"
            title="Clearing House"
            description="Credit lines bound to the exact terms you accept, payments routed through intermediaries who opt in, and permissionless clearing of debt cycles — every leg reduced, nobody's net position moved. Repayment goes to escrow you withdraw, so no one can block being paid and then claim default."
            meta={<a href={addressUrl(CH)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-terminal-text-muted hover:text-terminal-accent">{short(CH)} ↗</a>}
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={relay} onChange={(e) => setRelay(e.target.checked)} />
            <span>
              <span className="font-semibold text-terminal-text">Relay mode</span>
              <span className="text-terminal-text-muted"> — sign actions as EIP-712 intents instead of sending transactions. Anyone (the bot, an agent) can relay them; you pay no gas. The decoded parameters are shown before you sign.</span>
            </span>
          </label>
          <TerminalTextField label="Counterparty address" placeholder="0x…" mono value={cpInput} onChange={(e) => setCpInput(e.target.value)} />
        </TerminalPanel>

        {signed && <SignedIntentCard s={signed} onClose={() => setSigned(null)} />}

        {!address ? (
          <TerminalPanel className="p-[var(--terminal-space-card)]">
            <TerminalEmptyState title="Connect a wallet" description="Lines are between your address and a counterparty's." />
          </TerminalPanel>
        ) : (
          <>
            {cp && <LineView me={address} cp={cp} act={act} run={run} busy={busy} relay={relay} />}
            <MyLines me={address} onPick={setCpInput} selected={cp} />
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-1.5 md:gap-2 [&>*]:shrink-0">
        <Escrow me={address} act={act} busy={busy} />
        <Routing me={address} act={act} busy={busy} />
        <PathPay me={address} act={act} busy={busy} />
        <ClearCycle me={address} run={run} busy={busy} />
      </div>
    </div>
  )
}

type Act = ReturnType<typeof useAct>['act']

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

/**
 * Log queries go to publicnode: sepolia.base.org caps eth_getLogs at a 200-block
 * range (measured), which can't cover the contract's history. publicnode serves
 * wide ranges with CORS; we still scan in windows so history keeps fitting.
 * Long-term this belongs in an indexer.
 */
const logsClient = createPublicClient({ chain: COMMONS_CHAIN, transport: http('https://base-sepolia-rpc.publicnode.com') })
const LOG_WINDOW = 45_000n

async function getLogsWindowed(args: { proposer?: Address; counterparty?: Address }) {
  const ev = clearingHouseAbi.find((x) => x.type === 'event' && x.name === 'LineProposed')!
  const head = await logsClient.getBlockNumber()
  const out: unknown[] = []
  for (let from = DEPLOYMENT.block; from <= head; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n > head ? head : from + LOG_WINDOW - 1n
    out.push(...(await logsClient.getLogs({ address: CH, event: ev as never, args, fromBlock: from, toBlock: to } as never)))
  }
  return out
}

/** Lines involving me, rebuilt from LineProposed events (proposer or counterparty). */
function MyLines({ me, onPick, selected }: { me: Address; onPick: (a: string) => void; selected?: Address }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['commons-v2-lines', me],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [asProposer, asCounterparty] = await Promise.all([
        getLogsWindowed({ proposer: me }),
        getLogsWindowed({ counterparty: me }),
      ])
      const set = new Map<string, Address>()
      for (const l of [...asProposer, ...asCounterparty] as unknown as { args: { proposer: Address; counterparty: Address; token: Address } }[]) {
        if (l.args.token.toLowerCase() !== TOKEN.toLowerCase()) continue
        const other = l.args.proposer.toLowerCase() === me.toLowerCase() ? l.args.counterparty : l.args.proposer
        set.set(other.toLowerCase(), other)
      }
      return [...set.values()]
    },
  })
  const others = data ?? []
  const { data: rows } = useReadContracts({
    contracts: others.flatMap((o) => [
      { ...ch, functionName: 'getLine', args: [me, o, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [me, o, TOKEN] },
      { ...ch, functionName: 'owedBy', args: [o, me, TOKEN] },
    ]),
    query: { enabled: others.length > 0, refetchInterval: 15_000 },
  })

  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Your lines" title={`${others.length} counterpart${others.length === 1 ? 'y' : 'ies'}`} />
      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-terminal-panel" />
      ) : error ? (
        <p className="text-xs text-terminal-warn">Couldn't load history from the RPC ({String((error as Error).message).slice(0, 80)}). Paste a counterparty above.</p>
      ) : others.length === 0 ? (
        <TerminalEmptyState title="No lines yet" description="Paste a counterparty's address above to propose one." />
      ) : (
        <div className="grid gap-1">
          {others.map((o, i) => {
            const line = rows?.[i * 3]?.result as LineV2 | undefined
            const iOwe = (rows?.[i * 3 + 1]?.result as bigint | undefined) ?? 0n
            const theyOwe = (rows?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n
            const isSel = selected?.toLowerCase() === o.toLowerCase()
            return (
              <button
                key={o}
                type="button"
                onClick={() => onPick(o)}
                className={`terminal-theme-control flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${isSel ? 'ring-1 ring-terminal-accent' : ''}`}
              >
                <span className="font-mono text-terminal-text">{short(o)}</span>
                <span className="flex items-center gap-2 font-mono">
                  {iOwe > 0n && <span className="text-terminal-down">−{fmt(iOwe, 2)}</span>}
                  {theyOwe > 0n && <span className="text-terminal-up">+{fmt(theyOwe, 2)}</span>}
                  <TerminalStatusPill tone={statusTone(line?.status)}>{STATUS_LABEL[line?.status ?? 0]}</TerminalStatusPill>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </TerminalPanel>
  )
}

function statusTone(s?: number) {
  return s === LineStatusV2.Active ? 'up' : s === LineStatusV2.Defaulted ? 'down' : s === LineStatusV2.Proposed ? 'warm' : 'neutral'
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
        title={`You ⇄ ${short(cp)}`}
        meta={<TerminalStatusPill tone={statusTone(line.status)}>{STATUS_LABEL[line.status]}</TerminalStatusPill>}
      />

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
            </div>
          </div>
        ))}

      {(line.status === LineStatusV2.Active || line.status === LineStatusV2.Defaulted) && (
        <div className="grid gap-2">
          <TerminalTextField label="Amount" inputMode="decimal" placeholder="0.0" mono value={amtIn} onChange={(e) => setAmtIn(e.target.value)} suffix="mUSD" />
          <div className="flex flex-wrap gap-1.5">
            {line.status === LineStatusV2.Active && (
              <TerminalButton
                variant="primary"
                disabled={!!busy || !amt}
                onClick={() =>
                  amt &&
                  act('Pay on credit', ClearingAction.Pay, [cp, TOKEN, amt], [['to', cp], ['amount', `${fmt(amt)} mUSD`]], [C('Pay', 'pay', [cp, TOKEN, amt])]).then(
                    (ok) => ok && setAmtIn(''),
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

/** Permissionless: verify each leg against live owedBy, clear the cycle minimum. */
function ClearCycle({ me, run, busy }: { me?: Address; run: Run; busy: string | null }) {
  const [nodes, setNodes] = useState<string[]>(() => [me ?? '', '', ''])
  const valid = nodes.length >= 3 && nodes.every(isAddress) && new Set(nodes.map((n) => n.toLowerCase())).size === nodes.length
  const legs = useMemo(() => (valid ? nodes.map((n, i) => [n, nodes[(i + 1) % nodes.length]] as [Address, Address]) : []), [nodes, valid])
  const { data } = useReadContracts({
    contracts: legs.map(([d, c]) => ({ ...ch, functionName: 'owedBy' as const, args: [d, c, TOKEN] as const })),
    query: { enabled: legs.length > 0, refetchInterval: 10_000 },
  })
  const owed = legs.map((_, i) => data?.[i]?.result as bigint | undefined)
  const min = owed.length && owed.every((o) => o !== undefined) ? owed.reduce((a, b) => (b! < a! ? b : a))! : undefined

  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Clearing"
        title="Clear a debt cycle"
        description="Each address owes the next; the last owes the first. Every leg drops by the smallest debt in the loop and nobody's net position changes — so anyone may submit it. Lines must be clearable."
      />
      {nodes.map((n, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-1.5">
          <TerminalTextField
            label={i === 0 ? 'Start' : 'Then'}
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
      {min !== undefined && (
        <TerminalInset className="grid gap-1 p-3 text-xs">
          {legs.map(([d, c], i) => (
            <TerminalKeyValueRow key={i} label={`${short(d)} → ${short(c)}`} value={`${fmt(owed[i], 4)} → ${fmt(owed[i]! - min, 4)}`} />
          ))}
          <TerminalKeyValueRow label="Cleared on every leg" value={`${fmt(min, 4)} mUSD`} />
        </TerminalInset>
      )}
      <TerminalButton
        variant="primary"
        disabled={!me || !valid || !min || !!busy}
        onClick={() =>
          min &&
          run('Clear cycle', [
            call('Clear', CH, CHA, 'clear', [TOKEN, legs.map(([debtor, creditor]) => ({ debtor, creditor, amount: min }))]),
          ])
        }
      >
        {min === 0n ? 'A leg owes nothing — nothing to clear' : 'Clear cycle'}
      </TerminalButton>
    </TerminalPanel>
  )
}
