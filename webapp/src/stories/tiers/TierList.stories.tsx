import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { TierDisplay } from '../../components/tiers'
import '../../theme/suwappu.css'

const meta: Meta<typeof TierDisplay> = {
  title: 'Components/Tiers',
  component: TierDisplay,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'app',
      values: [{ name: 'app', value: '#FFFBFC' }],
    },
  },
}

export default meta
type Story = StoryObj<typeof TierDisplay>

function MobileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[360px] bg-suwappu-bg p-3 rounded-lg border border-suwappu-sakura-mid/30">
      {children}
    </div>
  )
}

export const Default: Story = {
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={3500} />
    </MobileFrame>
  ),
}

export const Interactive: Story = {
  name: 'Interactive XP Slider',
  render: () => {
    const [xp, setXp] = useState(3500)

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg p-4 shadow-sm w-[360px]">
          <p className="text-sm font-medium mb-2">Adjust XP:</p>
          <input
            type="range"
            min="0"
            max="150000"
            value={xp}
            onChange={(e) => setXp(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-center text-sm text-gray-500 mt-1">
            {xp.toLocaleString()} XP
          </p>
        </div>
        <MobileFrame>
          <TierDisplay currentXp={xp} />
        </MobileFrame>
      </div>
    )
  },
}

export const NewUser: Story = {
  name: 'New User (Bronze)',
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={0} />
    </MobileFrame>
  ),
}

export const SilverUser: Story = {
  name: 'Silver Tier',
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={2500} />
    </MobileFrame>
  ),
}

export const GoldUser: Story = {
  name: 'Gold Tier',
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={8500} />
    </MobileFrame>
  ),
}

export const PlatinumUser: Story = {
  name: 'Platinum Tier',
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={50000} />
    </MobileFrame>
  ),
}

export const DiamondUser: Story = {
  name: 'Diamond Tier (Max)',
  render: () => (
    <MobileFrame>
      <TierDisplay currentXp={150000} />
    </MobileFrame>
  ),
}
