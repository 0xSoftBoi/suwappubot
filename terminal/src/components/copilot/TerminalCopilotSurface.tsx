import type { ReactNode } from 'react'
import { TerminalButton, TerminalKeyHint, TerminalSelectPill, TerminalTextField, TerminalTokenPill } from '../foundation/TerminalControls'
import { TerminalChainBadge, TerminalKeyValueRow } from '../foundation/TerminalDataDisplay'
import { TerminalInset, TerminalMetricCard, TerminalStatusPill } from '../foundation/TerminalPrimitives'

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

type Tone = 'neutral' | 'warm' | 'sky'

const bubbleToneClasses: Record<'assistant' | 'user', string> = {
  assistant: 'border-terminal-border bg-white/95 text-terminal-text',
  user: 'border-sakura-300 bg-sakura-50/90 text-terminal-text',
}

export interface TerminalCopilotArtifact {
  id: string
  eyebrow?: string
  title: string
  description: string
  tone?: Tone
  chain?: string
  tokenSymbol?: string
  tokenLabel?: string
  metrics?: Array<{
    label: string
    value: string
    detail?: string
  }>
  rows?: Array<{
    label: string
    value: string
    detail?: string
  }>
  primaryAction?: string
  secondaryAction?: string
}

export interface TerminalCopilotMessage {
  id: string
  role: 'assistant' | 'user'
  content: string
  timestamp: string
  status?: string
  artifacts?: TerminalCopilotArtifact[]
}

export interface TerminalCopilotSuggestion {
  id: string
  label: string
  detail?: string
}

export function TerminalCopilotArtifactCard({
  artifact,
  onPrimaryAction,
  onSecondaryAction,
}: {
  artifact: TerminalCopilotArtifact
  onPrimaryAction?: (artifact: TerminalCopilotArtifact) => void
  onSecondaryAction?: (artifact: TerminalCopilotArtifact) => void
}) {
  return (
    <TerminalInset className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {artifact.eyebrow ? (
          <TerminalStatusPill tone={artifact.tone ?? 'neutral'}>{artifact.eyebrow}</TerminalStatusPill>
        ) : null}
        {artifact.chain ? <TerminalChainBadge chain={artifact.chain} /> : null}
        {artifact.tokenSymbol ? (
          <TerminalTokenPill
            symbol={artifact.tokenSymbol}
            label={artifact.tokenLabel}
            tone={artifact.tone ?? 'neutral'}
          />
        ) : null}
      </div>

      <div className="mt-3 text-sm font-semibold text-terminal-text">{artifact.title}</div>
      <p className="mt-1 text-sm leading-6 text-terminal-text-secondary">{artifact.description}</p>

      {artifact.metrics?.length ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {artifact.metrics.map((metric) => (
            <TerminalMetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              detail={metric.detail}
              tone={artifact.tone ?? 'neutral'}
            />
          ))}
        </div>
      ) : null}

      {artifact.rows?.length ? (
        <div className="mt-3 grid gap-2">
          {artifact.rows.map((row) => (
            <TerminalKeyValueRow
              key={row.label}
              label={row.label}
              value={row.value}
              detail={row.detail}
            />
          ))}
        </div>
      ) : null}

      {artifact.primaryAction || artifact.secondaryAction ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {artifact.secondaryAction ? (
            <TerminalButton variant="secondary" size="sm" onClick={() => onSecondaryAction?.(artifact)}>
              {artifact.secondaryAction}
            </TerminalButton>
          ) : null}
          {artifact.primaryAction ? (
            <TerminalButton size="sm" onClick={() => onPrimaryAction?.(artifact)}>
              {artifact.primaryAction}
            </TerminalButton>
          ) : null}
        </div>
      ) : null}
    </TerminalInset>
  )
}

