import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import {
  TerminalButton,
  TerminalIconButton,
  TerminalKeyHint,
  TerminalSegmentedTabs,
  TerminalSelectPill,
  TerminalTextField,
  TerminalTokenPill,
} from '../../components/foundation/TerminalControls'
import {
  TerminalInset,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from '../../components/foundation/TerminalPrimitives'

function ControlsBoard() {
  const [search, setSearch] = useState('SOL / stable route')
  const [activeTab, setActiveTab] = useState('overview')
  const [activeChain, setActiveChain] = useState('ethereum')

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-6xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">terminal atoms</TerminalStatusPill>}
            title="Control language for the new terminal"
            description="These are the first shared controls that bigger surfaces should compose from. The current app recreates many of these ad hoc."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <TerminalInset>
              <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Buttons
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TerminalButton>Primary action</TerminalButton>
                <TerminalButton variant="secondary">Secondary action</TerminalButton>
                <TerminalButton variant="ghost">Ghost action</TerminalButton>
                <TerminalIconButton label="Refresh">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </TerminalIconButton>
              </div>
            </TerminalInset>

            <TerminalInset>
              <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Text field
              </div>
              <div className="mt-3 grid gap-3">
                <TerminalTextField
                  label="Search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search token, wallet, or route"
                  prefix={
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                  suffix={<TerminalKeyHint>⌘K</TerminalKeyHint>}
                />
              </div>
            </TerminalInset>
          </div>
        </TerminalPanel>

        <div className="grid gap-4 lg:grid-cols-2">
          <TerminalPanel>
            <TerminalPanelHeader
              eyebrow={<TerminalStatusPill>selection</TerminalStatusPill>}
              title="Tabs and select pills"
              description="These should replace panel-specific toggles and chain selectors."
            />
            <div className="grid gap-4">
              <TerminalSegmentedTabs
                activeId={activeTab}
                onChange={setActiveTab}
                options={[
                  { id: 'overview', label: 'Overview', meta: 'macro' },
                  { id: 'markets', label: 'Markets', meta: 'execution' },
                  { id: 'signals', label: 'Signals', meta: 'alerts' },
                ]}
              />

              <div className="flex flex-wrap gap-2">
                <TerminalSelectPill
                  label="Ethereum"
                  detail="main route"
                  active={activeChain === 'ethereum'}
                  onClick={() => setActiveChain('ethereum')}
                  leading={<span className="text-chain-ethereum">⟠</span>}
                />
                <TerminalSelectPill
                  label="Solana"
                  detail="fast lane"
                  active={activeChain === 'solana'}
                  onClick={() => setActiveChain('solana')}
                  leading={<span className="text-chain-solana">◎</span>}
                />
                <TerminalSelectPill
                  label="Base"
                  detail="bridge edge"
                  active={activeChain === 'base'}
                  onClick={() => setActiveChain('base')}
                  leading={<span className="text-chain-base">●</span>}
                />
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel>
            <TerminalPanelHeader
              eyebrow={<TerminalStatusPill tone="sky">identity</TerminalStatusPill>}
              title="Token pills and keyboard hints"
              description="Small identity atoms should be standardized too."
            />
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <TerminalTokenPill symbol="ETH" label="Ethereum" />
                <TerminalTokenPill symbol="SOL" label="Solana" tone="sky" />
                <TerminalTokenPill symbol="USDC" label="Stable reserve" tone="warm" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TerminalKeyHint>⌘K</TerminalKeyHint>
                <TerminalKeyHint>⇧F</TerminalKeyHint>
                <TerminalKeyHint>1</TerminalKeyHint>
              </div>
            </div>
          </TerminalPanel>
        </div>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Atoms/Terminal Controls',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <ControlsBoard />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
