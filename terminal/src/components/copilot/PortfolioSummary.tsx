interface PortfolioSummaryProps {
  data: Record<string, unknown>
}

export function PortfolioSummary({ data }: PortfolioSummaryProps) {
  const totalUsdValue = (data.totalUsdValue as number) || 0
  const tokens = (data.tokens as Array<{ symbol: string; balance: string; usdValue: number }>) || []
  const top5 = tokens.slice(0, 5)

  return (
    <div className="rounded border border-terminal-border bg-terminal-bg-secondary p-3 text-xs space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-terminal-text-muted">Total Value</span>
        <span className="text-terminal-text font-semibold text-sm">
          {totalUsdValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </span>
      </div>

      {top5.length > 0 && (
        <div className="border-t border-terminal-border pt-2 space-y-1">
          {top5.map((token) => (
            <div key={token.symbol} className="flex justify-between text-terminal-text-secondary">
              <span className="text-terminal-text">{token.symbol}</span>
              <div className="flex gap-3">
                <span>{token.balance}</span>
                <span className="text-terminal-text-muted w-20 text-right">
                  ${token.usdValue.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
