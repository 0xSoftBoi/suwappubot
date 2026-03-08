import type { Meta, StoryObj } from '@storybook/react'
import { designTokens } from '../../theme/tokens'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu UI/Swap Design Tokens',
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj

/* ─── Helpers ────────────────────────────────────────────── */

function Swatch({ name, color, dark }: { name: string; color: string; dark?: boolean }) {
  const textColor = dark ? 'text-white' : 'text-suwappu-text'
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-12 h-12 rounded-suwappu-lg shadow-suwappu-2 flex-shrink-0 ring-1 ring-black/5"
        style={{ backgroundColor: color }}
      />
      <div>
        <div className={`font-heading font-semibold text-sm ${textColor}`}>{name}</div>
        <div className="font-mono text-xs text-suwappu-text-secondary">{color}</div>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-1">{title}</h3>
      {description && <p className="font-body text-sm text-suwappu-text-secondary mb-4">{description}</p>}
      {children}
    </div>
  )
}

/* ─── Stories ────────────────────────────────────────────── */

export const PriceImpactScale: Story = {
  name: 'Price Impact Scale',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Price Impact Scale</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        5-level severity scale used for price impact, risk scores, and fee warnings.
        Green is safe, red demands attention.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(designTokens.colors.impact).map(([name, color]) => (
          <Swatch key={name} name={name} color={color} />
        ))}
      </div>

      <Section title="Usage Examples" description="How the scale maps to real swap scenarios">
        <div className="space-y-3 max-w-md">
          {[
            { level: 'negligible', pct: '< 0.1%', desc: 'Trade freely', color: designTokens.colors.impact.negligible },
            { level: 'low', pct: '0.1 - 0.5%', desc: 'Normal for most trades', color: designTokens.colors.impact.low },
            { level: 'medium', pct: '0.5 - 2%', desc: 'Consider a smaller trade', color: designTokens.colors.impact.medium },
            { level: 'high', pct: '2 - 5%', desc: 'Split trade recommended', color: designTokens.colors.impact.high },
            { level: 'severe', pct: '> 5%', desc: 'Strongly recommend splitting', color: designTokens.colors.impact.severe },
          ].map((item) => (
            <div key={item.level} className="flex items-center gap-3 p-3 rounded-suwappu-lg bg-white shadow-suwappu-1">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <div className="flex-1">
                <span className="font-heading font-semibold text-sm capitalize">{item.level}</span>
                <span className="text-suwappu-text-secondary text-xs ml-2">{item.pct}</span>
              </div>
              <span className="text-xs text-suwappu-text-secondary">{item.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Gradient Bar" description="Continuous scale as rendered in the SwapImpactGauge component">
        <div className="max-w-lg">
          <div className="h-4 rounded-full overflow-hidden flex">
            <div className="flex-[2]" style={{ backgroundColor: designTokens.colors.impact.negligible }} />
            <div className="flex-[4]" style={{ backgroundColor: designTokens.colors.impact.low }} />
            <div className="flex-[3]" style={{ backgroundColor: designTokens.colors.impact.medium }} />
            <div className="flex-[2]" style={{ backgroundColor: designTokens.colors.impact.high }} />
            <div className="flex-[1]" style={{ backgroundColor: designTokens.colors.impact.severe }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-suwappu-text-secondary font-mono">
            <span>0%</span>
            <span>0.1%</span>
            <span>0.5%</span>
            <span>2%</span>
            <span>5%</span>
            <span>10%+</span>
          </div>
        </div>
      </Section>
    </div>
  ),
}

export const TransactionStates: Story = {
  name: 'Transaction States',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Transaction States</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Lifecycle colors for swap transactions. Used in TransactionTracker, SwapCard, and status badges.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(designTokens.colors.txState).map(([name, color]) => (
          <Swatch key={name} name={name} color={color} />
        ))}
      </div>

      <Section title="Transaction Flow" description="How states progress through a swap lifecycle">
        <div className="flex flex-wrap items-center gap-2 max-w-2xl">
          {[
            { state: 'pending', label: 'Submitting' },
            { state: 'confirming', label: 'Confirming' },
            { state: 'bridging', label: 'Bridging' },
            { state: 'success', label: 'Complete' },
          ].map((step, i) => (
            <div key={step.state} className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-suwappu-lg bg-white shadow-suwappu-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: designTokens.colors.txState[step.state as keyof typeof designTokens.colors.txState] }}
                />
                <span className="text-sm font-heading font-semibold">{step.label}</span>
              </div>
              {i < 3 && <span className="text-suwappu-text-secondary text-lg">→</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4">
          {['failed', 'expired'].map((state) => (
            <div key={state} className="flex items-center gap-2 px-3 py-2 rounded-suwappu-lg bg-white shadow-suwappu-1 opacity-70">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: designTokens.colors.txState[state as keyof typeof designTokens.colors.txState] }}
              />
              <span className="text-sm font-heading font-semibold capitalize">{state}</span>
            </div>
          ))}
          <span className="text-xs text-suwappu-text-secondary ml-2">(error states)</span>
        </div>
      </Section>

      <Section title="Badge Variants" description="How states render as pill badges">
        <div className="flex flex-wrap gap-2">
          {Object.entries(designTokens.colors.txState).map(([name, color]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold capitalize"
              style={{ backgroundColor: `${color}20`, color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              {name}
            </span>
          ))}
        </div>
      </Section>
    </div>
  ),
}

export const ChainColors: Story = {
  name: 'Chain Colors',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Chain Brand Colors</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Canonical brand colors for all 15 supported chains. Used in ChainBadge, route visualizers, and chain selectors.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {Object.entries(designTokens.colors.chain).map(([name, color]) => (
          <div key={name} className="text-center">
            <div
              className="w-14 h-14 rounded-full mx-auto shadow-suwappu-2 flex items-center justify-center ring-2 ring-white"
              style={{ backgroundColor: color }}
            >
              <span className="text-white text-xs font-bold drop-shadow-sm">
                {name.slice(0, 3).toUpperCase()}
              </span>
            </div>
            <div className="mt-2 font-heading font-semibold text-sm capitalize">{name}</div>
            <div className="font-mono text-[10px] text-suwappu-text-secondary">{color}</div>
          </div>
        ))}
      </div>

      <Section title="Chain Badge Sizes" description="ChainBadge component renders at 14px, 18px, and 22px">
        <div className="flex items-end gap-6">
          {[
            { size: 'sm', px: 14 },
            { size: 'md', px: 18 },
            { size: 'lg', px: 22 },
          ].map(({ size, px }) => (
            <div key={size} className="text-center">
              <div
                className="rounded-full mx-auto flex items-center justify-center ring-2 ring-white"
                style={{ width: px, height: px, backgroundColor: designTokens.colors.chain.ethereum }}
              >
                <span className="text-white font-bold" style={{ fontSize: px * 0.45 }}>ET</span>
              </div>
              <div className="mt-2 text-xs text-suwappu-text-secondary">{size} ({px}px)</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Chain Type Groups">
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-heading font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">EVM Chains (12)</h4>
            <div className="flex flex-wrap gap-2">
              {['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'fantom', 'linea', 'mantle', 'gnosis', 'scroll'].map((chain) => (
                <span
                  key={chain}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize bg-white shadow-suwappu-1"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: designTokens.colors.chain[chain as keyof typeof designTokens.colors.chain] }}
                  />
                  {chain}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-heading font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">Non-EVM</h4>
            <div className="flex flex-wrap gap-2">
              {['solana', 'sui', 'ton'].map((chain) => (
                <span
                  key={chain}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize bg-white shadow-suwappu-1"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: designTokens.colors.chain[chain as keyof typeof designTokens.colors.chain] }}
                  />
                  {chain}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  ),
}

export const ProviderColors: Story = {
  name: 'Provider Colors',
  render: () => {
    const providerInfo: Record<string, { name: string; type: string }> = {
      cow: { name: 'CoW Protocol', type: 'MEV-protected batch auction' },
      jupiter: { name: 'Jupiter', type: 'Solana DEX aggregator' },
      socket: { name: 'Socket', type: 'Cross-chain aggregator' },
      cctp: { name: 'Circle CCTP', type: 'Native USDC bridging' },
      across: { name: 'Across', type: 'Fast EVM bridges' },
      wormhole: { name: 'Wormhole', type: 'Cross-chain messaging' },
      lifi: { name: 'Li.Fi', type: 'Multi-bridge aggregator' },
      layerzero: { name: 'LayerZero', type: 'Omnichain protocol' },
      ccip: { name: 'Chainlink CCIP', type: 'Cross-chain interop' },
    }

    return (
      <div className="p-8 bg-suwappu-bg min-h-screen">
        <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Provider Brand Colors</h1>
        <p className="font-body text-suwappu-text-secondary mb-8">
          Brand colors for all 9 swap providers. Used in ProviderLogo, QuoteComparison, and route displays.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {Object.entries(designTokens.colors.provider).map(([key, color]) => {
            const info = providerInfo[key]
            return (
              <div key={key} className="flex items-center gap-3 p-3 rounded-suwappu-lg bg-white shadow-suwappu-1">
                <div
                  className="w-10 h-10 rounded-suwappu-sm flex-shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: color }}
                >
                  <span className="text-white text-[10px] font-bold">{key.slice(0, 3).toUpperCase()}</span>
                </div>
                <div>
                  <div className="font-heading font-semibold text-sm">{info?.name ?? key}</div>
                  <div className="text-[11px] text-suwappu-text-secondary">{info?.type}</div>
                  <div className="font-mono text-[10px] text-suwappu-text-secondary/60">{color}</div>
                </div>
              </div>
            )
          })}
        </div>

        <Section title="Provider Priority Order" description="SwapEngine queries providers in this order">
          <div className="flex flex-wrap items-center gap-1.5 max-w-2xl">
            {Object.entries(designTokens.colors.provider).map(([key, color], i) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-[10px] text-suwappu-text-secondary font-mono">{i + 1}.</span>
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: color }}
                >
                  {providerInfo[key]?.name ?? key}
                </span>
                {i < 8 && <span className="text-suwappu-text-secondary/40">→</span>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    )
  },
}

export const SwapAnimations: Story = {
  name: 'Swap Animations',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Swap Animations</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Animation presets for swap interactions. Hover or focus each demo to trigger.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
        {/* Price Tick Up */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Price Tick Up</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Flash green on value increase (300ms)</p>
          <div className="suwappu-price-up text-xl font-heading font-bold inline-block px-2 py-1 rounded">
            $1,245.67
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-price-up</code>
        </div>

        {/* Price Tick Down */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Price Tick Down</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Flash red on value decrease (300ms)</p>
          <div className="suwappu-price-down text-xl font-heading font-bold inline-block px-2 py-1 rounded">
            $1,198.23
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-price-down</code>
        </div>

        {/* Pulse Pending */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Pulse Pending</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Gentle pulse for waiting states (2s loop)</p>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full suwappu-pulse-pending" style={{ backgroundColor: designTokens.colors.txState.pending }} />
            <span className="suwappu-pulse-pending text-sm font-heading font-semibold" style={{ color: designTokens.colors.txState.pending }}>
              Confirming...
            </span>
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-pulse-pending</code>
        </div>

        {/* Quote Shimmer */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Quote Shimmer</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Loading placeholder for quote data (1.5s loop)</p>
          <div className="space-y-2">
            <div className="h-4 w-32 rounded suwappu-quote-shimmer" />
            <div className="h-4 w-48 rounded suwappu-quote-shimmer" />
            <div className="h-4 w-24 rounded suwappu-quote-shimmer" />
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-quote-shimmer</code>
        </div>

        {/* Slide Up */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Slide Up</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Bottom sheet / modal entrance (300ms spring)</p>
          <div className="suwappu-slide-up p-3 rounded-suwappu-lg bg-suwappu-sakura-light/30 border border-suwappu-sakura-mid/20">
            <span className="text-sm font-heading">Confirmation Panel</span>
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-slide-up</code>
        </div>

        {/* Number Spring */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Number Spring</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Subtle bounce on number update (400ms spring)</p>
          <div className="suwappu-number-spring text-2xl font-heading font-bold inline-block">
            1,245.67
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-number-spring</code>
        </div>

        {/* Swap Flip */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">Swap Flip</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Token direction swap button (200ms)</p>
          <div className="suwappu-swap-flip w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center mx-auto">
            <span className="text-suwappu-magenta-mid text-lg">↕</span>
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-swap-flip</code>
        </div>

        {/* Existing Shimmer */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h4 className="font-heading font-semibold text-sm mb-3">General Shimmer</h4>
          <p className="text-xs text-suwappu-text-secondary mb-2">Standard loading shimmer (existing, 1.5s loop)</p>
          <div className="space-y-2">
            <div className="h-6 w-full rounded-suwappu-sm suwappu-shimmer" />
            <div className="h-6 w-3/4 rounded-suwappu-sm suwappu-shimmer" />
          </div>
          <code className="block mt-2 text-[10px] text-suwappu-text-secondary font-mono">.suwappu-shimmer</code>
        </div>
      </div>
    </div>
  ),
}

export const TokenIconSizes: Story = {
  name: 'Token Icon Sizes',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Token Icon Sizes</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Standardized sizing for token icons and chain badge overlays.
      </p>

      <Section title="Token Icon Scale">
        <div className="flex items-end gap-8">
          {Object.entries(designTokens.tokenIcon).map(([size, px]) => (
            <div key={size} className="text-center">
              <div
                className="rounded-full bg-suwappu-gradient flex items-center justify-center mx-auto ring-2 ring-white shadow-suwappu-1"
                style={{ width: px, height: px }}
              >
                <span className="text-white font-bold" style={{ fontSize: Math.max(px * 0.35, 8) }}>ET</span>
              </div>
              <div className="mt-2 font-heading font-semibold text-sm">{size}</div>
              <div className="text-[10px] text-suwappu-text-secondary font-mono">{px}px</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Chain Badge Overlay Scale">
        <div className="flex items-end gap-8">
          {Object.entries(designTokens.chainBadge).map(([size, px]) => (
            <div key={size} className="text-center">
              <div className="relative inline-block">
                <div className="w-9 h-9 rounded-full bg-suwappu-gradient flex items-center justify-center ring-2 ring-white">
                  <span className="text-white font-bold text-xs">ET</span>
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white flex items-center justify-center"
                  style={{ width: px, height: px, backgroundColor: designTokens.colors.chain.ethereum }}
                >
                  <span className="text-white font-bold" style={{ fontSize: Math.max(px * 0.5, 6) }}>E</span>
                </div>
              </div>
              <div className="mt-3 font-heading font-semibold text-sm">{size}</div>
              <div className="text-[10px] text-suwappu-text-secondary font-mono">{px}px</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Token + Chain Combined" description="Token icons at each size with chain badge overlay">
        <div className="flex items-end gap-8">
          {(Object.keys(designTokens.tokenIcon) as Array<keyof typeof designTokens.tokenIcon>).map((tokenSize) => {
            const tokenPx = designTokens.tokenIcon[tokenSize]
            const badgeSize = tokenSize === 'sm' ? 'sm' : tokenSize === 'md' ? 'sm' : 'md'
            const badgePx = designTokens.chainBadge[badgeSize as keyof typeof designTokens.chainBadge]
            return (
              <div key={tokenSize} className="text-center">
                <div className="relative inline-block">
                  <div
                    className="rounded-full bg-suwappu-gradient flex items-center justify-center ring-2 ring-white"
                    style={{ width: tokenPx, height: tokenPx }}
                  >
                    <span className="text-white font-bold" style={{ fontSize: Math.max(tokenPx * 0.35, 8) }}>ET</span>
                  </div>
                  <div
                    className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white flex items-center justify-center"
                    style={{ width: badgePx, height: badgePx, backgroundColor: designTokens.colors.chain.polygon }}
                  >
                    <span className="text-white font-bold" style={{ fontSize: Math.max(badgePx * 0.5, 6) }}>P</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-suwappu-text-secondary">
                  {tokenSize} ({tokenPx}px)
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  ),
}

export const SwapTimingPresets: Story = {
  name: 'Timing & Easing Presets',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-2">Swap Animation Presets</h1>
      <p className="font-body text-suwappu-text-secondary mb-8">
        Predefined timing and easing combinations for swap-specific interactions.
      </p>

      <div className="space-y-4 max-w-xl">
        {Object.entries(designTokens.animations.swap).map(([name, config]) => (
          <div key={name} className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading font-semibold text-sm">{name}</span>
              <span className="font-mono text-[10px] text-suwappu-text-secondary">{config.duration}</span>
            </div>
            <div className="h-2 rounded-full bg-suwappu-sakura-light/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-suwappu-gradient"
                style={{
                  width: '60%',
                  transition: `width ${config.duration} ${config.easing}`,
                }}
              />
            </div>
            <div className="mt-1 font-mono text-[9px] text-suwappu-text-secondary/60">
              easing: {config.easing}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
}

export const DarkMode: Story = {
  name: 'Dark Mode Variants',
  render: () => (
    <div className="dark p-8 min-h-screen" style={{ backgroundColor: designTokens.colors.dark.background }}>
      <h1 className="font-heading text-2xl font-bold mb-2" style={{ color: designTokens.colors.dark.textPrimary }}>
        Dark Mode — Swap Tokens
      </h1>
      <p className="font-body text-sm mb-8" style={{ color: designTokens.colors.dark.textSecondary }}>
        All swap tokens maintain contrast and readability in dark mode.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Impact badges on dark */}
        <div className="p-4 rounded-suwappu-lg" style={{ backgroundColor: designTokens.colors.dark.surface }}>
          <h4 className="font-heading font-semibold text-sm mb-3" style={{ color: designTokens.colors.dark.textPrimary }}>
            Impact Badges
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(designTokens.colors.impact).map(([name, color]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                style={{ backgroundColor: `${color}25`, color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* TX state badges on dark */}
        <div className="p-4 rounded-suwappu-lg" style={{ backgroundColor: designTokens.colors.dark.surface }}>
          <h4 className="font-heading font-semibold text-sm mb-3" style={{ color: designTokens.colors.dark.textPrimary }}>
            Transaction States
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(designTokens.colors.txState).map(([name, color]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                style={{ backgroundColor: `${color}25`, color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* Chain badges on dark */}
        <div className="p-4 rounded-suwappu-lg" style={{ backgroundColor: designTokens.colors.dark.surface }}>
          <h4 className="font-heading font-semibold text-sm mb-3" style={{ color: designTokens.colors.dark.textPrimary }}>
            Chain Badges
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(designTokens.colors.chain).map(([name, color]) => (
              <div
                key={name}
                className="w-8 h-8 rounded-full flex items-center justify-center ring-2"
                style={{ backgroundColor: color, outlineColor: designTokens.colors.dark.surface }}
              >
                <span className="text-white text-[8px] font-bold">{name.slice(0, 2).toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Provider badges on dark */}
        <div className="p-4 rounded-suwappu-lg" style={{ backgroundColor: designTokens.colors.dark.surface }}>
          <h4 className="font-heading font-semibold text-sm mb-3" style={{ color: designTokens.colors.dark.textPrimary }}>
            Provider Logos
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(designTokens.colors.provider).map(([name, color]) => (
              <div
                key={name}
                className="w-8 h-8 rounded-suwappu-sm flex items-center justify-center"
                style={{ backgroundColor: color }}
              >
                <span className="text-white text-[8px] font-bold">{name.slice(0, 3).toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Animations on dark */}
        <div className="p-4 rounded-suwappu-lg md:col-span-2" style={{ backgroundColor: designTokens.colors.dark.surface }}>
          <h4 className="font-heading font-semibold text-sm mb-3" style={{ color: designTokens.colors.dark.textPrimary }}>
            Animations
          </h4>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="suwappu-pulse-pending w-4 h-4 rounded-full mx-auto" style={{ backgroundColor: designTokens.colors.txState.pending }} />
              <span className="text-[10px] mt-1 block" style={{ color: designTokens.colors.dark.textSecondary }}>pending</span>
            </div>
            <div className="text-center">
              <div className="h-3 w-24 rounded suwappu-quote-shimmer opacity-40" />
              <span className="text-[10px] mt-1 block" style={{ color: designTokens.colors.dark.textSecondary }}>shimmer</span>
            </div>
            <div className="text-center">
              <span className="suwappu-price-up font-heading font-bold px-2 py-0.5 rounded" style={{ color: designTokens.colors.dark.textPrimary }}>
                $1,245
              </span>
              <span className="text-[10px] mt-1 block" style={{ color: designTokens.colors.dark.textSecondary }}>price up</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
}

export const CompleteReference: Story = {
  name: 'Complete Reference Sheet',
  render: () => (
    <div className="p-8 bg-suwappu-bg min-h-screen">
      <h1 className="font-heading text-2xl font-bold text-suwappu-purple-deep mb-1">Swap Design Tokens</h1>
      <p className="font-body text-sm text-suwappu-text-secondary mb-6">
        Complete reference — all swap-specific tokens added in v2.0.0
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Impact */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">Impact Scale (5)</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(designTokens.colors.impact).map(([n, c]) => (
              <span key={n} className="px-2 py-0.5 rounded text-[10px] font-bold text-white capitalize" style={{ backgroundColor: c }}>{n}</span>
            ))}
          </div>
        </div>

        {/* TX States */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">TX States (6)</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(designTokens.colors.txState).map(([n, c]) => (
              <span key={n} className="px-2 py-0.5 rounded text-[10px] font-bold text-white capitalize" style={{ backgroundColor: c }}>{n}</span>
            ))}
          </div>
        </div>

        {/* Chains */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">Chains (15)</h3>
          <div className="flex flex-wrap gap-1">
            {Object.entries(designTokens.colors.chain).map(([n, c]) => (
              <div key={n} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: c }} title={n}>
                <span className="text-white text-[7px] font-bold">{n.slice(0, 2).toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Providers */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">Providers (9)</h3>
          <div className="flex flex-wrap gap-1">
            {Object.entries(designTokens.colors.provider).map(([n, c]) => (
              <div key={n} className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: c }} title={n}>
                <span className="text-white text-[7px] font-bold">{n.slice(0, 3).toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Animations */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">Swap Animations (4)</h3>
          <div className="space-y-1">
            {Object.entries(designTokens.animations.swap).map(([n, c]) => (
              <div key={n} className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-suwappu-text">{n}</span>
                <span className="text-suwappu-text-secondary">{c.duration}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sizing */}
        <div className="p-4 rounded-suwappu-lg bg-white shadow-suwappu-1">
          <h3 className="font-heading font-bold text-sm mb-3">Icon Sizes</h3>
          <div className="space-y-1">
            <div className="text-[11px]">
              <span className="font-mono text-suwappu-text">tokenIcon:</span>
              <span className="text-suwappu-text-secondary ml-2">
                {Object.entries(designTokens.tokenIcon).map(([k, v]) => `${k}=${v}px`).join(', ')}
              </span>
            </div>
            <div className="text-[11px]">
              <span className="font-mono text-suwappu-text">chainBadge:</span>
              <span className="text-suwappu-text-secondary ml-2">
                {Object.entries(designTokens.chainBadge).map(([k, v]) => `${k}=${v}px`).join(', ')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 p-3 rounded-suwappu-lg bg-suwappu-sakura-light/20 border border-suwappu-sakura-mid/20">
        <p className="text-xs text-suwappu-text-secondary">
          <strong>Tailwind classes:</strong> bg-impact-*, text-impact-*, bg-tx-state-*, text-tx-state-*, bg-chain-*, bg-provider-*
        </p>
      </div>
    </div>
  ),
}
