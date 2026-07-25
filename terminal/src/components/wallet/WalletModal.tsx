import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useWalletSummary, useWithdraw } from '../../hooks/useWallet'
import { TerminalSkeleton } from '../foundation'
import type { WalletBalance } from '../../types/api'

type Tab = 'deposit' | 'withdraw'

// Chains a custodial user can deposit on. `type` picks which omnibus address.
const DEPOSIT_CHAINS: { id: string; label: string; type: 'evm' | 'solana' }[] = [
  { id: 'ethereum', label: 'Ethereum', type: 'evm' },
  { id: 'base', label: 'Base', type: 'evm' },
  { id: 'arbitrum', label: 'Arbitrum', type: 'evm' },
  { id: 'optimism', label: 'Optimism', type: 'evm' },
  { id: 'polygon', label: 'Polygon', type: 'evm' },
  { id: 'bsc', label: 'BSC', type: 'evm' },
  { id: 'solana', label: 'Solana', type: 'solana' },
]

const EXPLORER_TX: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  solana: 'https://solscan.io/tx/',
}

// Destination-address validation, mirrored from the backend so we catch a
// wrong-network paste before it ever leaves the client.
function validAddress(chain: string, addr: string): boolean {
  const a = (addr || '').trim()
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)
  return /^0x[a-fA-F0-9]{40}$/.test(a)
}

function short(a: string) {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', handler)
    setReduced(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return reduced
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Could not copy')
        }
      }}
      className="terminal-theme-control shrink-0 rounded-[7px] px-2.5 py-1 text-xs font-semibold text-terminal-text transition-colors"
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

// Small circular progress ring used inside the hold-to-confirm button. Purely
// decorative (aria-hidden) — the button's own label carries the meaning.
function HoldRing({ progress }: { progress: number }) {
  const size = 18
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity={0.3} strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="currentColor"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
      />
    </svg>
  )
}

// Press-and-hold confirm — friction as a trust signal on an irreversible
// money action. Pure presentation: `onConfirm` is the EXISTING submit
// handler and fires exactly once, only once the hold (or the two-step
// fallback) completes.
//
// A11y: keyboard users can hold Enter/Space for the same timed interaction.
// Under `prefers-reduced-motion: reduce` (any input device) the timed hold is
// replaced entirely by a two-step tap-tap confirm — no animation, no timing
// dependency.
function HoldToConfirmButton({
  onConfirm,
  disabled,
  pending,
  label,
  pendingLabel = 'Submitting…',
  holdMs = 800,
}: {
  onConfirm: () => void
  disabled?: boolean
  pending?: boolean
  label: string
  pendingLabel?: string
  holdMs?: number
}) {
  const reducedMotion = usePrefersReducedMotion()
  const [progress, setProgress] = useState(0)
  const [holding, setHolding] = useState(false)
  const [armed, setArmed] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  const armTimerRef = useRef<number | null>(null)

  const stopHold = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    startRef.current = null
    setHolding(false)
    setProgress(0)
  }, [])

  const tick = useCallback(
    (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const p = Math.min(1, (ts - startRef.current) / holdMs)
      setProgress(p)
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true
          stopHold()
          onConfirm()
        }
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [holdMs, onConfirm, stopHold]
  )

  const startHold = useCallback(() => {
    if (disabled || pending || reducedMotion || rafRef.current !== null) return
    firedRef.current = false
    setHolding(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [disabled, pending, reducedMotion, tick])

  // Unmount cleanup only.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    },
    []
  )

  // Two-step fallback auto-disarms after a few seconds so a stray later tap
  // can't land as an unintended confirm.
  useEffect(() => {
    if (!armed) return
    armTimerRef.current = window.setTimeout(() => setArmed(false), 4000)
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    }
  }, [armed])

  if (reducedMotion) {
    return (
      <>
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => {
            if (armed) {
              setArmed(false)
              onConfirm()
            } else {
              setArmed(true)
            }
          }}
          aria-label={armed ? `Tap again to ${label.toLowerCase()}` : label}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            armed
              ? 'bg-terminal-warn/15 text-terminal-warn ring-1 ring-terminal-warn/50 hover:bg-terminal-warn/20'
              : 'bg-sakura-500 text-terminal-on-accent hover:bg-sakura-600'
          }`}
        >
          {pending ? pendingLabel : armed ? 'Tap again to confirm' : label}
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {armed ? `Armed — tap once more to ${label.toLowerCase()}.` : ''}
        </span>
      </>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onPointerDown={(e) => {
        e.preventDefault()
        startHold()
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          startHold()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') stopHold()
      }}
      aria-label={label}
      className="relative flex w-full touch-none select-none items-center justify-center gap-2 rounded-lg bg-sakura-500 py-2.5 text-sm font-semibold text-terminal-on-accent transition-colors hover:bg-sakura-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <HoldRing progress={progress} />
      <span>{pending ? pendingLabel : holding ? 'Keep holding…' : label}</span>
    </button>
  )
}

type TimelineState = 'done' | 'active' | 'pending'

// Shared "Submitted → Confirming → Credited" row. Used for both the deposit
// guide (no per-tx data exists, so it's an honest "what happens next"
// explainer) and the withdraw result (grounded in the real mutation
// response — see call sites for exactly which step is backed by real data).
function TimelineStep({
  index,
  label,
  note,
  state,
}: {
  index: number
  label: string
  note?: string
  state: TimelineState
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          state === 'done'
            ? 'bg-bull-dim text-bull'
            : state === 'active'
              ? 'pulse-live bg-sakura-500/15 text-sakura-500 ring-1 ring-sakura-500/40'
              : 'bg-terminal-bg-tertiary/50 text-terminal-text-muted'
        }`}
      >
        {state === 'done' ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <div className={`text-[12px] font-medium ${state === 'pending' ? 'text-terminal-text-muted' : 'text-terminal-text'}`}>
          {label}
        </div>
        {note && <div className="text-[11px] text-terminal-text-muted">{note}</div>}
      </div>
    </div>
  )
}

