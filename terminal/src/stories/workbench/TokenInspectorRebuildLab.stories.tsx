import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalButton, TerminalSegmentedTabs, TerminalTextField } from '../../components/foundation/TerminalControls'
import { TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill, TerminalInset } from '../../components/foundation/TerminalPrimitives'
import { TerminalTokenInspector } from '../../components/discover/TerminalTokenInspector'
import type { PulseToken } from '../../types/api'

const tokens: PulseToken[] = [
  {
    address: '0x4f3b0f0edcd61ee3f6b8f7f7f6e35653ad9bdf11',
    symbol: 'KAZE',
    name: 'Kaze Finance',
    chain: 'ethereum',
    stage: 'final_stretch',
    createdAt: new Date().toISOString(),
    marketCap: 12_440_000,
    volume24h: 2_820_000,
    holders: 8124,
    topHolderPercent: 18.4,
    devPercent: 7.1,
    sniperPercent: 3.9,
    bondingProgress: 82,
    liquidityUsd: 1_940_000,
    priceUsd: 0.8421,
    priceChange5m: 2.4,
    trustScore: 84,
    riskLevel: 'safe',
    isBundled: false,
    priceChange1h: 8.1,
    priceChange6h: 12.9,
    priceChange24h: 28.3,
  },
  {
    address: 'So11111111111111111111111111111111111111113',
    symbol: 'MIST',
    name: 'Mist Relay',
    chain: 'solana',
    stage: 'new',
    createdAt: new Date().toISOString(),
    marketCap: 3_120_000,
    volume24h: 954_000,
    holders: 2140,
    topHolderPercent: 27.8,
    devPercent: 12.6,
    sniperPercent: 8.4,
    liquidityUsd: 412_000,
    priceUsd: 0.0842,
    priceChange5m: -1.9,
    trustScore: 56,
    riskLevel: 'caution',
    isBundled: true,
    bundleCount: 3,
    priceChange1h: 3.8,
    priceChange6h: 11.2,
    priceChange24h: 18.7,
  },
]

function TokenInspectorLab() {
  const [query, setQuery] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState('KAZE')
  const [mode, setMode] = useState('inspector')

  const filteredTokens = tokens.filter((token) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      token.symbol.toLowerCase().includes(q) ||
      token.name.toLowerCase().includes(q) ||
      token.chain.toLowerCase().includes(q)
    )
  })

  const selectedToken = tokens.find((token) => token.symbol === selectedSymbol) ?? tokens[0]

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">token detail slice</TerminalStatusPill>}
            title="Provider-free token inspector rebuild lab"
            description="This replaces the dense live token-detail panel with a Storybook-first inspector. The goal is a readable decision surface, not an everything-at-once dump."
            meta={<TerminalMetricCard label="Selected" value={selectedToken.symbol} tone="sky" />}
          />

          <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
            <TerminalInset>
              <div className="grid gap-3">
                <TerminalTextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search sample tokens"
                />

                <TerminalSegmentedTabs
                  activeId={mode}
                  onChange={setMode}
                  options={[
                    { id: 'inspector', label: 'Inspector', meta: 'decision view' },
                    { id: 'metrics', label: 'Metrics', meta: 'detail heavy' },
                  ]}
                />

                <div className="grid gap-2">
                  {filteredTokens.map((token) => (
                    <button
                      key={token.address}
                      onClick={() => setSelectedSymbol(token.symbol)}
                      className={`border px-3 py-3 text-left transition-colors [border-radius:var(--terminal-radius-inset)] ${
                        token.symbol === selectedSymbol
                          ? 'border-terminal-border-active bg-white [box-shadow:var(--terminal-shadow-raised)]'
                          : 'border-terminal-border bg-terminal-bg-secondary hover:bg-white'
                      }`}
                    >
                      <div className="text-sm font-semibold text-terminal-text">{token.symbol}</div>
                      <div className="mt-1 text-xs text-terminal-text-secondary">{token.name}</div>
                      <div className="terminal-theme-caption mt-2 text-[10px] uppercase text-terminal-text-muted">
                        {token.chain} · {token.stage.replace('_', ' ')}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <TerminalButton variant="secondary">Track token</TerminalButton>
                  <TerminalButton>Open trade</TerminalButton>
                </div>
              </div>
            </TerminalInset>

            <TerminalTokenInspector token={selectedToken} />
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Token Inspector Rebuild Lab',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <TokenInspectorLab />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
