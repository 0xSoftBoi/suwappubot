import type { SwapQuote } from '../../types/api'

interface Props {
  quote: SwapQuote
}

export function QuoteComparison({ quote }: Props) {
  const impactColor = quote.priceImpact < 0.5
    ? 'text-impact-negligible'
    : quote.priceImpact < 1
      ? 'text-impact-low'
      : quote.priceImpact < 3
        ? 'text-impact-medium'
        : quote.priceImpact < 5
          ? 'text-impact-high'
          : 'text-impact-severe'

  return (
    <div className="bg-terminal-bg rounded-lg p-3 space-y-2 text-xs">
      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Rate</span>
        <span className="font-mono">
          1 {quote.fromToken.symbol} = {quote.exchangeRate.toFixed(6)} {quote.toToken.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Price Impact</span>
        <span className={`font-mono ${impactColor}`}>
          {quote.priceImpact.toFixed(2)}%
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Min Received</span>
        <span className="font-mono">
          {quote.minReceived} {quote.toToken.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Gas</span>
        <span className="font-mono">
          ${quote.gasUsd.toFixed(2)}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Route</span>
        <span className="text-sakura-400 truncate ml-2">{quote.route}</span>
      </div>

      {quote.estimatedDuration && (
        <div className="flex justify-between">
          <span className="text-terminal-text-secondary">Est. Time</span>
          <span className="font-mono">
            {quote.estimatedDuration < 60
              ? `${quote.estimatedDuration}s`
              : `${Math.round(quote.estimatedDuration / 60)}m`
            }
          </span>
        </div>
      )}
    </div>
  )
}
