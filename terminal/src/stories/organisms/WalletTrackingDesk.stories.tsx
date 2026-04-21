import type { Meta, StoryObj } from '@storybook/react'
import { WalletActivityFeed } from '../../components/tracker/WalletActivityFeed'
import { WalletProfileCard } from '../../components/tracker/WalletProfileCard'
import { SummerBreezeStoryFrame, SummerBreezeSurface } from '../_components/SummerBreezeStoryFrame'
import {
  trackedWallet,
  walletActivities,
  walletStats,
} from '../_fixtures/terminal'

type FeedMode = 'focused' | 'global'

function WalletTrackingDesk({ feedMode }: { feedMode: FeedMode }) {
  const filteredAddress = feedMode === 'focused' ? trackedWallet.address : undefined

  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal organism"
      title="Wallet tracker detail desk for profiles and market activity"
      description="This pairs the profile card with the activity table so wallet-tracking changes can be reviewed as a coherent terminal surface, not just as isolated components."
      metricLabel="Feed mode"
      metricValue={feedMode}
    >
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <SummerBreezeSurface
          title="Tracked wallet"
          description="The main profile card for a monitored address, including holdings and recent trades."
          meta={trackedWallet.label}
        >
          <div className="rounded-[24px] border border-[#2A232A] bg-[#151217] text-[#F6EEF1]">
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
          title="Activity tape"
          description="Flip between a wallet-specific feed and the shared activity stream."
          meta={feedMode === 'focused' ? 'filtered' : 'all wallets'}
        >
          <div className="overflow-hidden rounded-[24px] border border-[#2A232A] bg-[#151217] text-[#F6EEF1]">
            <div className="h-[420px]">
              <WalletActivityFeed
                activities={walletActivities}
                filterAddress={filteredAddress}
              />
            </div>
          </div>
        </SummerBreezeSurface>
      </div>
    </SummerBreezeStoryFrame>
  )
}

const meta = {
  title: 'Organisms/Wallet Tracking Desk',
  tags: ['autodocs'],
  args: {
    feedMode: 'focused' as FeedMode,
  },
  render: ({ feedMode }) => <WalletTrackingDesk feedMode={feedMode} />,
} satisfies Meta<{ feedMode: FeedMode }>

export default meta

type Story = StoryObj<typeof meta>

export const FocusedWallet: Story = {}

export const GlobalFeed: Story = {
  args: {
    feedMode: 'global',
  },
}
