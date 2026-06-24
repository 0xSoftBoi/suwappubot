import { useMarketRegime } from '../../hooks/useMarketRegime'

function formatUsd(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

// Fear & Greed → color + plain-language regime. 0 = extreme fear, 100 = greed.
function fngTone(v: number) {
  if (v <= 24) return { color: '#ef4444', label: 'Extreme Fear' }
  if (v <= 44) return { color: '#f97316', label: 'Fear' }
  if (v <= 55) return { color: '#eab308', label: 'Neutral' }
  if (v <= 75) return { color: '#22c55e', label: 'Greed' }
  return { color: '#16a34a', label: 'Extreme Greed' }
}

// One tile: tiny uppercase label over a mono value.
function Tile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-[9px] font-medium uppercase tracking-wide text-terminal-text-muted">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums leading-none">{children}</span>
    </div>
  )
}

// Always-on macro context strip: crypto Fear & Greed, total market cap (24h),
// BTC dominance (alt-season read), and stablecoin "dry powder". All free data;
// each tile self-hides when its upstream is unavailable.
export function MarketRegimeStrip() {
  const { data } = useMarketRegime()
  if (!data) return null

  const fng = data.fearGreed
  const tone = fng ? fngTone(fng.value) : null
  const mcapUp = (data.mcapChange24h ?? 0) >= 0
  // Falling BTC dominance is the classic "alt season building" read.
  const altSeason = data.btcDominance != null && data.btcDominance < 50

  return (
    <div className="terminal-theme-inset flex items-center gap-x-4 gap-y-1 overflow-x-auto rounded-[8px] px-3 py-1.5 text-terminal-text">
      {fng && tone && (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[9px] font-medium uppercase tracking-wide text-terminal-text-muted">
            Fear / Greed
          </span>
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: tone.color }}
            title={`${fng.value} — ${tone.label}`}
          >
            {fng.value}
          </span>
          <span className="font-mono text-[12px] font-semibold leading-none" style={{ color: tone.color }}>
            {tone.label}
          </span>
        </div>
      )}

      {data.totalMcap != null && (
        <div className="hidden h-3.5 w-px shrink-0 bg-terminal-border sm:block" />
      )}
      {data.totalMcap != null && (
        <Tile label="Total Cap">
          <span className="text-terminal-text">{formatUsd(data.totalMcap)}</span>
          {data.mcapChange24h != null && (
            <span className={`ml-1 ${mcapUp ? 'text-bull' : 'text-bear'}`}>
              {mcapUp ? '▲' : '▼'}
              {Math.abs(data.mcapChange24h).toFixed(2)}%
            </span>
          )}
        </Tile>
      )}

      {data.btcDominance != null && (
        <div className="hidden h-3.5 w-px shrink-0 bg-terminal-border sm:block" />
      )}
      {data.btcDominance != null && (
        <Tile label="BTC.D">
          <span className="text-terminal-text">{data.btcDominance.toFixed(1)}%</span>
          <span
            className={`ml-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
              altSeason ? 'bg-bull-dim text-bull' : 'bg-terminal-bg-tertiary/70 text-terminal-text-muted'
            }`}
          >
            {altSeason ? 'Alt season' : 'BTC-led'}
          </span>
        </Tile>
      )}

      {data.stablecoinMcap != null && (
        <div className="hidden h-3.5 w-px shrink-0 bg-terminal-border md:block" />
      )}
      {data.stablecoinMcap != null && (
        <Tile label="Dry Powder">
          <span className="text-terminal-text" title="Total stablecoin supply">
            {formatUsd(data.stablecoinMcap)}
          </span>
        </Tile>
      )}
    </div>
  )
}
