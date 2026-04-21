import type { Meta, StoryObj } from '@storybook/react'
import { WalletProfileCard } from '../../components/tracker/WalletProfileCard'
import { SummerBreezeStoryFrame, SummerBreezeSurface } from '../_components/SummerBreezeStoryFrame'
import {
  trackedWallet,
  walletActivities,
  walletStats,
} from '../_fixtures/terminal'

function WalletProfileBoard() {
  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal molecule"
      title="Wallet detail cards for tracked traders and vaults"
      description="This is the profile surface behind wallet tracking. Storybook lets you refine PnL emphasis, holdings density, and trade ordering before the live feed is connected."
      metricLabel="Tracked view"
      metricValue="Treasury lane"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <SummerBreezeSurface
          title="Profile card"
          description="A tracked wallet with stats, top holdings, and recent trade history."
          meta="173 trades"
        >
          <div className="rounded-[22px] border border-[#ECE0CB] bg-[#171418] text-[#F6EEF1]">
            <WalletProfileCard
              wallet={trackedWallet}
              stats={walletStats}
              recentTrades={walletActivities}
              onRemove={() => undefined}
              onBack={() => undefined}
            />
          </div>
        </SummerBreezeSurface>

        <SummerBreezeSurface
          title="Quiet state"
          description="A simpler variant for newly added wallets that have not accumulated much history yet."
          meta="empty history"
        >
          <div className="rounded-[22px] border border-[#ECE0CB] bg-[#171418] text-[#F6EEF1]">
            <WalletProfileCard
              wallet={{ ...trackedWallet, label: 'Fresh scout' }}
              recentTrades={[]}
              onRemove={() => undefined}
              onBack={() => undefined}
            />
          </div>
        </SummerBreezeSurface>
      </div>
    </SummerBreezeStoryFrame>
  )
}

const meta = {
  title: 'Molecules/Wallet Profile Card',
  component: WalletProfileCard,
  tags: ['autodocs'],
  args: {
    wallet: trackedWallet,
    stats: walletStats,
    recentTrades: walletActivities,
    onRemove: () => undefined,
    onBack: () => undefined,
  },
  render: (args) => (
    <div className="max-w-3xl rounded-3xl bg-[#171418] p-2 text-[#F6EEF1]">
      <WalletProfileCard {...args} />
    </div>
  ),
} satisfies Meta<typeof WalletProfileCard>

export default meta

type Story = StoryObj<typeof meta>

export const ActiveWallet: Story = {}

export const EmptyHistory: Story = {
  args: {
    stats: undefined,
    recentTrades: [],
  },
}

export const SummerBreeze: Story = {
  render: () => <WalletProfileBoard />,
}
