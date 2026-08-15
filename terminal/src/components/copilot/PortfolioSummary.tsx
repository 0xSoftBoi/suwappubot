interface PortfolioSummaryProps {
  data: Record<string, unknown>;
}

export function PortfolioSummary({ data }: PortfolioSummaryProps) {
  const totalUsdValue = (data.totalUsdValue as number) || 0;
  const tokens =
    (data.tokens as Array<{
      symbol: string;
      balance: string;
      usdValue: number;
    }>) || [];
  const top5 = tokens.slice(0, 5);

  return (
    <div className="terminal-theme-inset space-y-2 p-[var(--terminal-space-inset)] text-[11px]">
      <div className="flex justify-between items-center">
        <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Total Value
        </span>
        <span className="font-mono tnum text-terminal-text font-semibold text-sm">
          {totalUsdValue.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        </span>
      </div>

      {top5.length > 0 && (
        <div className="space-y-1 border-t border-terminal-border pt-2">
          {top5.map((token) => (
            <div
              key={token.symbol}
              className="flex justify-between text-terminal-text-secondary"
            >
              <span className="text-terminal-text">{token.symbol}</span>
              <div className="flex gap-3 font-mono tnum">
                <span>{token.balance}</span>
                <span className="text-terminal-text-muted w-20 text-right">
                  ${(token.usdValue ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
