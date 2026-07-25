import { useEffect, useRef, useState } from 'react'
import { usePair } from '../../contexts/PairContext'
import { useMarketData } from '../../hooks/useMarketData'
import { TerminalSkeleton } from '../foundation'

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
  const { price, change24h, volume24h, isLoading } = useMarketData()

  const baseSymbol = selectedPair.base?.symbol ?? '---'
  const quoteSymbol = selectedPair.quote?.symbol ?? '---'
  const isPositive = (change24h ?? 0) >= 0

  // Flash the price cell on tick direction. Remount via `key` (not re-render
  // with the same class) so the CSS animation restarts every tick \u2014 see WS-A
  // report \u00A74.
  const prevPriceRef = useRef<number | null>(null)
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; tick: number }>({ dir: 'up', tick: 0 })

  useEffect(() => {
    if (price == null) return
    const prev = prevPriceRef.current
    if (prev != null && price !== prev) {
      setFlash((f) => ({ dir: price > prev ? 'up' : 'down', tick: f.tick + 1 }))
    }
    prevPriceRef.current = price
  }, [price])

  return (
    <div className="hairline-b flex h-7 shrink-0 items-center gap-4 overflow-x-auto bg-terminal-bg-secondary px-3 text-xs font-mono">
      <span className="whitespace-nowrap font-semibold text-terminal-text">
        {baseSymbol}/{quoteSymbol}
      </span>

      {isLoading ? (
        <TerminalSkeleton width={140} height={11} radius="control" label="Loading market data" />
      ) : (
        <>
          <span
            key={flash.tick}
            className={`tnum whitespace-nowrap rounded-[3px] px-1 text-terminal-text ${
              flash.tick > 0 ? (flash.dir === 'up' ? 'flash-up' : 'flash-down') : ''
            }`}
          >
            {price != null ? formatPrice(price) : '---'}
          </span>

          <span className={`tnum whitespace-nowrap ${isPositive ? 'text-bull' : 'text-bear'}`}>
            {change24h != null
              ? `${isPositive ? '\u25B2' : '\u25BC'}${isPositive ? '+' : ''}${change24h.toFixed(2)}%`
              : '---'}
          </span>

          <span className="tnum whitespace-nowrap text-terminal-text-muted">
            Vol {volume24h != null ? formatCompact(volume24h) : '---'}
          </span>
        </>
      )}
    </div>
  )
}
