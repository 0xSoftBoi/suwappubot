import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

export function PerpsPositions() {
  const { walletAddress, isAuthenticated } = useAuth()

  const { data: positions, isLoading } = useQuery({
    queryKey: ['perps-positions', walletAddress],
    queryFn: () => api.getPerpsPositions(walletAddress!),
    enabled: isAuthenticated && !!walletAddress,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm animate-pulse">
        Loading positions...
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        No open positions
      </div>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-terminal-text-muted border-b border-terminal-border">
          <th className="text-left py-2 px-3 font-medium">Market</th>
          <th className="text-left py-2 px-3 font-medium">Side</th>
          <th className="text-right py-2 px-3 font-medium">Size</th>
          <th className="text-right py-2 px-3 font-medium">Leverage</th>
          <th className="text-right py-2 px-3 font-medium">Entry</th>
          <th className="text-right py-2 px-3 font-medium">Mark</th>
          <th className="text-right py-2 px-3 font-medium">PnL</th>
          <th className="text-right py-2 px-3 font-medium">Liq. Price</th>
        </tr>
      </thead>
      <tbody>
        {positions.map(pos => (
          <tr
            key={pos.id}
            className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
          >
            <td className="py-2 px-3 font-medium text-terminal-text">{pos.market}</td>
            <td className="py-2 px-3">
              <span className={pos.side === 'long' ? 'text-bull' : 'text-bear'}>
                {pos.side.toUpperCase()}
              </span>
            </td>
            <td className="py-2 px-3 text-right font-mono">{pos.size.toFixed(4)}</td>
            <td className="py-2 px-3 text-right font-mono">{pos.leverage.toFixed(1)}x</td>
            <td className="py-2 px-3 text-right font-mono">${pos.entryPrice.toFixed(2)}</td>
            <td className="py-2 px-3 text-right font-mono">${pos.markPrice.toFixed(2)}</td>
            <td className={`py-2 px-3 text-right font-mono ${pos.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
              {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
            </td>
            <td className="py-2 px-3 text-right font-mono text-terminal-text-secondary">
              ${pos.liquidationPrice.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
