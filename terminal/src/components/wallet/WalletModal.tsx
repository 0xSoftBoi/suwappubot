import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useWalletSummary, useWithdraw } from '../../hooks/useWallet'
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

// Deposit panel: chain chips → QR + copyable address + network warning. Balances
// auto-refresh in the background so an incoming deposit shows up on its own.
function DepositView({
  evmAddress,
  solanaAddress,
}: {
  evmAddress: string | null
  solanaAddress: string | null
}) {
  const [chain, setChain] = useState('ethereum')
  const [qr, setQr] = useState<string | null>(null)
  const def = DEPOSIT_CHAINS.find((c) => c.id === chain)!
  const address = def.type === 'solana' ? solanaAddress : evmAddress

  useEffect(() => {
    if (!address) {
      setQr(null)
      return
    }
    QRCode.toDataURL(address, { margin: 1, width: 220, color: { dark: '#0b1622', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [address])

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
            {qr ? (
              <img src={qr} alt="Deposit QR" className="h-40 w-40 rounded-lg" />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center text-terminal-text-muted">…</div>
            )}
            <div className="flex w-full items-center gap-2 rounded-lg bg-terminal-bg-tertiary/60 px-3 py-2">
              <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-terminal-text">
                {address}
              </span>
              <CopyButton value={address} />
            </div>
          </div>

          <div className="rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/8 px-3 py-2 text-[11px] text-[#b45309]">
            ⚠ Only send <b>{def.label}</b>-network tokens to this address. Sending from another network
            can lose funds.
          </div>
          <p className="text-center text-[11px] text-terminal-text-muted">
            Deposits are credited automatically · allow 1–5 min for confirmation
          </p>
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
// → review → execute. Two-step confirm guards against fat-finger sends.
function WithdrawView({ balances }: { balances: WalletBalance[] }) {
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
    const url = (EXPLORER_TX[done.chain] || '') + done.txHash
    return (
      <div className="space-y-3 py-2 text-center">
        <div className="text-3xl">✅</div>
        <div className="text-sm font-semibold text-terminal-text">Withdrawal submitted</div>
        <p className="text-[12px] text-terminal-text-muted">
          It’s on its way. On-chain confirmation usually takes 1–5 minutes.
        </p>
        <div className="flex items-center justify-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="terminal-theme-control rounded-[7px] px-3 py-1.5 text-xs font-semibold text-sakura-600"
          >
            View transaction ↗
          </a>
          <CopyButton value={done.txHash} label="Copy tx" />
        </div>
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
          <div className="text-center text-2xl font-bold text-terminal-text">
            {amountNum} <span className="text-sm text-terminal-text-muted">{selected.token}</span>
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
          <button
            onClick={submit}
            disabled={withdraw.isPending}
            className="flex-1 rounded-lg bg-sakura-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sakura-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {withdraw.isPending ? 'Submitting…' : `Confirm withdrawal`}
          </button>
        </div>
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
                  <span className="font-mono text-xs text-terminal-text-secondary tabular-nums">
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
              Max {selected.amount} {selected.token}
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
        className="w-full rounded-lg bg-sakura-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sakura-600 disabled:cursor-not-allowed disabled:opacity-50"
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
      <span className={`text-terminal-text ${mono ? 'font-mono' : ''}`}>{value}</span>
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
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-terminal-border bg-terminal-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-terminal-border px-4 py-3">
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
          <button onClick={onClose} className="text-terminal-text-muted hover:text-terminal-text">
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
            />
          ) : (
            <WithdrawView balances={balances} />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
