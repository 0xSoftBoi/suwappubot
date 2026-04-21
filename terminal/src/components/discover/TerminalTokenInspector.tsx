import type { PulseToken } from '../../types/api'
import { TerminalButton, TerminalTokenPill } from '../foundation/TerminalControls'
import { TerminalChainBadge, TerminalDeltaText, TerminalKeyValueRow } from '../foundation/TerminalDataDisplay'
import { TerminalInset, TerminalMetricCard, TerminalStatusPill } from '../foundation/TerminalPrimitives'

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(6)}`
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function riskTone(level?: PulseToken['riskLevel']): 'neutral' | 'warm' | 'sky' {
  if (level === 'danger') return 'warm'
  if (level === 'safe') return 'sky'
  return 'neutral'
}

export function TerminalTokenInspector({
  token,
  onBack,
}: {
  token: PulseToken
  onBack?: () => void
}) {
  const otherHolderPct = Math.max(0, 100 - token.topHolderPercent - token.devPercent)

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="terminal-theme-control bg-terminal-bg-secondary px-3 py-2 text-xs text-terminal-text-secondary hover:bg-white hover:text-terminal-text"
            >
              Back
            </button>
          ) : null}
          <TerminalStatusPill tone={riskTone(token.riskLevel)}>
            {token.stage.replace('_', ' ')}
          </TerminalStatusPill>
          {token.isBundled ? <TerminalStatusPill tone="warm">bundled</TerminalStatusPill> : null}
        </div>
        <TerminalChainBadge chain={token.chain} />
      </div>

      <TerminalInset className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="terminal-theme-heading text-2xl font-semibold text-terminal-text">
                {token.symbol}
              </h2>
              <TerminalTokenPill symbol={token.symbol} label={token.name} tone="neutral" />
              {token.trustScore !== undefined ? (
                <TerminalStatusPill tone={riskTone(token.riskLevel)}>
                  trust {token.trustScore}
                </TerminalStatusPill>
              ) : null}
            </div>
            <div className="mt-2 text-sm leading-6 text-terminal-text-secondary">
              {token.name} on {token.chain} with discovery-stage metrics and holder concentration displayed through shared inspector primitives.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TerminalMetricCard label="Price" value={formatUsd(token.priceUsd)} tone="sky" />
            <TerminalMetricCard
              label="5m"
              value={`${token.priceChange5m >= 0 ? '+' : ''}${token.priceChange5m.toFixed(2)}%`}
              tone={token.priceChange5m >= 0 ? 'sky' : 'warm'}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <TerminalMetricCard label="MCap" value={formatUsd(token.marketCap)} />
          <TerminalMetricCard label="Liquidity" value={formatUsd(token.liquidityUsd)} />
          <TerminalMetricCard label="Volume 24h" value={formatUsd(token.volume24h)} />
          <TerminalMetricCard label="Holders" value={token.holders.toLocaleString()} />
        </div>
      </TerminalInset>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <TerminalInset className="grid gap-3">
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
            Risk and ownership
          </div>
          <TerminalKeyValueRow
            label="Top holders"
            value={formatPct(token.topHolderPercent)}
            detail="Concentration in the largest wallets."
          />
          <TerminalKeyValueRow
            label="Developer allocation"
            value={formatPct(token.devPercent)}
            detail="Supply retained or controlled by the deployer side."
          />
          <TerminalKeyValueRow
            label="Sniper allocation"
            value={formatPct(token.sniperPercent)}
            detail="Early aggressive wallet participation."
          />
          {token.bondingProgress !== undefined ? (
            <TerminalKeyValueRow
              label="Bonding progress"
              value={formatPct(token.bondingProgress)}
              detail="Useful while the token is still in the final-stretch phase."
            />
          ) : null}

          <div className="terminal-theme-card bg-white/90 p-3">
            <div className="terminal-theme-caption mb-2 text-[10px] uppercase text-terminal-text-muted">
              Holder distribution
            </div>
            <div className="flex h-3 overflow-hidden rounded-full border border-terminal-border">
              <div
                className="bg-red-400/70"
                style={{ width: `${token.topHolderPercent}%` }}
                title={`Top holders ${formatPct(token.topHolderPercent)}`}
              />
              <div
                className="bg-orange-400/70"
                style={{ width: `${token.devPercent}%` }}
                title={`Dev ${formatPct(token.devPercent)}`}
              />
              <div
                className="bg-green-400/40"
                style={{ width: `${otherHolderPct}%` }}
                title={`Other ${formatPct(otherHolderPct)}`}
              />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="text-xs text-terminal-text-secondary">Top holders {formatPct(token.topHolderPercent)}</div>
              <div className="text-xs text-terminal-text-secondary">Dev {formatPct(token.devPercent)}</div>
              <div className="text-xs text-terminal-text-secondary">Other {formatPct(otherHolderPct)}</div>
            </div>
          </div>
        </TerminalInset>

        <TerminalInset className="grid gap-3">
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
            Trading posture
          </div>
          <TerminalKeyValueRow
            label="5m"
            value={<TerminalDeltaText value={token.priceChange5m} align="left" />}
            detail="Immediate tape movement."
          />
          <TerminalKeyValueRow
            label="1h"
            value={<TerminalDeltaText value={token.priceChange1h ?? null} align="left" />}
            detail="Short-term momentum."
          />
          <TerminalKeyValueRow
            label="24h"
            value={<TerminalDeltaText value={token.priceChange24h ?? null} align="left" />}
            detail="Broader daily move."
          />

          <div className="grid gap-2 md:grid-cols-2">
            <TerminalButton>Open trade module</TerminalButton>
            <TerminalButton variant="secondary">Add to watchlist</TerminalButton>
          </div>

          <div className="terminal-theme-card bg-white/90 p-4 text-sm leading-6 text-terminal-text-secondary">
            The current live token-detail panel hand-builds rows, bars, and social placeholders. This inspector is intentionally narrower: shared metrics first, then shared actions, then any special-case token detail.
          </div>
        </TerminalInset>
      </div>
    </div>
  )
}
