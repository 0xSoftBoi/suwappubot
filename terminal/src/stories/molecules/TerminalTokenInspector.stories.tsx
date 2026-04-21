import type { Meta, StoryObj } from '@storybook/react'
import { TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'
import { TerminalTokenInspector } from '../../components/discover/TerminalTokenInspector'
import type { PulseToken } from '../../types/api'

const sampleToken: PulseToken = {
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
}

function Board() {
  return (
    <TerminalPage>
      <div className="mx-auto max-w-6xl">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">token inspector</TerminalStatusPill>}
            title="Inspector rebuild"
            description="A cleaner token-detail surface using the new inspector/display primitives."
          />
          <TerminalTokenInspector token={sampleToken} />
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Molecules/Terminal Token Inspector',
  component: TerminalTokenInspector,
  args: {
    token: sampleToken,
  },
} satisfies Meta<typeof TerminalTokenInspector>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const BoardView: Story = {
  render: () => <Board />,
}
