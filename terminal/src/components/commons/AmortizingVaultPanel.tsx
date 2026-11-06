import { useMemo, useState } from 'react'
import { useReadContracts } from 'wagmi'
import type { Abi, Address } from 'viem'
import {
  TerminalButton,
  TerminalEmptyState,
  TerminalInset,
  TerminalKeyValueRow,
  TerminalMetricCard,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalSegmentedTabs,
  TerminalStatusPill,
  TerminalTextField,
} from '../foundation'
import {
  amortizingVaultAbi,
  aprFromPerSecond,
  COMMONS,
  COMMONS_CHAIN,
  deadline,
  erc20Abi,
  erc4626Abi,
  fmt,
  parseAmount,
  pct,
  short,
  toNum,
  WAD,
} from './contracts'
import { approveIfNeeded, call, useCommonsTx } from './useCommonsTx'

const vault = { address: COMMONS.amortizingVault, abi: amortizingVaultAbi, chainId: COMMONS_CHAIN.id } as const
const y4626 = { address: COMMONS.collateralVault, abi: erc4626Abi, chainId: COMMONS_CHAIN.id } as const
const musd = { address: COMMONS.reserveAsset, abi: erc20Abi, chainId: COMMONS_CHAIN.id } as const
const VA = amortizingVaultAbi as Abi

/** Newest N position ids scanned — there is no per-owner index on-chain. */
const SCAN = 100

type Position = {
  id: bigint
  owner: Address
  shares: bigint
  value: bigint
  debt: bigint
  pending: bigint
}

