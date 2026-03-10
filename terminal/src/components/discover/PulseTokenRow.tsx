import type { PulseToken } from '../../types/api'
import { InsiderMetrics } from './InsiderMetrics'
import { QuickBuyButton } from './QuickBuyButton'
import { Sparkline } from './Sparkline'

function formatAge(createdAt: string): { text: string; color: string } {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const diffSec = Math.floor(diffMs / 1000)

  let text: string
  if (diffSec < 60) text = `${diffSec}s`
  else if (diffSec < 3600) text = `${Math.floor(diffSec / 60)}m`
  else if (diffSec < 86400) text = `${Math.floor(diffSec / 3600)}h`
  else text = `${Math.floor(diffSec / 86400)}d`

  let color: string
  if (diffSec < 60) color = 'bg-green-500/20 text-green-400 border-green-500/30'
  else if (diffSec < 300) color = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  else color = 'bg-terminal-bg-tertiary text-terminal-text-muted border-terminal-border'

  return { text, color }
}

function formatNum(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(6)}`
}

function formatChange(value: number): { text: string; className: string } {
  const sign = value >= 0 ? '+' : ''
  return {
    text: `${sign}${value.toFixed(1)}%`,
    className: value >= 0 ? 'text-bull' : 'text-bear',
  }
}

interface PulseTokenRowProps {
  token: PulseToken
  onBuy?: (amount: number, tokenAddress: string) => void
  isNew?: boolean
}

export function PulseTokenRow({ token, onBuy, isNew }: PulseTokenRowProps) {
  const age = formatAge(token.createdAt)
  const change = formatChange(token.priceChange5m)

  return (
    <tr
      className={`border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-all ${
        isNew ? 'animate-pulse-once bg-sakura-600/5' : ''
      }`}
      data-testid="pulse-token-row"
    >
      {/* Age badge */}
      <td className="py-1 px-2">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ${age.color}`}>
          {age.text}
        </span>
      </td>

      {/* Token */}
      <td className="py-1 px-2">
        <div className="flex flex-col">
          <span className="font-medium text-terminal-text text-xs">{token.symbol}</span>
          <span className="text-[9px] text-terminal-text-muted truncate max-w-[100px]">{token.name}</span>
        </div>
      </td>

      {/* Chain */}
      <td className="py-1 px-2">
        <span className="text-[9px] text-terminal-text-muted uppercase">{token.chain.slice(0, 3)}</span>
      </td>

      {/* Market Cap */}
      <td className="py-1 px-2 text-right font-mono text-xs text-terminal-text">
        {formatNum(token.marketCap)}
      </td>

      {/* Volume */}
      <td className="py-1 px-2 text-right font-mono text-xs text-terminal-text-secondary">
        {formatNum(token.volume24h)}
      </td>

      {/* Sparkline mini-chart */}
      <td className="py-1 px-2">
        <Sparkline data={token.sparkline} width={50} height={20} />
      </td>

      {/* 5m Change */}
      <td className={`py-1 px-2 text-right font-mono text-xs ${change.className}`}>
        {change.text}
      </td>

      {/* Holders */}
      <td className="py-1 px-2 text-right font-mono text-xs text-terminal-text-secondary">
        {token.holders.toLocaleString()}
      </td>

      {/* Insider Metrics */}
      <td className="py-1 px-2">
        <InsiderMetrics
          topHolderPercent={token.topHolderPercent}
          devPercent={token.devPercent}
          sniperPercent={token.sniperPercent}
        />
      </td>

      {/* Bonding Progress (only for final_stretch) */}
      {token.stage === 'final_stretch' && (
        <td className="py-1 px-2">
          <div className="flex items-center gap-1">
            <div className="w-12 h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-sakura-500 transition-all duration-500"
                style={{ width: `${token.bondingProgress ?? 0}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-sakura-400">
              {(token.bondingProgress ?? 0).toFixed(0)}%
            </span>
          </div>
        </td>
      )}

      {/* Buy */}
      <td className="py-1 px-2 text-right">
        <QuickBuyButton
          tokenSymbol={token.symbol}
          tokenAddress={token.address}
          onBuy={onBuy}
        />
      </td>
    </tr>
  )
}
