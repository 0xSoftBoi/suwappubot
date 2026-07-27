import { useState } from 'react'
import toast from 'react-hot-toast'
import { useConnectPerps } from '../../hooks/useTerminalPerps'
import { TerminalEmptyState } from '../foundation'

// What a user actually gets by connecting. Kept as copy only — every line here
// maps to a surface that already exists in the perps desk.
const UNLOCKS = [
  'Market & limit orders on every HyperLiquid perp, up to that market’s max leverage.',
  'Live positions with mark-to-market PnL, margin ratio and an est. liq price.',
  'One-tap 25 / 50 / 100% closes and cancellable resting orders.',
]

// One-time HyperLiquid connect gate. Terminal users trade with their own HL API
// wallet (key + secret), encrypted server-side exactly like the Telegram /perps
// setup. Shown until usePerpsAccount().connected is true.
//
// The gate leads with an empty state that explains what connecting unlocks
// (§3.4) — the credential form is one click behind it, so the panel never opens
// on two bare secret inputs.
export function ConnectHyperliquid({ onConnected }: { onConnected?: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showForm, setShowForm] = useState(false)
  const connect = useConnectPerps()

  async function submit() {
    if (!apiKey.trim() || !apiSecret.trim()) return
    try {
      await connect.mutateAsync({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() })
      toast.success('HyperLiquid connected')
      setApiKey('')
      setApiSecret('')
      onConnected?.()
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Could not connect HyperLiquid')
    }
  }

  if (!showForm) {
    return (
      <TerminalEmptyState
        kicker="Perps · HyperLiquid"
        title="Connect HyperLiquid to trade perps"
        description="Suwappu routes perps through your own HyperLiquid API wallet. Nothing is custodial — you keep the account, we hold the API key encrypted at rest."
        action={
          <div className="flex flex-col items-stretch gap-3">
            <ul className="grid gap-1.5 text-left text-[11px] leading-[1.5] text-terminal-text-secondary">
              {UNLOCKS.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="text-terminal-accent">
                    ·
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-terminal-control bg-terminal-accent px-4 py-2 text-xs font-semibold text-terminal-on-accent transition-colors hover:bg-terminal-accent-bright active:translate-y-px"
            >
              Connect HyperLiquid
            </button>
          </div>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-terminal-text">Connect HyperLiquid</h3>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted transition-colors hover:text-terminal-text"
          >
            Back
          </button>
        </div>
        <p className="mt-1 text-xs leading-[1.5] text-terminal-text-muted">
          Paste your HyperLiquid API wallet to trade perps. Keys are encrypted at rest and never
          leave the server. Create one in the HyperLiquid app under{' '}
          <span className="text-terminal-text-secondary">More → API</span>.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="terminal-theme-caption text-[10px] uppercase">API key</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="0x…"
          className="terminal-input w-full font-mono text-xs tnum"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="terminal-theme-caption text-[10px] uppercase">API secret (private key)</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder="0x…"
          className="terminal-input w-full font-mono text-xs tnum"
        />
      </label>

      <button
        onClick={submit}
        disabled={connect.isPending || !apiKey.trim() || !apiSecret.trim()}
        className="w-full rounded-terminal-control bg-terminal-accent py-2.5 text-sm font-semibold text-terminal-on-accent transition-colors hover:bg-terminal-accent-bright active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connect.isPending ? 'Connecting…' : 'Connect & enable trading'}
      </button>
    </div>
  )
}