export function AmortizingVaultPanel() {
  const { run, busy, address } = useCommonsTx()

  const { data } = useReadContracts({
    contracts: [
      { ...vault, functionName: 'borrowRate' },
      { ...vault, functionName: 'maxLtv' },
      { ...vault, functionName: 'liqLtv' },
      { ...vault, functionName: 'liqBonus' },
      { ...vault, functionName: 'poolAssets' },
      { ...vault, functionName: 'totalDebtAssets' },
      { ...vault, functionName: 'cash' },
      { ...vault, functionName: 'totalLendShares' },
      { ...vault, functionName: 'nextPositionId' },
      { ...y4626, functionName: 'convertToAssets', args: [WAD] },
    ],
    query: { refetchInterval: 15_000 },
  })
  const [borrowRate, maxLtv, liqLtv, liqBonus, poolAssets, totalDebt, cash, totalLendShares, nextId, sharePrice] = (
    data ?? []
  ).map((r) => r.result) as (bigint | undefined)[]

  const { data: mine } = useReadContracts({
    contracts: [
      { ...vault, functionName: 'lendShares', args: [address!] },
      { ...musd, functionName: 'balanceOf', args: [address!] },
      { ...y4626, functionName: 'balanceOf', args: [address!] },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  const [myLendShares, myMusd, myYmusd] = (mine ?? []).map((r) => r.result) as (bigint | undefined)[]
  const myLendValue =
    myLendShares !== undefined && totalLendShares && poolAssets !== undefined
      ? (myLendShares * poolAssets) / totalLendShares
      : undefined

  // ---- position scan
  const ids = useMemo(() => {
    const n = nextId ?? 0n
    const from = n > BigInt(SCAN) ? n - BigInt(SCAN) : 0n
    const out: bigint[] = []
    for (let i = n - 1n; i >= from; i--) out.push(i)
    return out
  }, [nextId])
  const { data: raw } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...vault, functionName: 'positions', args: [id] },
      { ...vault, functionName: 'debtOf', args: [id] },
      { ...vault, functionName: 'pendingYield', args: [id] },
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 15_000 },
  })
  const positions: Position[] = useMemo(() => {
    if (!raw) return []
    return ids
      .map((id, i) => {
        const p = raw[i * 3]?.result as readonly [Address, bigint, bigint, bigint] | undefined
        if (!p || p[1] === 0n) return null
        const shares = p[1]
        return {
          id,
          owner: p[0],
          shares,
          value: sharePrice ? (shares * sharePrice) / WAD : 0n,
          debt: (raw[i * 3 + 1]?.result as bigint) ?? 0n,
          pending: (raw[i * 3 + 2]?.result as bigint) ?? 0n,
        }
      })
      .filter((p): p is Position => p !== null)
  }, [raw, ids, sharePrice])
  const [scopePick, setScope] = useState<'mine' | 'all'>('mine')
  // Signed out there is no "mine" — show everyone's positions (the keeper view).
  const scope = address ? scopePick : 'all'
  const shown = scope === 'mine' ? positions.filter((p) => p.owner.toLowerCase() === address?.toLowerCase()) : positions

  const utilization = poolAssets && totalDebt !== undefined ? Number(totalDebt) / Number(poolAssets) : undefined

  return (
    <div className="grid min-h-0 grid-cols-1 gap-1.5 md:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="flex min-h-0 flex-col gap-1.5 md:gap-2">
        <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
          <TerminalPanelHeader
            eyebrow="Primitive 02"
            title="AmortizingVault"
            description="Loans that pay themselves off. Post yield-bearing ERC-4626 shares as collateral, borrow the underlying, and anyone can call amortize() to sweep the yield your collateral earned into your debt. At zero debt the position unlocks. No price oracle: debt and collateral share a denomination."
          />
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
            <TerminalMetricCard label="Pool assets" value={`${fmt(poolAssets, 2)} mUSD`} />
            <TerminalMetricCard label="Borrowed" value={`${fmt(totalDebt, 2)} mUSD`} detail={utilization !== undefined ? `${(utilization * 100).toFixed(1)}% utilized` : undefined} />
            <TerminalMetricCard label="Borrow APR (simple)" value={aprFromPerSecond(borrowRate)} tone="warm" />
            <TerminalMetricCard label="ymUSD share price" value={`${fmt(sharePrice, 6)}`} detail="collateral → mUSD" tone="sky" />
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-xs">
            <TerminalKeyValueRow label="Max LTV" value={pct(maxLtv, 0)} />
            <TerminalKeyValueRow label="Liquidation LTV" value={pct(liqLtv, 0)} />
            <TerminalKeyValueRow label="Liq. bonus" value={pct(liqBonus, 1)} />
          </div>
        </TerminalPanel>

        <TerminalPanel className="flex min-h-0 flex-1 flex-col gap-2 p-[var(--terminal-space-card)]">
          <TerminalPanelHeader
            eyebrow="Positions"
            title={scope === 'mine' ? 'Your positions' : `All positions (latest ${SCAN})`}
            meta={
              <TerminalSegmentedTabs
                activeId={scope}
                options={[
                  { id: 'mine', label: 'Mine' },
                  { id: 'all', label: 'Keeper view' },
                ]}
                onChange={(id) => setScope(id as 'mine' | 'all')}
              />
            }
          />
          {shown.length === 0 ? (
            <TerminalEmptyState
              title={scope === 'mine' ? 'No open positions' : 'No positions yet'}
              description={scope === 'mine' ? 'Wrap mUSD into ymUSD, then open a position on the right.' : 'Positions opened by anyone show up here.'}
            />
          ) : (
            <div className="grid min-h-0 gap-1.5 overflow-y-auto">
              {shown.map((p) => (
                <PositionRow
                  key={String(p.id)}
                  p={p}
                  maxLtv={maxLtv}
                  liqLtv={liqLtv}
                  liqBonus={liqBonus}
                  isMine={p.owner.toLowerCase() === address?.toLowerCase()}
                  busy={!!busy}
                  run={run}
                />
              ))}
            </div>
          )}
        </TerminalPanel>
      </div>

      <div className="flex min-h-0 flex-col gap-1.5 md:gap-2 [&>*]:shrink-0">
        <BorrowTicket maxLtv={maxLtv} sharePrice={sharePrice} cash={cash} myMusd={myMusd} myYmusd={myYmusd} run={run} busy={busy} address={address} />
        <LendTicket myLendShares={myLendShares} myLendValue={myLendValue} myMusd={myMusd} run={run} busy={busy} address={address} />
        <SimulateYield run={run} busy={busy} address={address} myMusd={myMusd} />
      </div>
    </div>
  )
}

type Run = ReturnType<typeof useCommonsTx>['run']

