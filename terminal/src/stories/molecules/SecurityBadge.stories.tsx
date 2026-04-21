import type { Meta, StoryObj } from '@storybook/react'
import { SecurityBadge } from '../../components/discover/SecurityBadge'
import { SummerBreezeStoryFrame, SummerBreezeSurface } from '../_components/SummerBreezeStoryFrame'
import {
  cautionSecurity,
  dangerSecurity,
  safeSecurity,
} from '../_fixtures/terminal'

function RiskRail() {
  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal molecule"
      title="Discovery risk badges with expandable audit detail"
      description="The discovery tables rely on these small trust indicators. Storybook is a better place to tune severity language and detail density than the live data views."
      metricLabel="Coverage"
      metricValue="loading + 3 risk states"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <SummerBreezeSurface
          title="Inline table states"
          description="Compact tokens for safe, caution, danger, loading, and unavailable rows."
        >
          <div className="flex flex-wrap items-center gap-3">
            <SecurityBadge security={safeSecurity} />
            <SecurityBadge security={cautionSecurity} />
            <SecurityBadge security={dangerSecurity} />
            <SecurityBadge security={undefined} loading />
            <SecurityBadge security={null} />
          </div>
        </SummerBreezeSurface>

        <SummerBreezeSurface
          title="Compact score mode"
          description="Use the compact form when space is tight and the table already carries a risk label elsewhere."
          meta="dense rows"
        >
          <div className="flex flex-wrap items-center gap-3">
            <SecurityBadge security={safeSecurity} compact />
            <SecurityBadge security={cautionSecurity} compact />
            <SecurityBadge security={dangerSecurity} compact />
          </div>
        </SummerBreezeSurface>
      </div>
    </SummerBreezeStoryFrame>
  )
}

const meta = {
  title: 'Molecules/Security Badge',
  component: SecurityBadge,
  tags: ['autodocs'],
  args: {
    security: safeSecurity,
    loading: false,
    compact: false,
  },
} satisfies Meta<typeof SecurityBadge>

export default meta

type Story = StoryObj<typeof meta>

export const Safe: Story = {}

export const Caution: Story = {
  args: {
    security: cautionSecurity,
  },
}

export const Danger: Story = {
  args: {
    security: dangerSecurity,
  },
}

export const SummerBreeze: Story = {
  render: () => <RiskRail />,
}
