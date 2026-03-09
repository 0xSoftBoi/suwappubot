import type { Pool, TokenSecurity } from '../../types/api'
import { SecurityBadge } from './SecurityBadge'

function formatUsd(value: string | null): string {
  if (!value) return '--'
  const num = parseFloat(value)
  if (isNaN(num)) return '--'
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`
  if (num >= 1) return `$${num.toFixed(2)}`
  return `$${num.toFixed(6)}`
}

function formatChange(value: number | null): { text: string; className: string } {
  if (value === null || value === undefined) return { text: '--', className: 'text-terminal-text-muted' }
  const sign = value >= 0 ? '+' : ''
  return {
    text: `${sign}${value.toFixed(2)}%`,
    className: value >= 0 ? 'text-bull' : 'text-bear',
  }
}

interface TrendingTableProps {
  pools: Pool[]
  securityMap: Record<string, TokenSecurity>
  securityLoading: Set<string>
}

export function TrendingTable({ pools, securityMap, securityLoading }: TrendingTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-terminal-text-muted border-b border-terminal-border">
            <th className="text-left py-1.5 px-2 font-medium w-8">#</th>
            <th className="text-left py-1.5 px-2 font-medium">Token</th>
            <th className="text-right py-1.5 px-2 font-medium">Price</th>
            <th className="text-right py-1.5 px-2 font-medium">24h Change</th>
            <th className="text-right py-1.5 px-2 font-medium">Volume</th>
            <th className="text-right py-1.5 px-2 font-medium">Liquidity</th>
            <th className="text-right py-1.5 px-2 font-medium">Market Cap</th>
            <th className="text-center py-1.5 px-2 font-medium">Security</th>
          </tr>
        </thead>
        <tbody>
          {pools.length === 0 && (
            <tr>
              <td colSpan={8} className="text-center text-terminal-text-muted text-sm py-8">
                No trending pools found
              </td>
            </tr>
          )}
          {pools.map((pool, idx) => {
            const change = formatChange(pool.priceChangeH24)
            const tokenAddr = pool.baseToken.address
            const security = securityMap[tokenAddr] || null
            const loading = securityLoading.has(tokenAddr)

            return (
              <tr
                key={pool.address || idx}
                className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
              >
                <td className="py-1.5 px-2 text-terminal-text-muted font-mono">
                  {idx + 1}
                </td>
                <td className="py-1.5 px-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-terminal-text">{pool.baseToken.symbol}</span>
                    <span className="text-[10px] text-terminal-text-muted truncate max-w-[120px]">
                      {pool.name}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-terminal-text">
                  {formatUsd(pool.priceUsd)}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${change.className}`}>
                  {change.text}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-terminal-text-secondary">
                  {formatUsd(pool.volumeH24)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-terminal-text-secondary">
                  {formatUsd(pool.reserveUsd)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-terminal-text-secondary">
                  {formatUsd(pool.fdvUsd)}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <SecurityBadge security={security} loading={loading} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
