import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWalletPortfolio, getWalletActivity, heliusEnabled } from '../../lib/helius'

const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function fmtUsd(v: number | null): string {
  if (v == null) return '—'
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

function fmtAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  if (v >= 1) return v.toFixed(2)
  return v.toPrecision(3)
}

function fmtAge(ts: number): string {
  if (!ts) return ''
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Live, client-side Solana wallet inspector powered by Helius (no backend/auth).
// Paste any address → net worth (SOL + tokens) and recent parsed activity.
export function WalletInspector() {
  const [input, setInput] = useState('')
  const [address, setAddress] = useState<string | null>(null)
  const valid = address != null && SOL_ADDRESS.test(address)

  const portfolio = useQuery({
    queryKey: ['wallet-portfolio', address],
    queryFn: () => getWalletPortfolio(address as string),
    enabled: valid,
    staleTime: 30_000,
  })
  const activity = useQuery({
    queryKey: ['wallet-activity', address],
    queryFn: () => getWalletActivity(address as string),
    enabled: valid,
    staleTime: 30_000,
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const a = input.trim()
    if (SOL_ADDRESS.test(a)) setAddress(a)
  }

  if (!heliusEnabled()) {
    return (
      <div className="h-full flex flex-col p-4 gap-3" data-testid="wallet-tracker">
        <h3 className="text-sm font-semibold">Wallet Inspector</h3>
        <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-3 text-sm text-terminal-text-muted">
          Set <span className="font-mono text-terminal-text">VITE_HELIUS_API_KEY</span> to enable
          live Solana wallet inspection.
        </div>
      </div>
    )
  }

  const p = portfolio.data
  const inputInvalid = input.trim().length > 0 && !SOL_ADDRESS.test(input.trim())

  return (
    <div className="h-full flex flex-col" data-testid="wallet-tracker">
      <div className="px-3 py-2 border-b border-terminal-border shrink-0">
        <h3 className="text-sm font-semibold mb-2">Wallet Inspector</h3>
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Solana wallet address…"
            aria-label="Solana wallet address"
            className="terminal-input flex-1 font-mono text-xs"
          />
          <button
            type="submit"
            disabled={!SOL_ADDRESS.test(input.trim())}
            className="rounded bg-sakura-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sakura-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Inspect
          </button>
        </form>
        {inputInvalid && (
          <p className="mt-1 text-[10px] text-bear">Not a valid Solana address.</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!valid ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-terminal-text-muted">
            Paste any Solana wallet to see its live holdings and activity.
          </div>
        ) : portfolio.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted animate-pulse">
            Loading wallet…
          </div>
        ) : portfolio.isError || !p ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-bear">
            Could not load this wallet.
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            {/* Net worth */}
            <div className="rounded-lg border border-terminal-border bg-terminal-bg p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">
                Net worth (priced assets)
              </div>
              <div className="font-mono text-xl text-terminal-text">{fmtUsd(p.totalUsd)}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-terminal-text-secondary">
                <span>
                  SOL <span className="font-mono text-terminal-text">{fmtAmount(p.nativeSol)}</span>{' '}
                  <span className="text-terminal-text-muted">({fmtUsd(p.nativeUsd)})</span>
                </span>
                <span>
                  Tokens <span className="font-mono text-terminal-text">{p.tokens.length}</span>
                </span>
                <span>
                  Assets <span className="font-mono text-terminal-text">{p.assetCount}</span>
                </span>
              </div>
            </div>

            {/* Holdings */}
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
                Top holdings
              </div>
              {p.tokens.length === 0 ? (
                <div className="text-xs text-terminal-text-muted">No fungible tokens.</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {p.tokens.slice(0, 12).map((t) => (
                      <tr key={t.mint} className="border-b border-terminal-border/40">
                        <td className="py-1 pr-2 font-medium text-terminal-text">{t.symbol}</td>
                        <td className="py-1 px-2 text-right font-mono text-terminal-text-secondary">
                          {fmtAmount(t.amount)}
                        </td>
                        <td className="py-1 pl-2 text-right font-mono text-terminal-text">
                          {t.usd != null ? fmtUsd(t.usd) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Activity */}
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
                Recent activity
              </div>
              {activity.isLoading ? (
                <div className="text-xs text-terminal-text-muted animate-pulse">Loading…</div>
              ) : !activity.data || activity.data.length === 0 ? (
                <div className="text-xs text-terminal-text-muted">No recent transactions.</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {activity.data.slice(0, 12).map((tx) => (
                    <li
                      key={tx.signature}
                      className="flex items-start justify-between gap-2 border-b border-terminal-border/40 py-1 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="mr-1.5 rounded bg-terminal-bg-tertiary px-1 py-0.5 text-[9px] font-semibold uppercase text-sakura-400">
                          {tx.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-terminal-text-secondary">
                          {tx.description || tx.source || '—'}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-terminal-text-muted">
                        {fmtAge(tx.timestamp)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
