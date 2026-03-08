import type { Meta, StoryObj } from '@storybook/react'
import { TokenBalance } from '../components/TokenBalance'
import { mockTokens } from './mockData'

const meta = {
  title: 'Components/TokenBalance',
  component: TokenBalance,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    token: {
      description: 'Token data to display',
    },
  },
} satisfies Meta<typeof TokenBalance>

export default meta
type Story = StoryObj<typeof meta>

export const Ethereum: Story = {
  args: {
    token: mockTokens[0], // ETH
  },
}

export const USDC: Story = {
  args: {
    token: mockTokens[1], // USDC
  },
}

export const Polygon: Story = {
  args: {
    token: mockTokens[2], // MATIC
  },
}

export const WithoutLogo: Story = {
  args: {
    token: mockTokens[3], // ARB - no logo
  },
}

export const Solana: Story = {
  args: {
    token: mockTokens[4], // SOL
  },
}

export const BSC: Story = {
  args: {
    token: mockTokens[5], // BNB
  },
}

export const SmallBalance: Story = {
  args: {
    token: {
      ...mockTokens[0],
      balance: '0.000123',
      usdValue: 0.22,
    },
  },
}

export const LargeBalance: Story = {
  args: {
    token: {
      ...mockTokens[1],
      balance: '1234567.89',
      usdValue: 1234567.89,
    },
  },
}
