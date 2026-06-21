import { useState } from 'react'
import toast from 'react-hot-toast'
import { useConnectPerps } from '../../hooks/useTerminalPerps'

// One-time HyperLiquid connect form. Terminal users trade with their own HL API
// wallet (key + secret), encrypted server-side exactly like the Telegram /perps
// setup. Shown until usePerpsAccount().connected is true.
export function ConnectHyperliquid({ onConnected }: { onConnected?: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
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

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-terminal-text">Connect HyperLiquid</h3>
        <p className="mt-1 text-xs text-terminal-text-muted">
          Paste your HyperLiquid API wallet to trade perps. Keys are encrypted at rest and
          never leave the server. Create one in the HyperLiquid app under{' '}
          <span className="text-terminal-text-secondary">More → API</span>.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-terminal-text-muted">API key</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="0x…"
          className="terminal-input w-full font-mono text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-terminal-text-muted">
          API secret (private key)
        </span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder="0x…"
          className="terminal-input w-full font-mono text-xs"
        />
      </label>

      <button
        onClick={submit}
        disabled={connect.isPending || !apiKey.trim() || !apiSecret.trim()}
        className="w-full rounded py-2.5 text-sm font-semibold bg-sakura-500 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connect.isPending ? 'Connecting…' : 'Connect & enable trading'}
      </button>
    </div>
  )
}
