import type { Meta, StoryObj } from '@storybook/react'
import { AnimatedNumber, ChainBadge, ImpactIndicator, ProviderLogo, TokenPair } from '../components/swap/primitives'

const meta = {
  title: 'Design System/Swap Tokens',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', padding: '1rem' }}>
      <TokenPair fromSymbol="ETH" toSymbol="USDC" fromChain="Base" toChain="Ethereum" />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <ProviderLogo provider="lifi" />
        <ProviderLogo provider="socket" />
        <ProviderLogo provider="cctp" />
      </div>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <ChainBadge chain="Base" />
        <ImpactIndicator impact={0.42} />
        <AnimatedNumber prefix="$" value={3025.44} />
      </div>
    </div>
  ),
}