export function TerminalCopilotMessageBubble({
  message,
  onPrimaryAction,
  onSecondaryAction,
}: {
  message: TerminalCopilotMessage
  onPrimaryAction?: (artifact: TerminalCopilotArtifact) => void
  onSecondaryAction?: (artifact: TerminalCopilotArtifact) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={joinClasses('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={joinClasses(
          'max-w-[88%] rounded-suwappu-xxl border px-4 py-3 shadow-suwappu-2',
          bubbleToneClasses[message.role],
        )}
      >
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>

        {message.artifacts?.map((artifact) => (
          <TerminalCopilotArtifactCard
            key={artifact.id}
            artifact={artifact}
            onPrimaryAction={onPrimaryAction}
            onSecondaryAction={onSecondaryAction}
          />
        ))}

        <div className="mt-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-terminal-text-muted">
          <span>{message.role === 'assistant' ? 'copilot' : 'operator'}</span>
          <span>{message.status ? `${message.status} · ${message.timestamp}` : message.timestamp}</span>
        </div>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-suwappu-xxl border border-terminal-border bg-white/95 px-4 py-3 shadow-suwappu-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-terminal-text-muted animate-pulse" />
          <span className="h-2 w-2 rounded-full bg-terminal-text-muted animate-pulse [animation-delay:140ms]" />
          <span className="h-2 w-2 rounded-full bg-terminal-text-muted animate-pulse [animation-delay:280ms]" />
        </div>
      </div>
    </div>
  )
}

export function TerminalCopilotSurface({
  messages,
  suggestions,
  draft,
  onDraftChange,
  onSend,
  onSuggestionSelect,
  onPrimaryAction,
  onSecondaryAction,
  status = 'desk ready',
  statusTone = 'warm',
  modeLabel = 'execution',
  focusToken,
  focusChain,
  latencyLabel = '140ms',
  isTyping = false,
  placeholder = 'Ask the copilot to route, inspect risk, or stage a position',
}: {
  messages: TerminalCopilotMessage[]
  suggestions: TerminalCopilotSuggestion[]
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onSuggestionSelect: (value: string) => void
  onPrimaryAction?: (artifact: TerminalCopilotArtifact) => void
  onSecondaryAction?: (artifact: TerminalCopilotArtifact) => void
  status?: string
  statusTone?: Tone
  modeLabel?: string
  focusToken?: {
    symbol: string
    label?: string
    tone?: Tone
  }
  focusChain?: string
  latencyLabel?: string
  isTyping?: boolean
  placeholder?: string
}) {
  return (
    <TerminalInset className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TerminalStatusPill tone={statusTone}>{status}</TerminalStatusPill>
            <TerminalStatusPill tone="neutral">{modeLabel}</TerminalStatusPill>
            {focusChain ? <TerminalChainBadge chain={focusChain} /> : null}
            {focusToken ? (
              <TerminalTokenPill
                symbol={focusToken.symbol}
                label={focusToken.label}
                tone={focusToken.tone ?? 'neutral'}
              />
            ) : null}
          </div>
          <div className="mt-3 text-xl font-semibold tracking-[-0.04em] text-terminal-text">
            Terminal copilot surface
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-text-secondary">
            Rebuild the command surface in isolation, then port the proven message rhythm, artifact cards,
            and composer behavior back into the live terminal.
          </p>
        </div>

        <div className="flex items-center gap-2 text-terminal-text-muted">
          <TerminalKeyHint>cmd k</TerminalKeyHint>
          <TerminalKeyHint>{latencyLabel}</TerminalKeyHint>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {messages.map((message) => (
          <TerminalCopilotMessageBubble
            key={message.id}
            message={message}
            onPrimaryAction={onPrimaryAction}
            onSecondaryAction={onSecondaryAction}
          />
        ))}
        {isTyping ? <TypingIndicator /> : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <TerminalSelectPill
            key={suggestion.id}
            label={suggestion.label}
            detail={suggestion.detail}
            onClick={() => onSuggestionSelect(suggestion.label)}
          />
        ))}
      </div>

      <div className="mt-5 flex items-end gap-3">
        <div className="flex-1">
          <TerminalTextField
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={placeholder}
          />
        </div>
        <TerminalButton onClick={onSend} disabled={!draft.trim()}>
          Send
        </TerminalButton>
      </div>
    </TerminalInset>
  )
}

export function TerminalCopilotSidebar({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <TerminalInset>
      <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">{title}</div>
      <p className="mt-2 text-sm leading-6 text-terminal-text-secondary">{description}</p>
      <div className="mt-3 grid gap-2">{children}</div>
    </TerminalInset>
  )
}
