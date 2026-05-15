import { useState } from 'react'
import { useOrderBook, type OrderBookViewMode, type PrecisionStep } from '../../hooks/useOrderBook'

const PRECISION_OPTIONS: PrecisionStep[] = [0.01, 0.1, 1, 10]

function formatPrice(price: number, precision: PrecisionStep): string {
  const decimals = Math.max(2, -Math.log10(precision))
  return price.toFixed(decimals)
}

function formatSize(size: number): string {
  return size.toFixed(4)
}

export function OrderBookPanel() {
  const [viewMode, setViewMode] = useState<OrderBookViewMode>('both')
  const [precision, setPrecision] = useState<PrecisionStep>(0.01)
  const { book, isConnected, maxTotal } = useOrderBook(precision)

  const showBids = viewMode === 'both' || viewMode === 'bids'
  const showAsks = viewMode === 'both' || viewMode === 'asks'
  const hasBook = book.asks.length > 0 || book.bids.length > 0

  return (
    <div className="flex flex-col h-full" data-testid="order-book">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-terminal-border shrink-0">
        <span className="text-xs font-medium text-terminal-text-secondary">Order Book</span>
        <div className="flex items-center gap-1">
          {/* View mode toggles */}
          <button
            onClick={() => setViewMode('both')}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              viewMode === 'both'
                ? 'bg-terminal-bg-tertiary text-terminal-text'
                : 'text-terminal-text-muted hover:text-terminal-text-secondary'
            }`}
            aria-label="Show both"
            data-testid="view-both"
          >
            <ViewBothIcon />
          </button>
          <button
            onClick={() => setViewMode('bids')}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              viewMode === 'bids'
                ? 'bg-terminal-bg-tertiary text-bull'
                : 'text-terminal-text-muted hover:text-terminal-text-secondary'
            }`}
            aria-label="Show bids only"
            data-testid="view-bids"
          >
            <ViewBidsIcon />
          </button>
          <button
            onClick={() => setViewMode('asks')}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              viewMode === 'asks'
                ? 'bg-terminal-bg-tertiary text-bear'
                : 'text-terminal-text-muted hover:text-terminal-text-secondary'
            }`}
            aria-label="Show asks only"
            data-testid="view-asks"
          >
            <ViewAsksIcon />
          </button>

          {/* Precision selector */}
          <select
            value={precision}
            onChange={e => setPrecision(parseFloat(e.target.value) as PrecisionStep)}
            className="ml-1 bg-terminal-bg border border-terminal-border rounded text-[10px] text-terminal-text-secondary px-1 py-0.5 focus:outline-none"
            data-testid="precision-select"
          >
            {PRECISION_OPTIONS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-terminal-text-muted border-b border-terminal-border shrink-0">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Book content */}
      <div className="flex-1 overflow-hidden flex flex-col font-mono text-[11px] leading-[18px]">
        {!hasBook && (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
            <div>
              <div className="text-[11px] font-sans text-terminal-text-secondary">
                Order book provider is not connected yet.
              </div>
              <div className="mt-1 text-[10px] font-sans text-terminal-text-muted">
                Live depth will appear here when a real feed is wired.
              </div>
            </div>
          </div>
        )}
        {/* Asks (reversed so lowest ask is at bottom, near spread) */}
        {hasBook && showAsks && (
          <div className="flex-1 flex flex-col justify-end overflow-hidden" data-testid="asks-side">
            {[...book.asks].reverse().map((level, i) => (
              <div key={`ask-${i}`} className="grid grid-cols-3 px-2 relative">
                <div
                  className="absolute inset-0 bg-bear/10"
                  style={{ width: `${maxTotal > 0 ? (level.total / maxTotal) * 100 : 0}%`, right: 0, left: 'auto' }}
                />
                <span className="text-bear relative z-10">{formatPrice(level.price, precision)}</span>
                <span className="text-right text-terminal-text-secondary relative z-10">{formatSize(level.size)}</span>
                <span className="text-right text-terminal-text-muted relative z-10">{formatSize(level.total)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Spread */}
        <div
          className="flex items-center justify-between px-2 py-1 bg-terminal-bg-secondary border-y border-terminal-border shrink-0"
          data-testid="spread-display"
        >
          <span className="text-[11px] font-medium text-terminal-text">
            {hasBook ? formatPrice(book.midPrice, precision) : '--'}
          </span>
          <span className="text-[10px] text-terminal-text-muted">
            {isConnected ? `Spread: ${book.spread.toFixed(2)} (${book.spreadPercent.toFixed(3)}%)` : 'Provider offline'}
          </span>
        </div>

        {/* Bids */}
        {hasBook && showBids && (
          <div className="flex-1 overflow-hidden" data-testid="bids-side">
            {book.bids.map((level, i) => (
              <div key={`bid-${i}`} className="grid grid-cols-3 px-2 relative">
                <div
                  className="absolute inset-0 bg-bull/10"
                  style={{ width: `${maxTotal > 0 ? (level.total / maxTotal) * 100 : 0}%`, right: 0, left: 'auto' }}
                />
                <span className="text-bull relative z-10">{formatPrice(level.price, precision)}</span>
                <span className="text-right text-terminal-text-secondary relative z-10">{formatSize(level.size)}</span>
                <span className="text-right text-terminal-text-muted relative z-10">{formatSize(level.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ViewBothIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="5" rx="1" fill="#ef4444" opacity="0.6" />
      <rect x="1" y="8" width="12" height="5" rx="1" fill="#22c55e" opacity="0.6" />
    </svg>
  )
}

function ViewBidsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="1" fill="#22c55e" opacity="0.6" />
    </svg>
  )
}

function ViewAsksIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="1" fill="#ef4444" opacity="0.6" />
    </svg>
  )
}
