import type { Meta, StoryObj } from '@storybook/react'
import { TerminalButton, TerminalSelectPill, TerminalTextField, TerminalTokenPill } from '../../components/foundation/TerminalControls'
import { TerminalChainBadge, TerminalKeyValueRow } from '../../components/foundation/TerminalDataDisplay'
import { TerminalInset, TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'

function ThemeModesBoard() {
  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-6xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">global theme layer</TerminalStatusPill>}
            title="Terminal theme modes"
            description="Use the Storybook toolbar to switch between Precision, Desk, and Studio. The rebuilt terminal stories now inherit the same surface, radius, shadow, and control language through one theme scope."
            meta={<TerminalMetricCard label="Scope" value="global" tone="sky" />}
          />

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <TerminalInset className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <TerminalStatusPill tone="sky">execution desk</TerminalStatusPill>
                <TerminalChainBadge chain="ethereum" />
                <TerminalTokenPill symbol="KAZE" label="focus token" tone="neutral" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <TerminalTextField label="Search" defaultValue="ETH / KAZE" />
                <TerminalTextField label="Size" defaultValue="0.75" mono />
              </div>

              <div className="flex flex-wrap gap-2">
                <TerminalSelectPill label="Ethereum" detail="deep liquidity" active />
                <TerminalSelectPill label="Solana" detail="fast lane" />
                <TerminalSelectPill label="Base" detail="bridge edge" />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <TerminalMetricCard label="Route quality" value="Clean" detail="single handoff" />
                <TerminalMetricCard label="Impact" value="0.18%" detail="healthy depth" tone="sky" />
                <TerminalMetricCard label="Risk" value="Safe band" detail="trust 84 / 100" />
              </div>

              <div className="flex flex-wrap gap-2">
                <TerminalButton>Open trade module</TerminalButton>
                <TerminalButton variant="secondary">Save route</TerminalButton>
              </div>
            </TerminalInset>

            <TerminalInset className="grid gap-2">
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                What changes globally
              </div>
              <TerminalKeyValueRow
                label="Surfaces"
                value="panel + inset"
                detail="Panel curvature, fill, and elevation come from the theme scope now."
              />
              <TerminalKeyValueRow
                label="Controls"
                value="inputs + pills + tabs"
                detail="Control radius and control shadows are no longer hardcoded per component."
              />
              <TerminalKeyValueRow
                label="Typography accents"
                value="heading + caption rhythm"
                detail="Heading and uppercase tracking are theme variables instead of repeated magic numbers."
              />
              <TerminalKeyValueRow
                label="Theme workflow"
                value="toolbar first"
                detail="Pick the right global mode here, then tighten the values in one place."
              />
            </TerminalInset>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Foundations/Terminal Theme Modes',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <ThemeModesBoard />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
