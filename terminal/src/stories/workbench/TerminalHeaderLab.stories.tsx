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
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from '../../components/foundation/TerminalPrimitives'

type ViewMode = 'desktop' | 'compact'

const workspaceOptions = [
  { id: 'trade', label: 'Trade', meta: 'primary' },
  { id: 'discover', label: 'Discover', meta: 'scan' },
  { id: 'copilot', label: 'Copilot', meta: 'guide' },
]

const chainOptions = [
  { id: 'ethereum', label: 'Ethereum', detail: 'deep liquidity', icon: '⟠', className: 'text-chain-ethereum' },
  { id: 'solana', label: 'Solana', detail: 'fast lane', icon: '◎', className: 'text-chain-solana' },
  { id: 'base', label: 'Base', detail: 'bridge edge', icon: '●', className: 'text-chain-base' },
]

function HeaderPrototype({ mode }: { mode: ViewMode }) {
  const [workspace, setWorkspace] = useState('trade')
  const [chain, setChain] = useState('ethereum')
  const [search, setSearch] = useState('ETH / USDC')

  const compact = mode === 'compact'

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">header slice</TerminalStatusPill>}
            title="Provider-free terminal header lab"
            description="This is the first composed slice of the redesign. It replaces the current provider-bound header exploration with a Storybook-first prototype we can iterate on safely."
            meta={<TerminalMetricCard label="Viewport" value={mode} tone="sky" />}
          />

          <TerminalInset className="overflow-hidden p-0">
            <div className="border-b border-terminal-border bg-white/90 px-4 py-3">
              <div className={`flex ${compact ? 'flex-col' : 'items-center justify-between'} gap-3`}>
                <div className="flex items-center gap-3">
                  <div className="rounded-suwappu-xxl border border-sakura-300 bg-sakura-50 px-3 py-2">
                    <div className="text-sm font-semibold tracking-[-0.04em] text-terminal-text">
                      SUWAPPU
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                      Terminal
                    </div>
                  </div>
                  {!compact ? <TerminalKeyHint>⌘K</TerminalKeyHint> : null}
                </div>

                <div className={`flex ${compact ? 'w-full flex-col' : 'items-center'} gap-2`}>
                  <TerminalTextField
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Find pair, wallet, or task"
                    className={compact ? 'w-full' : 'w-[240px]'}
                    prefix={
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    }
                  />
                  <TerminalButton variant="secondary">Connect wallet</TerminalButton>
                </div>
              </div>
            </div>

            <div className="grid gap-3 px-4 py-4">
              <div className={`flex ${compact ? 'flex-col' : 'items-center justify-between'} gap-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  {chainOptions.map((option) => (
                    <TerminalSelectPill
                      key={option.id}
                      label={option.label}
                      detail={option.detail}
                      active={chain === option.id}
                      onClick={() => setChain(option.id)}
                      leading={<span className={option.className}>{option.icon}</span>}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <TerminalTokenPill symbol="ETH" label="base asset" />
                  <TerminalTokenPill symbol="USDC" label="quote" tone="warm" />
                  <TerminalIconButton label="Notifications">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
                    </svg>
                  </TerminalIconButton>
                  <TerminalIconButton label="Settings">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a1 1 0 011.35-.936l1.69.676a1 1 0 00.95-.088l1.476-.984a1 1 0 011.306.143l1.2 1.2a1 1 0 01.143 1.306l-.984 1.476a1 1 0 00-.088.95l.676 1.69a1 1 0 01-.936 1.35l-1.79.112a1 1 0 00-.84.556l-.8 1.604a1 1 0 01-1.2.51l-1.746-.498a1 1 0 00-.992.18l-1.368 1.192a1 1 0 01-1.314 0l-1.368-1.193a1 1 0 00-.992-.179l-1.746.498a1 1 0 01-1.2-.51l-.8-1.604a1 1 0 00-.84-.556l-1.79-.112a1 1 0 01-.936-1.35l.676-1.69a1 1 0 00-.088-.95L3.6 6.006a1 1 0 01.143-1.306l1.2-1.2a1 1 0 011.306-.143l1.476.984a1 1 0 00.95.088l1.69-.676z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </TerminalIconButton>
                </div>
              </div>

              <TerminalSegmentedTabs
                activeId={workspace}
                onChange={setWorkspace}
                options={workspaceOptions}
              />
            </div>
          </TerminalInset>
        </TerminalPanel>

        <div className="grid gap-4 lg:grid-cols-3">
          <TerminalMetricCard
            label="What this replaces"
            value="provider-bound header experimentation"
            detail="Search, chain, pair, wallet action, and workspace tabs should be tested here first."
          />
          <TerminalMetricCard
            label="Atoms in use"
            value="button, icon button, text field, select pill, tabs, token pill"
            tone="warm"
          />
          <TerminalMetricCard
            label="Next extraction"
            value="move these atoms into the real header and toolbar"
            tone="sky"
          />
        </div>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Terminal Header Lab',
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    mode: 'desktop' as ViewMode,
  },
  render: ({ mode }) => <HeaderPrototype mode={mode} />,
} satisfies Meta<{ mode: ViewMode }>

export default meta

type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const Compact: Story = {
  args: {
    mode: 'compact',
  },
}
