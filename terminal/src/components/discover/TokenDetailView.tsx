import { useState } from 'react'
import type { PulseToken } from '../../types/api'
import { TrustScoreBadge } from './TrustScoreBadge'
import { QuickBuyButton } from './QuickBuyButton'

interface TokenDetailViewProps {
  token: PulseToken
  onBack: () => void
}

function formatNum(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(6)}`
}

const MOCK_HOLDERS = [
  { rank: 1, address: '0x7a25...f3e1', percent: 0 },
  { rank: 2, address: '0x3b91...a7c4', percent: 0 },
  { rank: 3, address: '0xd42f...89b2', percent: 0 },
  { rank: 4, address: '0x1e8c...5d06', percent: 0 },
  { rank: 5, address: '0x92a0...c1f7', percent: 0 },
]

export function TokenDetailView({ token, onBack }: TokenDetailViewProps) {
  const [copied, setCopied] = useState(false)
  const otherPercent = Math.max(0, 100 - token.topHolderPercent - token.devPercent)

  // Generate mock holder percentages based on topHolderPercent
  const holders = MOCK_HOLDERS.map((h, i) => ({
    ...h,
    percent: Math.max(0.5, token.topHolderPercent / 5 - i * 1.5 + Math.random() * 2),
  }))

  const handleCopy = () => {
    navigator.clipboard.writeText(token.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full" data-testid="token-detail-view">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 px-3 py-2 text-xs text-terminal-text-muted hover:text-terminal-text transition-colors border-b border-terminal-border shrink-0"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11 2L5 8l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to list
      </button>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Token header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-terminal-bg-tertiary flex items-center justify-center text-xs font-bold text-sakura-400 border border-terminal-border">
              {token.symbol.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-terminal-text text-sm">{token.symbol}</span>
                <TrustScoreBadge score={token.trustScore} level={token.riskLevel} />
                {token.isBundled && (
                  <span className="text-[8px] px-1 py-0 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold">
                    BUNDLED {token.bundleCount ? `(${token.bundleCount})` : ''}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-terminal-text-muted">{token.name}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-terminal-text">{formatNum(token.priceUsd)}</div>
            <div className="text-[10px] text-terminal-text-muted uppercase">{token.chain}</div>
          </div>
        </div>

        {/* Contract address */}
        <div className="flex items-center gap-2 bg-terminal-bg-secondary rounded px-2 py-1.5 border border-terminal-border">
          <span className="text-[10px] text-terminal-text-muted shrink-0">CA:</span>
          <span className="text-[10px] font-mono text-terminal-text truncate">{token.address}</span>
          <button
            onClick={handleCopy}
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-terminal-bg-tertiary text-terminal-text-muted hover:text-terminal-text border border-terminal-border transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'MCap', value: formatNum(token.marketCap) },
            { label: 'Vol 24h', value: formatNum(token.volume24h) },
            { label: 'Liquidity', value: formatNum(token.liquidityUsd) },
            { label: 'Holders', value: token.holders.toLocaleString() },
          ].map(stat => (
            <div key={stat.label} className="bg-terminal-bg-secondary rounded px-2 py-1.5 border border-terminal-border">
              <div className="text-[9px] text-terminal-text-muted">{stat.label}</div>
              <div className="text-xs font-mono text-terminal-text">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Holder Distribution Bar */}
        <div>
          <div className="text-[10px] text-terminal-text-muted mb-1.5 font-medium">Holder Distribution</div>
          <div className="flex h-3 rounded-full overflow-hidden border border-terminal-border">
            <div
              className="bg-red-500/70"
              style={{ width: `${token.topHolderPercent}%` }}
              title={`Top 10: ${token.topHolderPercent.toFixed(1)}%`}
            />
            <div
              className="bg-orange-500/70"
              style={{ width: `${token.devPercent}%` }}
              title={`Dev: ${token.devPercent.toFixed(1)}%`}
            />
            <div
              className="bg-green-500/40"
              style={{ width: `${otherPercent}%` }}
              title={`Other: ${otherPercent.toFixed(1)}%`}
            />
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-terminal-text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-500/70" /> Top10 {token.topHolderPercent.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-orange-500/70" /> Dev {token.devPercent.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green-500/40" /> Other {otherPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Social links placeholder */}
        <div>
          <div className="text-[10px] text-terminal-text-muted mb-1.5 font-medium">Socials</div>
          <div className="flex items-center gap-2">
            {['Website', 'Twitter', 'Telegram'].map(label => (
              <span
                key={label}
                className="text-[10px] px-2 py-1 rounded bg-terminal-bg-secondary border border-terminal-border text-terminal-text-muted cursor-not-allowed"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Top Holders Table */}
        <div>
          <div className="text-[10px] text-terminal-text-muted mb-1.5 font-medium">Top 5 Holders</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-terminal-text-muted border-b border-terminal-border">
                <th className="text-left py-1 px-2 font-medium text-[10px]">#</th>
                <th className="text-left py-1 px-2 font-medium text-[10px]">Address</th>
                <th className="text-right py-1 px-2 font-medium text-[10px]">%</th>
              </tr>
            </thead>
            <tbody>
              {holders.map(h => (
                <tr key={h.rank} className="border-b border-terminal-border/50">
                  <td className="py-1 px-2 text-terminal-text-muted font-mono">{h.rank}</td>
                  <td className="py-1 px-2 font-mono text-terminal-text">{h.address}</td>
                  <td className="py-1 px-2 text-right font-mono text-terminal-text-secondary">{h.percent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Quick Buy */}
        <div className="flex justify-center pt-2">
          <QuickBuyButton
            tokenSymbol={token.symbol}
            tokenAddress={token.address}
            glowOnHover
          />
        </div>
      </div>
    </div>
  )
}
