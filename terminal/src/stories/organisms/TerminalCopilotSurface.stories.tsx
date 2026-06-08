import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalCopilotSurface, type TerminalCopilotMessage, type TerminalCopilotSuggestion } from '../../components/copilot/TerminalCopilotSurface'
import { TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'

type SurfaceMode = 'execution' | 'risk'

function messageTimestamp(label: string) {
  return label
}

function buildStarterMessages(mode: SurfaceMode): TerminalCopilotMessage[] {
  if (mode === 'risk') {
    return [
      {
        id: 'risk-1',
        role: 'assistant',
        content:
          'MIST looks tradable, but the holder distribution still needs caution. The first thing I would check is concentration versus current liquidity before staging any size.',
        timestamp: messageTimestamp('09:14'),
        status: 'risk scan',
        artifacts: [
          {
            id: 'risk-card',
            eyebrow: 'risk brief',
            title: 'Holder concentration is the main pressure point',
            description:
              'Top holders still control enough supply to move price aggressively on thin volume. Size smaller or wait for holder dispersion to improve.',
            tone: 'warm',
            chain: 'solana',
            tokenSymbol: 'MIST',
            tokenLabel: 'Mist Relay',
            metrics: [
              { label: 'Trust', value: '56 / 100', detail: 'below desired entry band' },
              { label: 'Top holders', value: '27.8%', detail: 'watch for cluster wallets' },
              { label: 'Liquidity', value: '$412k', detail: 'adequate, not deep' },
            ],
            rows: [
              { label: 'Dev wallet', value: '12.6%', detail: 'still above target threshold' },
              { label: 'Sniper share', value: '8.4%', detail: 'moderate early-bot pressure' },
            ],
            secondaryAction: 'Add to monitor',
            primaryAction: 'Open inspector',
          },
        ],
      },
    ]
  }

  return [
    {
      id: 'exec-1',
      role: 'assistant',
      content:
        'I staged a cleaner route for KAZE with enough liquidity behind it. The panel below is the exact sort of action card we want the live terminal to emit instead of raw text.',
      timestamp: messageTimestamp('14:32'),
      status: 'route staged',
      artifacts: [
        {
          id: 'exec-card',
          eyebrow: 'route preview',
          title: 'Best path: ETH -> USDC -> KAZE',
          description:
            'Execution stays inside the terminal desk and gives you a readable route summary before handing off to the trade module.',
          tone: 'sky',
          chain: 'ethereum',
          tokenSymbol: 'KAZE',
          tokenLabel: 'Kaze Finance',
          metrics: [
            { label: 'Expected out', value: '18,420 KAZE', detail: '0.75 ETH notional' },
            { label: 'Slippage', value: '0.45%', detail: 'inside operator target' },
            { label: 'Impact', value: '0.18%', detail: 'healthy book depth' },
          ],
          rows: [
            { label: 'Execution quality', value: 'Clean', detail: 'no fragmented routing needed' },
            { label: 'Trust score', value: '84 / 100', detail: 'safe band' },
          ],
          secondaryAction: 'Save route',
          primaryAction: 'Open trade module',
        },
      ],
    },
  ]
}

function buildSuggestions(mode: SurfaceMode): TerminalCopilotSuggestion[] {
  return mode === 'risk'
    ? [
        { id: 'risk-brief', label: 'Summarize wallet concentration', detail: 'risk' },
        { id: 'risk-liquidity', label: 'Compare liquidity to holders', detail: 'risk' },
        { id: 'risk-entry', label: 'Tell me if entry is clean', detail: 'risk' },
      ]
    : [
        { id: 'exec-route', label: 'Route 0.75 ETH into KAZE', detail: 'execution' },
        { id: 'exec-watch', label: 'Add KAZE to watchlist', detail: 'workflow' },
        { id: 'exec-alert', label: 'Stage breakout alert', detail: 'automation' },
      ]
}

function buildAssistantResponse(prompt: string, mode: SurfaceMode): TerminalCopilotMessage {
  const lowered = prompt.toLowerCase()

  if (mode === 'risk' || lowered.includes('risk') || lowered.includes('holder')) {
    return {
      id: `assistant-${prompt}`,
      role: 'assistant',
      content:
        'The risk posture is usable but not clean. I would keep this in monitor mode until holder concentration or dev exposure relaxes.',
      timestamp: messageTimestamp('09:16'),
      status: 'risk verdict',
    }
  }

  return {
    id: `assistant-${prompt}`,
    role: 'assistant',
    content:
      'Execution is straightforward. The next useful behavior is turning this into a structured trade card, not another plain-text answer.',
    timestamp: messageTimestamp('14:34'),
    status: 'operator assist',
  }
}

function SurfaceStory({ mode }: { mode: SurfaceMode }) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState(() => buildStarterMessages(mode))

  const suggestions = useMemo(() => buildSuggestions(mode), [mode])

  const pushPrompt = (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    setMessages((current) => [
      ...current,
      {
        id: `user-${trimmed}`,
        role: 'user',
        content: trimmed,
        timestamp: mode === 'risk' ? '09:15' : '14:33',
      },
      buildAssistantResponse(trimmed, mode),
    ])
    setDraft('')
  }

  const statusTone = mode === 'risk' ? 'warm' : 'sky'

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-6xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">copilot slice</TerminalStatusPill>}
            title="Provider-free copilot surface"
            description="This story isolates the new command surface and artifact-card language so we can tighten interaction design before touching the live AI panel."
            meta={
              <TerminalMetricCard
                label="Focus"
                value={mode === 'risk' ? 'risk review' : 'execution assist'}
                tone={statusTone}
              />
            }
          />

          <TerminalCopilotSurface
            messages={messages}
            suggestions={suggestions}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => pushPrompt(draft)}
            onSuggestionSelect={pushPrompt}
            status={mode === 'risk' ? 'desk caution' : 'desk ready'}
            statusTone={statusTone}
            modeLabel={mode}
            focusChain={mode === 'risk' ? 'solana' : 'ethereum'}
            focusToken={
              mode === 'risk'
                ? { symbol: 'MIST', label: 'Mist Relay', tone: 'warm' }
                : { symbol: 'KAZE', label: 'Kaze Finance', tone: 'sky' }
            }
          />
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Organisms/Terminal Copilot Surface',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const ExecutionAssist: Story = {
  render: () => <SurfaceStory mode="execution" />,
}

export const RiskReview: Story = {
  render: () => <SurfaceStory mode="risk" />,
}
