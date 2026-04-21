import type { ReactNode } from 'react'

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

type Tone = 'neutral' | 'warm' | 'sky'

const toneClasses: Record<Tone, string> = {
  neutral: 'border-terminal-border bg-terminal-bg-secondary text-terminal-text-secondary',
  warm: 'border-sakura-300 bg-sakura-50 text-sakura-700',
  sky: 'border-chain-solana/20 bg-chain-solana/5 text-chain-solana',
}

export function TerminalPage({ children }: { children: ReactNode }) {
  return (
    <div className="terminal-theme-page p-6 text-terminal-text">
      {children}
    </div>
  )
}

export function TerminalEyebrow({
  children,
  tone = 'warm',
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span
      className={joinClasses(
        'terminal-theme-pill terminal-theme-caption inline-flex border px-3 py-1 text-[10px] uppercase',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  )
}

export function TerminalPanel({
  children,
  elevated = false,
  className,
}: {
  children: ReactNode
  elevated?: boolean
  className?: string
}) {
  return (
    <section
      className={joinClasses(
        'terminal-theme-panel p-5',
        elevated ? 'terminal-theme-panel-elevated' : '',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function TerminalInset({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={joinClasses(
        'terminal-theme-inset p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function TerminalPanelHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow ? <div className="mb-3">{eyebrow}</div> : null}
        <h2 className="terminal-theme-heading text-2xl font-semibold text-terminal-text">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-terminal-text-secondary">{description}</p>
        ) : null}
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  )
}

export function TerminalMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  tone?: Tone
}) {
  return (
    <div className={joinClasses('terminal-theme-card px-3 py-3', toneClasses[tone])}>
      <div className="terminal-theme-caption text-[10px] uppercase">{label}</div>
      <div className="mt-1 text-base font-semibold text-terminal-text">{value}</div>
      {detail ? <div className="mt-1 text-xs text-terminal-text-secondary">{detail}</div> : null}
    </div>
  )
}

export function TerminalStatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span
      className={joinClasses(
        'terminal-theme-pill terminal-theme-caption inline-flex items-center border px-2.5 py-1 text-[10px] uppercase',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  )
}

export function TerminalDivider() {
  return <div className="h-px w-full bg-terminal-border" />
}

export function TerminalEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="terminal-theme-inset flex min-h-[180px] flex-col items-center justify-center border-dashed px-6 text-center">
      <div className="text-base font-semibold text-terminal-text">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-terminal-text-secondary">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
