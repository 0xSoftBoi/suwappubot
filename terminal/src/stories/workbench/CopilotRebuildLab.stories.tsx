import { useEffect, useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalCopilotSidebar, TerminalCopilotSurface, type TerminalCopilotArtifact, type TerminalCopilotMessage, type TerminalCopilotSuggestion } from '../../components/copilot/TerminalCopilotSurface'
import { TerminalButton, TerminalSegmentedTabs, TerminalSelectPill, TerminalTextField } from '../../components/foundation/TerminalControls'
import { TerminalKeyValueRow } from '../../components/foundation/TerminalDataDisplay'
import { TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'

type DeskMode = 'execution' | 'risk' | 'portfolio'

function baseMessages(mode: DeskMode): TerminalCopilotMessage[] {
  if (mode === 'risk') {
    return [
      {
        id: 'risk-base',
        role: 'assistant',
        content:
          'I rebuilt the risk desk response as a structured operator brief. This is the behavior we want when the copilot surfaces why a setup is unsafe, not just that it is unsafe.',
        timestamp: '09:18',
        status: 'risk brief',
        artifacts: [
          {
            id: 'risk-brief',
            eyebrow: 'risk check',
            title: 'MIST still needs monitoring before size',
            description:
              'The concentration profile improved slightly, but dev and early-bot exposure still deserve caution relative to the current liquidity base.',
            tone: 'warm',
            chain: 'solana',
            tokenSymbol: 'MIST',
            tokenLabel: 'Mist Relay',
            metrics: [
              { label: 'Trust', value: '56 / 100', detail: 'below preferred entry band' },
              { label: 'Top holders', value: '27.8%', detail: 'watch for clustered exits' },
              { label: 'Liquidity', value: '$412k', detail: 'not deep enough for size' },
            ],
            rows: [
              { label: 'Dev wallet', value: '12.6%', detail: 'still elevated' },
              { label: 'Sniper share', value: '8.4%', detail: 'acceptable, not ideal' },
              { label: 'Action', value: 'Monitor only', detail: 'wait for holder dispersion' },
            ],
            secondaryAction: 'Track token',
            primaryAction: 'Open inspector',
          },
        ],
      },
    ]
  }

  if (mode === 'portfolio') {
    return [
      {
        id: 'portfolio-base',
        role: 'assistant',
        content:
          'The portfolio desk should feel like an operator console, not a chat box. The copilot needs to summarize concentration, dry powder, and next-best actions in one readable surface.',
        timestamp: '11:02',
        status: 'portfolio snapshot',
        artifacts: [
          {
            id: 'portfolio-brief',
            eyebrow: 'portfolio brief',
            title: 'Capital is still concentrated in majors',
            description:
              'You have enough stablecoin depth to deploy into high-conviction setups, but concentration stays skewed toward ETH and SOL.',
            tone: 'sky',
            chain: 'ethereum',
            tokenSymbol: 'USDC',
            tokenLabel: 'Dry powder',
            metrics: [
              { label: 'Stable cash', value: '$42.8k', detail: 'ready for staged entries' },
              { label: 'ETH weight', value: '38%', detail: 'largest exposure' },
              { label: 'SOL weight', value: '24%', detail: 'second largest' },
            ],
            rows: [
              { label: 'Highest conviction', value: 'KAZE', detail: 'best tactical setup today' },
              { label: 'Most crowded', value: 'PEPE', detail: 'trim candidate' },
            ],
            secondaryAction: 'Open allocations',
            primaryAction: 'Stage rebalance',
          },
        ],
      },
    ]
  }

  return [
    {
      id: 'execution-base',
      role: 'assistant',
      content:
        'The command surface should return action cards that feel native to the terminal. This execution desk version keeps the route summary, decision context, and handoff controls in one place.',
      timestamp: '14:41',
      status: 'route staged',
      artifacts: [
        {
          id: 'execution-route',
          eyebrow: 'route preview',
          title: 'Best path: ETH -> USDC -> KAZE',
          description:
            'A compact trade brief is more useful than a generic assistant paragraph when the user wants to move from research into execution.',
          tone: 'sky',
          chain: 'ethereum',
          tokenSymbol: 'KAZE',
          tokenLabel: 'Kaze Finance',
          metrics: [
            { label: 'Expected out', value: '18,420 KAZE', detail: '0.75 ETH notional' },
            { label: 'Impact', value: '0.18%', detail: 'book depth looks healthy' },
            { label: 'Slippage', value: '0.45%', detail: 'below current limit' },
          ],
          rows: [
            { label: 'Trust score', value: '84 / 100', detail: 'safe band' },
            { label: 'Execution quality', value: 'Clean', detail: 'no fragmented hops' },
          ],
          secondaryAction: 'Save route',
          primaryAction: 'Open trade module',
        },
      ],
    },
  ]
}

function suggestionsForMode(mode: DeskMode): TerminalCopilotSuggestion[] {
  if (mode === 'risk') {
    return [
      { id: 's1', label: 'Tell me why MIST is risky', detail: 'risk' },
      { id: 's2', label: 'Compare holders to liquidity', detail: 'risk' },
      { id: 's3', label: 'Should I size in now?', detail: 'risk' },
    ]
  }

  if (mode === 'portfolio') {
    return [
      { id: 's4', label: 'Summarize portfolio concentration', detail: 'portfolio' },
      { id: 's5', label: 'What should I trim first?', detail: 'portfolio' },
      { id: 's6', label: 'Stage a rebalance plan', detail: 'portfolio' },
    ]
  }

  return [
    { id: 's7', label: 'Route 0.75 ETH into KAZE', detail: 'execution' },
    { id: 's8', label: 'Set breakout alert for KAZE', detail: 'automation' },
    { id: 's9', label: 'Add route to my watchlist', detail: 'workflow' },
  ]
}

function responseForPrompt(prompt: string, mode: DeskMode): TerminalCopilotMessage {
  const lowered = prompt.toLowerCase()

  if (mode === 'risk' || lowered.includes('risk') || lowered.includes('holder')) {
    return {
      id: `reply-${prompt}`,
      role: 'assistant',
      content:
        'The main issue is still concentration against available liquidity. The right behavior here is a monitor-first workflow, not immediate execution.',
      timestamp: '09:20',
      status: 'risk verdict',
    }
  }

  if (mode === 'portfolio' || lowered.includes('portfolio') || lowered.includes('rebalance')) {
    return {
      id: `reply-${prompt}`,
      role: 'assistant',
      content:
        'A good portfolio response should drive a next action. In this case that means staging a rebalance card or alert instead of just restating balances.',
      timestamp: '11:04',
      status: 'allocation plan',
    }
  }

  return {
    id: `reply-${prompt}`,
    role: 'assistant',
    content:
      'Execution looks clean. The terminal should treat this as an operator handoff point and keep the route card visible until the trade module opens.',
    timestamp: '14:43',
    status: 'desk assist',
  }
}

function statusMeta(mode: DeskMode) {
  if (mode === 'risk') {
    return {
      status: 'desk caution',
      statusTone: 'warm' as const,
      focusChain: 'solana',
      focusToken: { symbol: 'MIST', label: 'Mist Relay', tone: 'warm' as const },
    }
  }

  if (mode === 'portfolio') {
    return {
      status: 'capital review',
      statusTone: 'sky' as const,
      focusChain: 'ethereum',
      focusToken: { symbol: 'USDC', label: 'Portfolio cash', tone: 'sky' as const },
    }
  }

  return {
    status: 'desk ready',
    statusTone: 'sky' as const,
    focusChain: 'ethereum',
    focusToken: { symbol: 'KAZE', label: 'Kaze Finance', tone: 'sky' as const },
  }
}

function CopilotLab() {
  const [mode, setMode] = useState<DeskMode>('execution')
  const [query, setQuery] = useState('')
  const [selectedPack, setSelectedPack] = useState('operator')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<TerminalCopilotMessage[]>(() => baseMessages('execution'))
  const [lastAction, setLastAction] = useState('No action triggered yet')

  useEffect(() => {
    setMessages(baseMessages(mode))
    setDraft('')
  }, [mode])

  const suggestions = useMemo(() => suggestionsForMode(mode), [mode])
  const filteredSuggestions = suggestions.filter((suggestion) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return suggestion.label.toLowerCase().includes(q) || (suggestion.detail ?? '').toLowerCase().includes(q)
  })

  const pushPrompt = (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    setMessages((current) => [
      ...current,
      {
        id: `user-${trimmed}`,
        role: 'user',
        content: trimmed,
        timestamp: mode === 'risk' ? '09:19' : mode === 'portfolio' ? '11:03' : '14:42',
      },
      responseForPrompt(trimmed, mode),
    ])
    setDraft('')
  }

  const recordArtifactAction = (prefix: string) => (artifact: TerminalCopilotArtifact) => {
    setLastAction(`${prefix}: ${artifact.title}`)
  }

  const currentMeta = statusMeta(mode)

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">copilot slice</TerminalStatusPill>}
            title="Provider-free copilot rebuild lab"
            description="This workbench lets us redesign the terminal copilot in isolation. The goal is a command desk that composes structured terminal primitives instead of shipping app-hooked chat UI."
            meta={<TerminalMetricCard label="Mode" value={mode} tone={currentMeta.statusTone} />}
          />

          <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
            <div className="grid gap-4">
              <TerminalCopilotSidebar
                title="Command desk"
                description="Pick the mode first, then refine prompt packs and command language before the live panel consumes any of it."
              >
                <TerminalSegmentedTabs
                  activeId={mode}
                  onChange={(value) => setMode(value as DeskMode)}
                  options={[
                    { id: 'execution', label: 'Execution', meta: 'route' },
                    { id: 'risk', label: 'Risk', meta: 'inspect' },
                    { id: 'portfolio', label: 'Portfolio', meta: 'allocate' },
                  ]}
                />

                <TerminalTextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter prompt packs"
                />

                <div className="flex flex-wrap gap-2">
                  {['operator', 'alerts', 'risk cards'].map((pack) => (
                    <TerminalSelectPill
                      key={pack}
                      label={pack}
                      detail="pack"
                      active={selectedPack === pack}
                      onClick={() => setSelectedPack(pack)}
                    />
                  ))}
                </div>

                <div className="grid gap-2">
                  {filteredSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      onClick={() => pushPrompt(suggestion.label)}
                      className="border border-terminal-border bg-white px-3 py-3 text-left transition-colors hover:border-terminal-border-active hover:[box-shadow:var(--terminal-shadow-raised)] [border-radius:var(--terminal-radius-inset)]"
                    >
                      <div className="text-sm font-semibold text-terminal-text">{suggestion.label}</div>
                      <div className="terminal-theme-caption mt-1 text-[10px] uppercase text-terminal-text-muted">
                        {suggestion.detail}
                      </div>
                    </button>
                  ))}
                </div>
              </TerminalCopilotSidebar>

              <TerminalCopilotSidebar
                title="Composition notes"
                description="These are the pieces that become reusable once the copilot is rebuilt as a terminal surface instead of a special-case chat box."
              >
                <TerminalKeyValueRow
                  label="Reusable parts"
                  value="message rail"
                  detail="Bubbles, action cards, and composer can be shared across execution, portfolio, and alert workflows."
                />
                <TerminalKeyValueRow
                  label="Interaction shift"
                  value="action-first"
                  detail="Return cards and handoffs, not generic assistant prose."
                />
                <TerminalKeyValueRow
                  label="Last action"
                  value={lastAction}
                  detail="Useful to test button labels and card affordances in Storybook."
                />
              </TerminalCopilotSidebar>
            </div>

            <div className="grid gap-4">
              <TerminalCopilotSurface
                messages={messages}
                suggestions={suggestions}
                draft={draft}
                onDraftChange={setDraft}
                onSend={() => pushPrompt(draft)}
                onSuggestionSelect={pushPrompt}
                onPrimaryAction={recordArtifactAction('primary')}
                onSecondaryAction={recordArtifactAction('secondary')}
                status={currentMeta.status}
                statusTone={currentMeta.statusTone}
                modeLabel={mode}
                focusChain={currentMeta.focusChain}
                focusToken={currentMeta.focusToken}
              />

              <div className="grid gap-4 md:grid-cols-3">
                <TerminalMetricCard
                  label="What changed"
                  value="chat panel -> command desk"
                  detail="The rebuilt surface treats the copilot as a terminal operator, not a generic assistant."
                />
                <TerminalMetricCard
                  label="What becomes reusable"
                  value="artifact cards"
                  detail="Route previews, risk briefs, and allocation summaries can share one card language."
                  tone="warm"
                />
                <TerminalMetricCard
                  label="Next live port"
                  value="replace CopilotPanel shell"
                  detail="Once the message rail and composer feel right here, port them into the live panel behind the hook."
                  tone="sky"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <TerminalButton variant="secondary" onClick={() => setMessages(baseMessages(mode))}>
                  Reset conversation
                </TerminalButton>
                <TerminalButton onClick={() => pushPrompt('Stage the next best action')}>
                  Trigger sample follow-up
                </TerminalButton>
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Copilot Rebuild Lab',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <CopilotLab />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
