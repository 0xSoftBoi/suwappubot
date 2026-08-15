interface QuoteCardProps {
  data: Record<string, unknown>;
  onExecute?: () => void;
  onDismiss?: () => void;
}

export function QuoteCard({ data, onExecute, onDismiss }: QuoteCardProps) {
  const fromToken = (data.fromToken as { symbol?: string })?.symbol || "?";
  const toToken = (data.toToken as { symbol?: string })?.symbol || "?";
  const fromAmount = (data.fromAmount as string) || "0";
  const toAmount = (data.toAmount as string) || "0";
  const exchangeRate = data.exchangeRate as number | undefined;
  const priceImpact = data.priceImpact as number | undefined;
  const gasUsd = data.gasUsd as number | undefined;

  return (
    <div className="terminal-theme-inset space-y-2.5 p-[var(--terminal-space-inset)] text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            From
          </span>
          <p className="text-terminal-text font-medium">
            <span className="font-mono tnum">{fromAmount}</span> {fromToken}
          </p>
        </div>
        <svg
          className="w-4 h-4 text-terminal-text-muted mx-2 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14 5l7 7m0 0l-7 7m7-7H3"
          />
        </svg>
        <div className="text-right">
          <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            To
          </span>
          <p className="text-terminal-text font-medium">
            <span className="font-mono tnum">{toAmount}</span> {toToken}
          </p>
        </div>
      </div>

      <div className="flex justify-between border-t border-terminal-border pt-2 text-terminal-text-secondary">
        <span>Rate</span>
        <span className="font-mono tnum">
          1 {fromToken} = {exchangeRate?.toFixed(6) || "—"} {toToken}
        </span>
      </div>
      {priceImpact !== undefined && (
        <div className="flex justify-between text-terminal-text-secondary">
          <span>Price Impact</span>
          <span
            className={`font-mono tnum ${priceImpact > 1 ? "text-impact-high" : "text-impact-low"}`}
          >
            {priceImpact.toFixed(2)}%
          </span>
        </div>
      )}
      {gasUsd !== undefined && (
        <div className="flex justify-between text-terminal-text-secondary">
          <span>Est. Gas</span>
          <span className="font-mono tnum">${gasUsd.toFixed(2)}</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onExecute}
          disabled={!onExecute}
          className="terminal-button flex-1 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Execute Swap
        </button>
        <button
          onClick={onDismiss}
          disabled={!onDismiss}
          className="terminal-button-secondary flex-1 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
