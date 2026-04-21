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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(244,201,99,0.18),transparent_28%),radial-gradient(circle_at_left_center,rgba(248,228,190,0.4),transparent_22%),linear-gradient(180deg,#fffefb_0%,#fff9f0_100%)] p-6 text-terminal-text">
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
        'inline-flex rounded-suwappu-pill border px-3 py-1 text-[10px] uppercase tracking-[0.32em]',
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
        'rounded-suwappu-xxxl border border-terminal-border bg-terminal-panel p-5',
        elevated ? 'shadow-suwappu-4' : 'shadow-suwappu-3',
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
        'rounded-suwappu-xxl border border-terminal-border bg-terminal-bg-secondary p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
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
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-terminal-text">{title}</h2>
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
    <div className={joinClasses('rounded-suwappu-xl border px-3 py-3', toneClasses[tone])}>
      <div className="text-[10px] uppercase tracking-[0.22em]">{label}</div>
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
        'inline-flex items-center rounded-suwappu-pill border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
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
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-suwappu-xxl border border-dashed border-terminal-border bg-terminal-bg-secondary px-6 text-center">
      <div className="text-base font-semibold text-terminal-text">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-terminal-text-secondary">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
