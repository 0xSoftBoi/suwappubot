import type { PulseToken } from '../../types/api'
import { QuickBuyButton } from './QuickBuyButton'
import { Sparkline } from './Sparkline'
import { TrustScoreBadge } from './TrustScoreBadge'

function formatAge(createdAt: string): { text: string; color: string } {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const diffSec = Math.floor(diffMs / 1000)

  let text: string
  if (diffSec < 60) text = `${diffSec}s`
  else if (diffSec < 3600) text = `${Math.floor(diffSec / 60)}m`
  else if (diffSec < 86400) text = `${Math.floor(diffSec / 3600)}h`
  else text = `${Math.floor(diffSec / 86400)}d`

  let color: string
  if (diffSec < 60) color = 'bg-terminal-accent/15 text-terminal-accent border-terminal-accent/30'
  else if (diffSec < 300) color = 'bg-terminal-warn/15 text-terminal-warn border-terminal-warn/30'
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
  onSelect?: (token: PulseToken) => void
  isNew?: boolean
}

export function PulseTokenRow({ token, onBuy, onSelect, isNew }: PulseTokenRowProps) {
  const age = formatAge(token.createdAt)
  const change5m = formatChange(token.priceChange5m)
  const change1h = formatChange(token.priceChange1h ?? 0)
  const change24h = formatChange(token.priceChange24h ?? 0)

  return (
    <tr
      className={`border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-all cursor-pointer ${
        isNew ? 'animate-pulse-once bg-sakura-600/5' : ''
      }`}
      data-testid="pulse-token-row"
      onClick={() => onSelect?.(token)}
    >
      {/* Age badge */}
      <td className="py-1 px-2">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono tnum border ${age.color}`}>
          {age.text}
        </span>
      </td>

      {/* Token + tags */}
      <td className="py-1 px-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="font-medium text-terminal-text text-xs">{token.symbol}</span>
            {token.devPercent > 30 && (
              <span className="text-[8px] px-1 py-0 rounded bg-bear/15 text-bear border border-bear/30 font-semibold">
                DEV
              </span>
            )}
            {token.isBundled && (
              <span className="text-[8px] px-1 py-0 rounded bg-terminal-warn/15 text-terminal-warn border border-terminal-warn/30 font-semibold">
                BUNDLED
              </span>
            )}
          </div>
          <span className="text-[9px] text-terminal-text-muted truncate max-w-[100px]">{token.name}</span>
        </div>
      </td>

      {/* Chain */}
      <td className="py-1 px-2">
        <span className="text-[9px] text-terminal-text-muted uppercase">{token.chain.slice(0, 3)}</span>
      </td>

      {/* Market Cap */}
      <td className="py-1 px-2 text-right font-mono tnum text-xs text-terminal-text">
        {formatNum(token.marketCap)}
      </td>

      {/* Volume */}
      <td className="py-1 px-2 text-right font-mono tnum text-xs text-terminal-text-secondary">
        {formatNum(token.volume24h)}
      </td>

      {/* Sparkline mini-chart */}
      <td className="py-1 px-2">
        <Sparkline data={(token as any).sparkline} width={50} height={20} />
      </td>

      {/* 5m Change */}
      <td className={`py-1 px-2 text-right font-mono tnum text-xs ${change5m.className}`}>
        {change5m.text}
      </td>

      {/* 1h Change */}
      <td className={`py-1 px-2 text-right font-mono tnum text-xs ${change1h.className}`}>
        {change1h.text}
      </td>

      {/* 24h Change */}
      <td className={`py-1 px-2 text-right font-mono tnum text-xs ${change24h.className}`}>
        {change24h.text}
      </td>

      {/* Holders — "—" when the feed doesn't supply a holder count */}
      <td className="py-1 px-2 text-right font-mono tnum text-xs text-terminal-text-secondary">
        {token.holders > 0 ? token.holders.toLocaleString() : '—'}
      </td>

      {/* 24h transactions (real, from DexScreener) — buys / sells */}
      <td className="py-1 px-2 text-right font-mono tnum text-[11px]">
        <span className="text-bull">{token.buys24h ?? 0}</span>
        <span className="text-terminal-text-muted">/</span>
        <span className="text-bear">{token.sells24h ?? 0}</span>
      </td>

      {/* Trust Score */}
      <td className="py-1 px-2 text-center">
        <TrustScoreBadge score={token.trustScore} level={token.riskLevel} />
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
            <span className="text-[9px] font-mono tnum text-sakura-400">
              {(token.bondingProgress ?? 0).toFixed(0)}%
            </span>
          </div>
        </td>
      )}

      {/* Buy */}
      <td className="py-1 px-2 text-right" onClick={e => e.stopPropagation()}>
        <QuickBuyButton
          tokenSymbol={token.symbol}
          tokenAddress={token.address}
          onBuy={onBuy}
          glowOnHover
        />
      </td>
    </tr>
  )
}
