import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import {
  TerminalDivider,
  TerminalEmptyState,
  TerminalEyebrow,
  TerminalInset,
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from '../../components/foundation/TerminalPrimitives'

type BuildLane = {
  title: string
  description: string
  items: string[]
}

const foundationsFirst: BuildLane[] = [
  {
    title: 'Foundations missing before composition',
    description:
      'These are the pieces the current terminal skips and hand-builds inside each panel.',
    items: [
      'App shell and surface scale',
      'Panel header and section header',
      'Typographic roles for labels, titles, and mono values',
      'Metric rail and stat cell foundations',
      'Empty, loading, and error states',
      'Divider, inset, and overlay surface rules',
    ],
  },
  {
    title: 'Atoms missing before composition',
    description:
      'These should exist as reusable pieces before we rebuild watchlists, order books, or detail inspectors.',
    items: [
      'Primary button, secondary button, icon button',
      'Input, search input, and select',
      'Tabs and segmented control',
      'Badge, status pill, chain badge, token avatar',
      'Key-value row and table header cell',
      'Progress bar, price bar, and inline delta text',
    ],
  },
  {
    title: 'Only then compose molecules and sections',
    description:
      'Once the foundation is stable, the terminal sections become composition work rather than styling work.',
    items: [
      'Filter bars and toolbars',
      'Token rows and order book rows',
      'Metric strips and inspector cards',
      'Watchlist, order book, discovery, copilot, and wallet desks',
    ],
  },
]

function FoundationBoard() {
  const [query, setQuery] = useState('ETH')
  const [activeTab, setActiveTab] = useState<'overview' | 'markets' | 'signals'>('overview')

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalEyebrow>Terminal foundations</TerminalEyebrow>}
            title="Design-system first rebuild base"
            description="This story is the source of truth for the first layer of the new terminal: surfaces, type roles, controls, state containers, and the build order we should follow before composing larger sections."
            meta={<TerminalMetricCard label="Current pass" value="Foundations + atoms" tone="warm" />}
          />

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <TerminalInset>
              <div className="flex flex-wrap items-center gap-2">
                <TerminalStatusPill tone="warm">professional theme</TerminalStatusPill>
                <TerminalStatusPill>shared tokens</TerminalStatusPill>
                <TerminalStatusPill tone="sky">provider-free storybook</TerminalStatusPill>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <TerminalMetricCard
                  label="Surface"
                  value="Panel / inset / overlay"
                  detail="Panels should compose from one shared scale."
                />
                <TerminalMetricCard
                  label="Typography"
                  value="Label / title / data"
                  detail="Semantic text roles replace one-off font decisions."
                  tone="sky"
                />
                <TerminalMetricCard
                  label="State"
                  value="Empty / loading / error"
                  detail="Panels stop inventing their own fallback patterns."
                  tone="warm"
                />
              </div>
            </TerminalInset>

            <TerminalInset>
              <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Working rules
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-terminal-text-secondary">
                <p>1. Make tokens authoritative.</p>
                <p>2. Make primitives reusable.</p>
                <p>3. Make sections compositional.</p>
                <p>4. Port only proven patterns into the app shell.</p>
              </div>
            </TerminalInset>
          </div>
        </TerminalPanel>

        <div className="grid gap-4 lg:grid-cols-2">
          <TerminalPanel>
            <TerminalPanelHeader
              eyebrow={<TerminalEyebrow tone="sky">Surface system</TerminalEyebrow>}
              title="Shared shells before panels"
              description="The terminal should stop inventing panel shells on every screen."
            />
            <div className="grid gap-3">
              <TerminalInset>
                <div className="text-[11px] uppercase tracking-[0.22em] text-terminal-text-muted">
                  Default inset
                </div>
                <div className="mt-2 text-lg font-semibold text-terminal-text">Quiet analysis space</div>
                <div className="mt-1 text-sm text-terminal-text-secondary">
                  Use this for sub-panels, forms, tables, and supportive modules.
                </div>
              </TerminalInset>
              <div className="rounded-suwappu-xxl border border-terminal-border bg-white/90 p-4 shadow-suwappu-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-terminal-text-muted">
                  Elevated card
                </div>
                <div className="mt-2 text-lg font-semibold text-terminal-text">Active focus surface</div>
                <div className="mt-1 text-sm text-terminal-text-secondary">
                  Use this for selected rows, inspectors, and command surfaces.
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel>
            <TerminalPanelHeader
              eyebrow={<TerminalEyebrow>Atoms in progress</TerminalEyebrow>}
              title="Controls should compose cleanly"
              description="These are still raw, but the point is to validate the control language in Storybook before reusing it across the terminal."
            />
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button className="terminal-button">Primary action</button>
                <button className="terminal-button-secondary">Secondary action</button>
                <button className="terminal-button-secondary px-3">Icon button shell</button>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="terminal-input"
                  placeholder="Search token, market, or wallet"
                />
                <button className="terminal-button-secondary">Search</button>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-terminal-border">
                {(['overview', 'markets', 'signals'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`terminal-tab ${activeTab === tab ? 'terminal-tab-active' : ''}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </TerminalPanel>
        </div>

        <TerminalPanel>
          <TerminalPanelHeader
            eyebrow={<TerminalEyebrow tone="warm">Build order</TerminalEyebrow>}
            title="What was not made first"
            description="The current terminal jumps directly into panels like watchlists and token detail views. This order should be inverted."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {foundationsFirst.map((lane) => (
              <TerminalInset key={lane.title}>
                <div className="text-sm font-semibold text-terminal-text">{lane.title}</div>
                <p className="mt-2 text-sm leading-6 text-terminal-text-secondary">
                  {lane.description}
                </p>
                <TerminalDivider />
                <div className="mt-3 grid gap-2">
                  {lane.items.map((item) => (
                    <div
                      key={item}
                      className="rounded-suwappu-xl border border-terminal-border bg-white/90 px-3 py-2 text-sm text-terminal-text-secondary"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </TerminalInset>
            ))}
          </div>
        </TerminalPanel>

        <TerminalPanel>
          <TerminalPanelHeader
            eyebrow={<TerminalEyebrow tone="sky">State pattern</TerminalEyebrow>}
            title="Shared empty states"
            description="Every panel should not invent its own empty screen copy, spacing, and action treatment."
          />
          <TerminalEmptyState
            title="No market module selected"
            description="Use one shared state container for empty terminal spaces, then swap only the copy and the action."
            action={<button className="terminal-button-secondary">Open build lane</button>}
          />
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Foundations/Terminal Foundations',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <FoundationBoard />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
