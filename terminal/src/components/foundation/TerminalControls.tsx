import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md'

const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: 'terminal-button text-white',
  secondary: 'terminal-button-secondary',
  ghost:
    'rounded-suwappu-xl border border-transparent bg-transparent text-terminal-text-secondary transition-colors hover:border-terminal-border hover:bg-terminal-bg-secondary hover:text-terminal-text active:scale-[0.98]',
}

export function TerminalButton({
  children,
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      className={joinClasses(buttonVariantClasses[variant], buttonSizeClasses[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function TerminalIconButton({
  className,
  label,
  children,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={joinClasses(
        'inline-flex h-9 w-9 items-center justify-center rounded-suwappu-xl border text-terminal-text-secondary transition-colors active:scale-[0.98]',
        active
          ? 'border-terminal-border-active bg-terminal-bg-tertiary text-terminal-text shadow-suwappu-2'
          : 'border-terminal-border bg-white/80 hover:bg-terminal-bg-secondary hover:text-terminal-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function TerminalKeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-suwappu-md border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[10px] text-terminal-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      {children}
    </kbd>
  )
}

export function TerminalTextField({
  className,
  label,
  prefix,
  suffix,
  mono = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  prefix?: ReactNode
  suffix?: ReactNode
  mono?: boolean
}) {
  return (
    <label className="grid gap-1.5">
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
          {label}
        </span>
      ) : null}
      <div className="flex items-center gap-2 rounded-suwappu-xxl border border-terminal-border bg-white px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] focus-within:border-terminal-border-active">
        {prefix ? <span className="shrink-0 text-terminal-text-muted">{prefix}</span> : null}
        <input
          className={joinClasses(
            'min-w-0 flex-1 bg-transparent text-terminal-text placeholder-terminal-text-muted outline-none',
            mono ? 'font-mono text-sm' : 'text-sm',
            className,
          )}
          {...props}
        />
        {suffix ? <span className="shrink-0">{suffix}</span> : null}
      </div>
    </label>
  )
}

type TerminalTabOption = {
  id: string
  label: string
  meta?: string
}

export function TerminalSegmentedTabs({
  activeId,
  options,
  onChange,
}: {
  activeId: string
  options: TerminalTabOption[]
  onChange: (id: string) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-suwappu-xxl border border-terminal-border bg-terminal-bg-secondary p-1">
      {options.map((option) => {
        const active = option.id === activeId

        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={joinClasses(
              'rounded-suwappu-xl px-3 py-2 text-left transition-colors',
              active
                ? 'bg-white text-terminal-text shadow-suwappu-2'
                : 'text-terminal-text-secondary hover:bg-white/70 hover:text-terminal-text',
            )}
          >
            <div className="text-sm font-medium">{option.label}</div>
            {option.meta ? <div className="text-[10px] uppercase tracking-[0.16em] opacity-70">{option.meta}</div> : null}
          </button>
        )
      })}
    </div>
  )
}

export function TerminalSelectPill({
  label,
  detail,
  active = false,
  onClick,
  leading,
}: {
  label: string
  detail?: string
  active?: boolean
  onClick?: () => void
  leading?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={joinClasses(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors active:scale-[0.98]',
        active
          ? 'border-terminal-border-active bg-white text-terminal-text shadow-suwappu-2'
          : 'border-terminal-border bg-terminal-bg-secondary text-terminal-text-secondary hover:bg-white hover:text-terminal-text',
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {detail ? (
          <span className="block text-[10px] uppercase tracking-[0.18em] opacity-70">{detail}</span>
        ) : null}
      </span>
    </button>
  )
}

export function TerminalTokenPill({
  symbol,
  label,
  tone = 'neutral',
}: {
  symbol: string
  label?: string
  tone?: 'neutral' | 'warm' | 'sky'
}) {
  const toneClasses =
    tone === 'warm'
      ? 'border-sakura-300 bg-sakura-50'
      : tone === 'sky'
        ? 'border-chain-solana/20 bg-chain-solana/5'
        : 'border-terminal-border bg-terminal-bg-secondary'

  return (
    <span className={joinClasses('inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5', toneClasses)}>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-white font-mono text-[10px] font-semibold text-terminal-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {symbol.slice(0, 2)}
      </span>
      <span>
        <span className="block text-xs font-semibold text-terminal-text">{symbol}</span>
        {label ? <span className="block text-[10px] text-terminal-text-muted">{label}</span> : null}
      </span>
    </span>
  )
}
