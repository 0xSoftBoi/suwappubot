import { useTokenSafety } from '../../hooks/useTokenSafety'
import type { TokenSafetyReport } from '../../types/api'

interface Props {
  chain: string | null | undefined
  address: string | null | undefined
  symbol?: string
}

const RISK_STYLES: Record<TokenSafetyReport['riskLevel'], { dot: string; text: string; label: string }> = {
  safe: { dot: 'bg-bull', text: 'text-bull', label: 'Looks safe' },
  caution: { dot: 'bg-[#f59e0b]', text: 'text-[#b45309]', label: 'Trade with caution' },
  danger: { dot: 'bg-bear', text: 'text-bear', label: 'High risk' },
  unknown: { dot: 'bg-terminal-text-muted', text: 'text-terminal-text-muted', label: 'Safety unknown' },
}

// A small pill summarising one boolean safety attribute.
function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        ok ? 'bg-bull-dim text-bull' : 'bg-bear-dim text-bear'
      }`}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

// Pre-trade safety strip for the token being acquired. Aggregates GoPlus +
// Honeypot.is (EVM) or RugCheck (Solana). Loud + red when it's a honeypot;
// quiet and compact when the token is clean.
export function TokenSafetyStrip({ chain, address, symbol }: Props) {
  const { data, isLoading } = useTokenSafety(chain, address)

  if (!chain || !address) return null
  if (isLoading) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-[11px] text-terminal-text-muted">
        Checking {symbol ?? 'token'} safety…
      </div>
    )
  }
  if (!data || data.riskLevel === 'unknown') return null

  const style = RISK_STYLES[data.riskLevel]
  const danger = data.riskLevel === 'danger'

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        danger
          ? 'border-bear/50 bg-bear-dim/40'
          : data.riskLevel === 'caution'
            ? 'border-[#f59e0b]/40 bg-[#f59e0b]/8'
            : 'border-terminal-border bg-terminal-bg'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
        </span>
        {data.score != null && (
          <span className="font-mono text-[11px] text-terminal-text-secondary tabular-nums">
            Trust {data.score}/100
          </span>
        )}
      </div>

      {/* Attribute pills */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {data.canSell != null && <Pill ok={data.canSell} label={data.canSell ? 'Can sell' : "Can't sell"} />}
        {data.mintable != null && <Pill ok={!data.mintable} label="Mint revoked" />}
        {data.freezable != null && <Pill ok={!data.freezable} label="Freeze revoked" />}
        {(data.buyTaxPct != null || data.sellTaxPct != null) && (
          <span className="inline-flex items-center gap-1 rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[10px] text-terminal-text-secondary">
            Tax {data.buyTaxPct?.toFixed(0) ?? '?'}/{data.sellTaxPct?.toFixed(0) ?? '?'}%
          </span>
        )}
        {data.lpLockedPct != null && (
          <span className="inline-flex items-center gap-1 rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[10px] text-terminal-text-secondary">
            LP {data.lpLockedPct.toFixed(0)}% locked
          </span>
        )}
        {data.topHolderPct != null && (
          <span className="inline-flex items-center gap-1 rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[10px] text-terminal-text-secondary">
            Top10 {data.topHolderPct.toFixed(0)}%
          </span>
        )}
      </div>

      {/* Named risk flags (worst first) */}
      {data.flags.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {data.flags.slice(0, 4).map((f) => (
            <li
              key={f.label}
              className={`flex items-center gap-1.5 text-[10.5px] ${
                f.level === 'danger' ? 'text-bear' : 'text-[#b45309]'
              }`}
            >
              <span>{f.level === 'danger' ? '⛔' : '⚠'}</span>
              {f.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 text-[9px] text-terminal-text-muted">
        via {data.sources.join(' + ') || 'on-chain checks'}
      </div>
    </div>
  )
}
