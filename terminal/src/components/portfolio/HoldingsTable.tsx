import { usePortfolio } from '../../hooks/usePortfolio'

export function HoldingsTable() {
  const { data: portfolio, isLoading } = usePortfolio()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm animate-pulse">
        Loading portfolio...
      </div>
    )
  }

  if (!portfolio || portfolio.tokens.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        No holdings found
      </div>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-terminal-text-muted border-b border-terminal-border">
          <th className="text-left py-2 px-3 font-medium">Token</th>
          <th className="text-left py-2 px-3 font-medium">Chain</th>
          <th className="text-right py-2 px-3 font-medium">Balance</th>
          <th className="text-right py-2 px-3 font-medium">USD Value</th>
        </tr>
      </thead>
      <tbody>
        {portfolio.tokens.map((token, i) => (
          <tr
            key={`${token.chain}-${token.address}-${i}`}
            className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
          >
            <td className="py-2 px-3">
              <div className="flex items-center gap-2">
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt="" className="w-4 h-4 rounded-full" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-terminal-border flex items-center justify-center text-[8px]">
                    {token.symbol[0]}
                  </div>
                )}
                <span className="font-medium text-terminal-text">{token.symbol}</span>
              </div>
            </td>
            <td className="py-2 px-3 text-terminal-text-secondary capitalize">{token.chain}</td>
            <td className="py-2 px-3 text-right font-mono tnum text-terminal-text">
              {parseFloat(token.balance).toFixed(4)}
            </td>
            <td className="py-2 px-3 text-right font-mono tnum text-terminal-text">
              ${token.usdValue.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="text-terminal-text font-medium">
          <td colSpan={3} className="py-2 px-3 text-right">Total</td>
          <td className="py-2 px-3 text-right font-mono tnum">
            ${portfolio.totalUsdValue.toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