function PositionRow({
  p,
  maxLtv,
  liqLtv,
  liqBonus,
  isMine,
  busy,
  run,
}: {
  p: Position
  maxLtv?: bigint
  liqLtv?: bigint
  liqBonus?: bigint
  isMine: boolean
  busy: boolean
  run: Run
}) {
  const [input, setInput] = useState('')
  const ltv = p.value > 0n ? toNum((p.debt * WAD) / p.value) : 0
  const liq = toNum(liqLtv)
  const max = toNum(maxLtv)
  const liquidatable = p.debt > 0n && liqLtv !== undefined && p.debt * WAD > p.value * liqLtv
  const amt = parseAmount(input)
  const tone = liquidatable ? 'down' : p.debt === 0n ? 'up' : ltv > max ? 'warm' : 'neutral'
  const coveredByPending = p.debt > 0n ? Math.min(1, toNum(p.pending) / toNum(p.debt)) : 1

  return (
    <TerminalInset className="grid gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-terminal-text">#{String(p.id)}</span>
          <span className="text-terminal-text-muted">{isMine ? 'you' : short(p.owner)}</span>
          <TerminalStatusPill tone={tone}>{liquidatable ? 'Liquidatable' : p.debt === 0n ? 'Unlocked' : 'Amortizing'}</TerminalStatusPill>
        </div>
        <div className="flex gap-3 font-mono">
          <span>coll {fmt(p.value, 2)}</span>
          <span>debt {fmt(p.debt, 4)}</span>
          <span className="text-terminal-up">+{fmt(p.pending, 4)} yield</span>
        </div>
      </div>
      {/* LTV bar with max + liquidation markers, scaled to 100% */}
      <div className="relative h-2 rounded-full bg-terminal-panel" title={`LTV ${(ltv * 100).toFixed(2)}%`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${liquidatable ? 'bg-terminal-down' : ltv > max ? 'bg-terminal-warn' : 'bg-terminal-accent'}`}
          style={{ width: `${Math.min(100, ltv * 100)}%` }}
        />
        <div className="absolute inset-y-[-3px] w-px bg-terminal-warn" style={{ left: `${max * 100}%` }} />
        <div className="absolute inset-y-[-3px] w-px bg-terminal-down" style={{ left: `${liq * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-terminal-text-muted">
        <span>LTV {(ltv * 100).toFixed(2)}%</span>
        {p.debt > 0n && <span>· pending yield covers {(coveredByPending * 100).toFixed(1)}% of debt</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TerminalButton
          size="sm"
          variant="secondary"
          disabled={busy || p.pending === 0n || p.debt === 0n}
          onClick={() => run(`Amortize #${p.id}`, [call('Amortize', COMMONS.amortizingVault, VA, 'amortize', [p.id])])}
        >
          Amortize
        </TerminalButton>
        {liquidatable && !isMine && (
          <TerminalButton
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(`Liquidate #${p.id}`, [
                // Pad the approval: interest keeps accruing between this read and the block.
                approveIfNeeded(COMMONS.reserveAsset, COMMONS.amortizingVault, (p.debt * 1001n) / 1000n, 'Approve mUSD'),
                call('Liquidate', COMMONS.amortizingVault, VA, 'liquidate', [p.id, p.debt, deadline()]),
              ])
            }
          >
            Liquidate (+{pct(liqBonus, 1)})
          </TerminalButton>
        )}
        {isMine && (
          <>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="decimal"
              placeholder="amount"
              className="terminal-theme-control h-7 w-24 rounded px-2 font-mono text-xs text-terminal-text"
            />
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={busy || !amt || p.debt === 0n}
              onClick={() =>
                amt &&
                run(`Repay #${p.id}`, [
                  approveIfNeeded(COMMONS.reserveAsset, COMMONS.amortizingVault, amt, 'Approve mUSD'),
                  call('Repay', COMMONS.amortizingVault, VA, 'repay', [p.id, amt]),
                ]).then((ok) => ok && setInput(''))
              }
            >
              Repay mUSD
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={busy || !amt}
              onClick={() =>
                amt &&
                run(`Add collateral #${p.id}`, [
                  approveIfNeeded(COMMONS.collateralVault, COMMONS.amortizingVault, amt, 'Approve ymUSD'),
                  call('Add collateral', COMMONS.amortizingVault, VA, 'addCollateral', [p.id, amt]),
                ]).then((ok) => ok && setInput(''))
              }
            >
              Add ymUSD
            </TerminalButton>
            <TerminalButton
              size="sm"
              variant="ghost"
              disabled={busy || !amt}
              onClick={() =>
                amt &&
                run(`Withdraw collateral #${p.id}`, [
                  call('Withdraw', COMMONS.amortizingVault, VA, 'withdrawCollateral', [p.id, amt, deadline()]),
                ]).then((ok) => ok && setInput(''))
              }
            >
              Withdraw ymUSD
            </TerminalButton>
            <span className="font-mono text-[11px] text-terminal-text-muted">{fmt(p.shares, 4)} ymUSD posted</span>
          </>
        )}
      </div>
    </TerminalInset>
  )
}

function BorrowTicket({
  maxLtv,
  sharePrice,
  cash,
  myMusd,
  myYmusd,
  run,
  busy,
  address,
}: {
  maxLtv?: bigint
  sharePrice?: bigint
  cash?: bigint
  myMusd?: bigint
  myYmusd?: bigint
  run: Run
  busy: string | null
  address?: Address
}) {
  const [wrapIn, setWrapIn] = useState('')
  const [collIn, setCollIn] = useState('')
  const [borrowIn, setBorrowIn] = useState('')
  const wrap = parseAmount(wrapIn)
  const coll = parseAmount(collIn)
  const borrow = parseAmount(borrowIn)
  const collValue = coll && sharePrice ? (coll * sharePrice) / WAD : undefined
  const maxBorrow = collValue && maxLtv ? (collValue * maxLtv) / WAD : undefined
  const ltv = collValue && borrow ? toNum((borrow * WAD) / collValue) : undefined
  const tooMuch = !!borrow && maxBorrow !== undefined && borrow > maxBorrow
  const noCash = !!borrow && cash !== undefined && borrow > cash

  return (
    <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Borrow" title="Open a self-repaying loan" />
      <div className="grid gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-terminal-text-muted">Step 1 · wrap mUSD into the yield vault</span>
        <div className="flex gap-1.5">
          <TerminalTextField inputMode="decimal" placeholder="mUSD" mono value={wrapIn} onChange={(e) => setWrapIn(e.target.value)} suffix="mUSD" />
          <TerminalButton
            variant="secondary"
            disabled={!address || !wrap || !!busy || (myMusd ?? 0n) < (wrap ?? 0n)}
            onClick={() =>
              wrap &&
              run('Wrap mUSD → ymUSD', [
                approveIfNeeded(COMMONS.reserveAsset, COMMONS.collateralVault, wrap, 'Approve mUSD'),
                call('Deposit', COMMONS.collateralVault, erc4626Abi as Abi, 'deposit', [wrap, address]),
              ]).then((ok) => ok && setWrapIn(''))
            }
          >
            Wrap
          </TerminalButton>
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-terminal-text-muted">Step 2 · post ymUSD, borrow mUSD</span>
        <TerminalTextField
          label="Collateral"
          inputMode="decimal"
          placeholder="0.0"
          mono
          value={collIn}
          onChange={(e) => setCollIn(e.target.value)}
          suffix={
            myYmusd ? (
              <button type="button" className="text-[11px] text-terminal-accent" onClick={() => setCollIn(String(toNum(myYmusd)))}>
                MAX
              </button>
            ) : (
              'ymUSD'
            )
          }
        />
        <TerminalTextField
          label="Borrow"
          inputMode="decimal"
          placeholder="0.0"
          mono
          value={borrowIn}
          onChange={(e) => setBorrowIn(e.target.value)}
          suffix={
            maxBorrow ? (
              <button type="button" className="text-[11px] text-terminal-accent" onClick={() => setBorrowIn(String(toNum((maxBorrow * 95n) / 100n)))}>
                95% MAX
              </button>
            ) : (
              'mUSD'
            )
          }
        />
      </div>
      <TerminalInset className="grid gap-1 p-3 text-xs">
        <TerminalKeyValueRow label="Collateral value" value={collValue ? `${fmt(collValue, 4)} mUSD` : '—'} />
        <TerminalKeyValueRow label="Max borrow" value={maxBorrow ? `${fmt(maxBorrow, 4)} mUSD` : '—'} />
        <TerminalKeyValueRow label="Opening LTV" value={ltv !== undefined ? `${(ltv * 100).toFixed(2)}%` : '—'} />
        <TerminalKeyValueRow label="Idle pool liquidity" value={`${fmt(cash, 2)} mUSD`} />
      </TerminalInset>
      <TerminalButton
        variant="primary"
        disabled={!address || !coll || !borrow || tooMuch || noCash || !!busy || (myYmusd ?? 0n) < (coll ?? 0n)}
        onClick={() =>
          coll &&
          borrow &&
          run('Open position', [
            approveIfNeeded(COMMONS.collateralVault, COMMONS.amortizingVault, coll, 'Approve ymUSD'),
            call('Open position', COMMONS.amortizingVault, VA, 'openPosition', [coll, borrow, deadline()]),
          ]).then((ok) => {
            if (ok) {
              setCollIn('')
              setBorrowIn('')
            }
          })
        }
      >
        {tooMuch ? 'Above max LTV' : noCash ? 'Not enough pool liquidity' : 'Open position'}
      </TerminalButton>
      <div className="grid gap-1 text-xs">
        <TerminalKeyValueRow label="Your mUSD" value={fmt(myMusd)} />
        <TerminalKeyValueRow label="Your ymUSD" value={fmt(myYmusd)} />
      </div>
    </TerminalPanel>
  )
}

function LendTicket({
  myLendShares,
  myLendValue,
  myMusd,
  run,
  busy,
  address,
}: {
  myLendShares?: bigint
  myLendValue?: bigint
  myMusd?: bigint
  run: Run
  busy: string | null
  address?: Address
}) {
  const [side, setSide] = useState<'supply' | 'withdraw'>('supply')
  const [input, setInput] = useState('')
  const amt = parseAmount(input)
  return (
    <TerminalPanel className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader eyebrow="Lend" title="Supply mUSD to borrowers" description="Earn the borrow rate. Bad debt, if any, is written off pro-rata against lenders." />
      <TerminalSegmentedTabs
        activeId={side}
        options={[
          { id: 'supply', label: 'Supply' },
          { id: 'withdraw', label: 'Withdraw' },
        ]}
        onChange={(id) => setSide(id as 'supply' | 'withdraw')}
      />
      <TerminalTextField
        label={side === 'supply' ? 'mUSD to supply' : 'Lend shares to redeem'}
        inputMode="decimal"
        placeholder="0.0"
        mono
        value={input}
        onChange={(e) => setInput(e.target.value)}
        suffix={
          side === 'withdraw' && myLendShares ? (
            <button type="button" className="text-[11px] text-terminal-accent" onClick={() => setInput(String(toNum(myLendShares)))}>
              MAX
            </button>
          ) : undefined
        }
      />
      <TerminalButton
        variant="secondary"
        disabled={!address || !amt || !!busy || (side === 'supply' ? (myMusd ?? 0n) < (amt ?? 0n) : (myLendShares ?? 0n) < (amt ?? 0n))}
        onClick={() =>
          amt &&
          run(side === 'supply' ? 'Supply mUSD' : 'Withdraw', [
            ...(side === 'supply' ? [approveIfNeeded(COMMONS.reserveAsset, COMMONS.amortizingVault, amt, 'Approve mUSD')] : []),
            call(side === 'supply' ? 'Supply' : 'Withdraw', COMMONS.amortizingVault, VA, side, [amt]),
          ]).then((ok) => ok && setInput(''))
        }
      >
        {side === 'supply' ? 'Supply' : 'Withdraw'}
      </TerminalButton>
      <div className="grid gap-1 text-xs">
        <TerminalKeyValueRow label="Your lend shares" value={fmt(myLendShares)} />
        <TerminalKeyValueRow label="Worth" value={`${fmt(myLendValue)} mUSD`} />
      </div>
    </TerminalPanel>
  )
}

/** Testnet-only: donate mUSD into the 4626 so its share price rises — i.e. "yield". */
function SimulateYield({ run, busy, address, myMusd }: { run: Run; busy: string | null; address?: Address; myMusd?: bigint }) {
  const [input, setInput] = useState('10')
  const amt = parseAmount(input)
  return (
    <TerminalPanel className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
      <TerminalPanelHeader
        eyebrow="Testnet"
        title="Simulate yield"
        description="The test collateral vault earns nothing on its own. Donating mUSD to it raises the ymUSD share price for every holder — exactly what real yield looks like — so you can watch positions pay themselves down."
      />
      <div className="flex gap-1.5">
        <TerminalTextField inputMode="decimal" mono value={input} onChange={(e) => setInput(e.target.value)} suffix="mUSD" />
        <TerminalButton
          variant="ghost"
          disabled={!address || !amt || !!busy || (myMusd ?? 0n) < (amt ?? 0n)}
          onClick={() => amt && run('Donate yield', [call('Donate', COMMONS.reserveAsset, erc20Abi as Abi, 'transfer', [COMMONS.collateralVault, amt])])}
        >
          Donate
        </TerminalButton>
      </div>
    </TerminalPanel>
  )
}
