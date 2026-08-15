import type { SwapQuote } from "../../types/api";
import { formatSavings, venueLabel } from "../../lib/venueLabels";

interface Props {
  quote: SwapQuote;
}

export function QuoteComparison({ quote }: Props) {
  const savings = formatSavings(quote.priceImprovementUsd, quote.runnerUpProvider);
  const impactColor =
    quote.priceImpact < 0.5
      ? "text-impact-negligible"
      : quote.priceImpact < 1
        ? "text-impact-low"
        : quote.priceImpact < 3
          ? "text-impact-medium"
          : quote.priceImpact < 5
            ? "text-impact-high"
            : "text-impact-severe";

  return (
    <div
      aria-live="polite"
      aria-label="Swap quote details"
      className="hairline space-y-1.5 rounded-[var(--terminal-radius-card)] bg-terminal-bg px-3 py-2.5 text-[11px]"
    >
      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Rate</span>
        <span className="tnum font-mono">
          1 {quote.fromToken.symbol} = {quote.exchangeRate.toFixed(6)}{" "}
          {quote.toToken.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Price Impact</span>
        <span className={`tnum font-mono ${impactColor}`}>
          {quote.priceImpact.toFixed(2)}%
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Min Received</span>
        <span className="tnum font-mono">
          {quote.minReceived} {quote.toToken.symbol}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Gas</span>
        <span className="tnum font-mono">${quote.gasUsd.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span className="text-terminal-text-secondary">Route</span>
        <span className="ml-2 truncate font-mono text-terminal-text">
          {venueLabel(quote.route)}
        </span>
      </div>

      {savings && (
        <div className="flex justify-between">
          <span className="text-terminal-text-secondary">Best-route savings</span>
          <span className="tnum ml-2 truncate font-mono text-impact-negligible">
            {savings.amount} vs {savings.versus}
          </span>
        </div>
      )}

      {quote.estimatedDuration && (
        <div className="flex justify-between">
          <span className="text-terminal-text-secondary">Est. Time</span>
          <span className="tnum font-mono">
            {quote.estimatedDuration < 60
              ? `${quote.estimatedDuration}s`
              : `${Math.round(quote.estimatedDuration / 60)}m`}
          </span>
        </div>
      )}
    </div>
  );
}
