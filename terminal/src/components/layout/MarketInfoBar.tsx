import { usePair } from '../../contexts/PairContext'
import { useMarketData } from '../../hooks/useMarketData'

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function MarketInfoBar() {
  const { selectedPair } = usePair()
  const { price, change24h, volume24h, marketCap, fundingRate, isLoading } = useMarketData()

  const baseSymbol = selectedPair.base?.symbol ?? '---'
  const quoteSymbol = selectedPair.quote?.symbol ?? '---'
  const isPositive = (change24h ?? 0) >= 0

  return (
    <div className="flex items-center gap-4 h-7 px-3 bg-terminal-bg-secondary border-b border-terminal-border text-xs font-mono shrink-0 overflow-x-auto">
      <span className="text-terminal-text font-semibold whitespace-nowrap">
        {baseSymbol}/{quoteSymbol}
      </span>

      {isLoading ? (
        <span className="text-terminal-text-muted">Loading...</span>
      ) : (
        <>
          <span className="text-terminal-text whitespace-nowrap">
            {price != null ? formatPrice(price) : '---'}
          </span>

          <span className={`whitespace-nowrap ${isPositive ? 'text-bull' : 'text-bear'}`}>
            {change24h != null
              ? `${isPositive ? '\u25B2' : '\u25BC'}${isPositive ? '+' : ''}${change24h.toFixed(2)}%`
              : '---'}
          </span>

          <span className="text-terminal-text-muted whitespace-nowrap">
            Vol {volume24h != null ? formatCompact(volume24h) : '---'}
          </span>

          <span className="text-terminal-text-muted whitespace-nowrap">
            MCap {marketCap != null ? formatCompact(marketCap) : '---'}
          </span>

          <span className="text-terminal-text-muted whitespace-nowrap">
            Funding {fundingRate != null ? `${fundingRate.toFixed(2)}%` : '---'}
          </span>
        </>
      )}
    </div>
  )
}
