import type { CSSProperties } from 'react'
import { swapTokens, type SwapProviderName } from '../../theme/tokens'

export function ChainBadge({ chain }: { chain: string }) {
  return (
    <span
      className="swap-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.25rem 0.625rem',
        background: swapTokens.color.surfaceStrong,
        border: `1px solid ${swapTokens.color.border}`,
        color: swapTokens.color.text,
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {chain}
    </span>
  )
}

export function ProviderLogo({ provider }: { provider: SwapProviderName }) {
  const color = swapTokens.color.provider[provider]
  return (
    <span
      aria-label={`${provider} provider`}
      style={{
        display: 'inline-flex',
        width: 28,
        height: 28,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        background: color,
        color: '#fff',
        fontSize: '0.65rem',
        fontWeight: 800,
        textTransform: 'uppercase',
      }}
    >
      {provider.slice(0, 2)}
    </span>
  )
}

export function ImpactIndicator({ impact }: { impact: number }) {
  let tone = swapTokens.color.success
  if (impact >= 1) tone = swapTokens.color.warn
  if (impact >= 3) tone = swapTokens.color.danger

  return (
    <span style={{ color: tone, fontWeight: 700 }}>
      {impact.toFixed(2)}%
    </span>
  )
}

export function TokenPair({
  fromSymbol,
  toSymbol,
  fromChain,
  toChain,
}: {
  fromSymbol: string
  toSymbol: string
  fromChain: string
  toChain: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <strong>{fromSymbol}</strong>
      <span style={{ color: swapTokens.color.textMuted }}>→</span>
      <strong>{toSymbol}</strong>
      <ChainBadge chain={fromChain} />
      {fromChain !== toChain ? <ChainBadge chain={toChain} /> : null}
    </div>
  )
}

export function AnimatedNumber({
  value,
  prefix,
  suffix,
  style,
}: {
  value: number
  prefix?: string
  suffix?: string
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontVariantNumeric: 'tabular-nums',
        transition: 'transform 180ms ease, color 180ms ease',
        ...style,
      }}
    >
      {prefix}
      {value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      {suffix}
    </span>
  )
}