// Deposit panel: chain chips → QR + copyable address + network warning. Balances
// auto-refresh in the background so an incoming deposit shows up on its own.
function DepositView({
  evmAddress,
  solanaAddress,
  balances,
}: {
  evmAddress: string | null
  solanaAddress: string | null
  balances: WalletBalance[]
}) {
  const [chain, setChain] = useState('ethereum')
  const [qr, setQr] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ready'; src: string } | { status: 'error' }
  >({ status: 'idle' })
  const [qrAttempt, setQrAttempt] = useState(0)
  const def = DEPOSIT_CHAINS.find((c) => c.id === chain)!
  const address = def.type === 'solana' ? solanaAddress : evmAddress

  useEffect(() => {
    if (!address) {
      setQr({ status: 'idle' })
      return
    }
    let cancelled = false
    setQr({ status: 'loading' })
    QRCode.toDataURL(address, { margin: 1, width: 220, color: { dark: '#0b1622', light: '#ffffff' } })
      .then((src) => {
        if (!cancelled) setQr({ status: 'ready', src })
      })
      .catch(() => {
        if (!cancelled) setQr({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [address, qrAttempt])

  // Honest, presentation-only "credited" signal: baseline this chain's total
  // balance the moment it's selected, then watch the already-polling wallet
  // summary (useWalletSummary refetches every 15s) for an increase. This is
  // real data (a genuine balance delta), not a per-transaction status — we
  // have no tx hash or mempool visibility for inbound deposits, so we never
  // claim "Submitted"/"Confirming" happened, only that a net credit landed.
  const chainBalanceTotal = useMemo(
    () => balances.filter((b) => b.chain === chain).reduce((sum, b) => sum + b.amount, 0),
    [balances, chain]
  )
  const baselineRef = useRef<number | null>(null)
  const [credited, setCredited] = useState(false)

  useEffect(() => {
    baselineRef.current = chainBalanceTotal
    setCredited(false)
    // Only reset on chain switch — re-baselining on every balance tick would
    // never let a real increase register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain])

  useEffect(() => {
    if (baselineRef.current !== null && chainBalanceTotal > baselineRef.current) {
      setCredited(true)
    }
  }, [chainBalanceTotal])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {DEPOSIT_CHAINS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChain(c.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              chain === c.id
                ? 'bg-sakura-500/15 text-sakura-600 ring-1 ring-sakura-500/40'
                : 'text-terminal-text-secondary hover:bg-terminal-bg-tertiary/60 hover:text-terminal-text'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {address ? (
        <>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-terminal-border bg-terminal-bg p-4">
            {qr.status === 'ready' ? (
              <img src={qr.src} alt="Deposit QR" className="h-40 w-40 rounded-lg" />
            ) : qr.status === 'error' ? (
              <div
                role="status"
                className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-lg border border-terminal-hairline-strong bg-terminal-bg-tertiary/30 px-3 text-center"
              >
                <span className="text-lg" aria-hidden>
                  ⚠
                </span>
                <span className="text-[11px] text-terminal-text-muted">Couldn’t generate QR code</span>
                <button
                  onClick={() => setQrAttempt((n) => n + 1)}
                  className="terminal-theme-control rounded-[7px] px-2.5 py-1 text-[11px] font-semibold text-terminal-text"
                >
                  Retry
                </button>
              </div>
            ) : (
              <TerminalSkeleton width={160} height={160} radius="card" label="Generating deposit QR code" />
            )}
            <div className="flex w-full items-center gap-2 rounded-lg bg-terminal-bg-tertiary/60 px-3 py-2">
              <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-terminal-text">
                {address}
              </span>
              <CopyButton value={address} />
            </div>
          </div>

          <div className="rounded-lg border border-terminal-warn/40 bg-terminal-warn/10 px-3 py-2 text-[11px] text-terminal-warn">
            ⚠ Only send <b>{def.label}</b>-network tokens to this address. Sending from another network
            can lose funds.
          </div>

          {credited && (
            <div className="flex items-center gap-2 rounded-lg border border-bull/30 bg-bull-dim px-3 py-2 text-[12px] font-medium text-bull">
              <span aria-hidden>✓</span> New deposit credited to your balance
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-terminal-text-muted">
              What happens next
            </div>
            <div role="status" aria-live="polite" className="space-y-2 rounded-lg border border-terminal-border bg-terminal-bg p-3">
              <TimelineStep index={1} label="Submitted" note="Sent from your wallet or exchange" state="pending" />
              <TimelineStep index={2} label="Confirming" note="Network confirmation, usually 1–5 min" state="pending" />
              <TimelineStep
                index={3}
                label="Credited"
                note={credited ? 'Detected just now' : 'Appears in your balance automatically'}
                state={credited ? 'done' : 'pending'}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-6 text-center text-sm text-terminal-text-muted">
          No {def.label} deposit address available on your account yet.
        </div>
      )}
    </div>
  )
}

// Withdraw panel: pick a funded balance → amount (+max) → validated destination
// → review → execute. Two-step confirm guards against fat-finger sends; the
// final step also requires a press-and-hold (or its a11y fallback) before
// the submit handler ever fires.
function WithdrawView({
  balances,
  enabled,
}: {
  balances: WalletBalance[]
  enabled: boolean
}) {
  const withdraw = useWithdraw()
  const [selected, setSelected] = useState<WalletBalance | null>(balances[0] ?? null)
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [review, setReview] = useState(false)
  const [done, setDone] = useState<{ txHash: string; chain: string } | null>(null)

  useEffect(() => {
    if (!selected && balances[0]) setSelected(balances[0])
  }, [balances, selected])

  const amountNum = parseFloat(amount)
  const addrValid = selected ? validAddress(selected.chain, toAddress) : false
  const amountValid = selected && amountNum > 0 && amountNum <= selected.amount
  const canReview = !!selected && amountValid && addrValid && !withdraw.isPending

  const submit = useCallback(async () => {
    if (!selected) return
    try {
      const res = await withdraw.mutateAsync({
        chain: selected.chain,
        token: selected.token,
        amount: amountNum,
        toAddress: toAddress.trim(),
      })
      if (res.ok) {
        setDone({ txHash: res.txHash, chain: selected.chain })
        toast.success('Withdrawal submitted')
      } else {
        toast.error('Withdrawal could not be submitted')
      }
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Withdrawal failed. Your balance is unchanged.')
      setReview(false)
    }
  }, [selected, amountNum, toAddress, withdraw])

  if (done) {
    // Real data from here down: `done.txHash` + the `ok: true` response are
    // the actual mutation result. "Submitted" is the only step the API
    // confirms (status: "submitted" — see WalletWithdrawResult); there is no
    // subsequent confirmation/credit webhook or poll wired up, so
    // "Confirming"/"Credited" are rendered as the honest expected-next-steps,
    // not as verified facts — "Credited" never flips to done here.
    const explorerBase = EXPLORER_TX[done.chain]
    return (
      <div className="space-y-3 py-2">
        <div className="text-center">
          <div className="text-3xl" aria-hidden>
            ✅
          </div>
          <div className="mt-1 text-sm font-semibold text-terminal-text">Withdrawal submitted</div>
        </div>

        <div role="status" aria-live="polite" className="space-y-2 rounded-lg border border-terminal-border bg-terminal-bg p-3">
          <TimelineStep index={1} label="Submitted" note="Sent to the network" state="done" />
          <TimelineStep index={2} label="Confirming" note="Usually 1–5 minutes" state="active" />
          <TimelineStep index={3} label="Credited" note="Appears at the destination automatically" state="pending" />
        </div>

        <div className="flex items-center justify-center gap-2">
          {explorerBase ? (
            <a
              href={explorerBase + done.txHash}
              target="_blank"
              rel="noreferrer"
              className="terminal-theme-control rounded-[7px] px-3 py-1.5 text-xs font-semibold text-sakura-600"
            >
              View transaction ↗
            </a>
          ) : (
            <span className="font-mono text-[11px] text-terminal-text-muted">{short(done.txHash)}</span>
          )}
          <CopyButton value={done.txHash} label="Copy tx" />
        </div>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-8 text-center text-sm text-terminal-text-muted">
        Withdrawals are temporarily paused. Your funds are safe — please check back shortly.
      </div>
    )
  }

  if (balances.length === 0) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-8 text-center text-sm text-terminal-text-muted">
        No balance to withdraw yet. Deposit funds first.
      </div>
    )
  }

  if (review && selected) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-terminal-border bg-terminal-bg p-4">
          <div className="text-center text-2xl font-semibold text-terminal-text">
            <span className="font-mono tnum">{amountNum}</span>{' '}
            <span className="text-sm font-normal text-terminal-text-muted">{selected.token}</span>
          </div>
          <div className="mt-3 space-y-1.5 text-[12px]">
            <Row label="Network" value={selected.chain} />
            <Row label="To" value={short(toAddress.trim())} mono />
            <Row label="Fee" value="Network fee sponsored" />
          </div>
        </div>
        <p className="text-center text-[11px] text-terminal-text-muted">
          Double-check the address — on-chain transfers can’t be reversed.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setReview(false)}
            disabled={withdraw.isPending}
            className="terminal-theme-control flex-1 rounded-lg py-2.5 text-sm font-semibold text-terminal-text-secondary disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex-1">
            <HoldToConfirmButton
              onConfirm={submit}
              disabled={withdraw.isPending}
              pending={withdraw.isPending}
              label="Confirm withdrawal"
              pendingLabel="Submitting…"
            />
          </div>
        </div>
        <p className="text-center text-[11px] text-terminal-text-muted">
          Press and hold to confirm (or hold Enter). Release early to cancel.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Balance picker */}
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-text-muted">
          From balance
        </label>
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {balances.map((b) => {
            const on = selected?.chain === b.chain && selected?.token === b.token
            return (
              <button
                key={`${b.chain}-${b.token}`}
                onClick={() => {
                  setSelected(b)
                  setAmount('')
                }}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                  on
                    ? 'border-sakura-500 bg-sakura-500/10'
                    : 'border-terminal-border hover:bg-terminal-bg-tertiary/40'
                }`}
              >
                <span className="text-sm font-semibold text-terminal-text">{b.token}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 text-[10px] uppercase text-terminal-text-muted">
                    {b.chain}
                  </span>
                  <span className="font-mono text-xs tnum text-terminal-text-secondary">
                    {b.amount}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-terminal-text-muted">
          <span>Amount</span>
          {selected && (
            <button
              onClick={() => setAmount(String(selected.amount))}
              className="text-sakura-600 hover:underline"
            >
              Max <span className="font-mono tnum">{selected.amount}</span> {selected.token}
            </button>
          )}
        </label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0.00"
          className="terminal-input w-full font-mono"
        />
        {amount && !amountValid && (
          <p className="mt-1 text-[11px] text-bear">
            {amountNum > (selected?.amount ?? 0) ? 'More than your balance.' : 'Enter a valid amount.'}
          </p>
        )}
      </div>

      {/* Destination address */}
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-text-muted">
          To address {selected ? `(${selected.chain})` : ''}
        </label>
        <div className="flex gap-1.5">
          <input
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            placeholder={selected?.chain === 'solana' ? 'Solana address' : '0x…'}
            className="terminal-input w-full font-mono text-xs"
          />
          <button
            onClick={async () => {
              try {
                setToAddress((await navigator.clipboard.readText()).trim())
              } catch {
                toast.error('Clipboard unavailable')
              }
            }}
            className="terminal-theme-control shrink-0 rounded-[7px] px-2.5 text-xs font-semibold text-terminal-text"
          >
            Paste
          </button>
        </div>
        {toAddress && (
          <p className={`mt-1 text-[11px] ${addrValid ? 'text-bull' : 'text-bear'}`}>
            {addrValid ? '✓ Valid address' : '✗ Not a valid address for this network'}
          </p>
        )}
      </div>

      <button
        onClick={() => setReview(true)}
        disabled={!canReview}
        className="w-full rounded-lg bg-sakura-500 py-2.5 text-sm font-semibold text-terminal-on-accent transition-colors hover:bg-sakura-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Review withdrawal
      </button>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-terminal-text-muted">{label}</span>
      <span className={`text-terminal-text ${mono ? 'font-mono tnum' : ''}`}>{value}</span>
    </div>
  )
}

export function WalletModal({
  open,
  onClose,
  initialTab = 'deposit',
}: {
  open: boolean
  onClose: () => void
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { isExternalWallet, connectedAddress } = useAuth()
  const { data: summary } = useWalletSummary(open)

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const balances = useMemo(() => summary?.balances ?? [], [summary])

  if (!open) return null

  return createPortal(
    <div
      className="terminal-theme-scrim fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="terminal-theme-overlay w-full max-w-md overflow-hidden rounded-2xl">
        <div className="hairline-b flex items-center justify-between px-4 py-3">
          <div className="flex gap-1">
            {(['deposit', 'withdraw'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition-colors ${
                  tab === t ? 'bg-sakura-500/12 text-sakura-600' : 'text-terminal-text-secondary hover:text-terminal-text'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-terminal-text-muted hover:text-terminal-text">
            ✕
          </button>
        </div>

        <div className="p-4">
          {isExternalWallet ? (
            // Non-custodial: the user controls their own keys.
            <div className="space-y-3">
              {tab === 'deposit' ? (
                <>
                  <p className="text-sm text-terminal-text">
                    You’re signed in with your own wallet — receive funds directly to it:
                  </p>
                  {connectedAddress && (
                    <div className="flex items-center gap-2 rounded-lg bg-terminal-bg-tertiary/60 px-3 py-2">
                      <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-terminal-text">
                        {connectedAddress}
                      </span>
                      <CopyButton value={connectedAddress} />
                    </div>
                  )}
                  <p className="text-[11px] text-terminal-text-muted">
                    Send tokens on the matching network. They’ll appear in your portfolio automatically.
                  </p>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-terminal-text-muted">
                  Your funds stay in your own wallet — use <b>Swap</b> to move or convert them, or send
                  directly from your wallet app.
                </p>
              )}
            </div>
          ) : tab === 'deposit' ? (
            <DepositView
              evmAddress={summary?.evmDepositAddress ?? null}
              solanaAddress={summary?.solanaDepositAddress ?? null}
              balances={balances}
            />
          ) : (
            <WithdrawView balances={balances} enabled={summary?.withdrawEnabled !== false} />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
