import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../layout'
import { bankErrorText, isNotAvailable } from '../../lib/bankApi'

export function BankPage({ title, back = '/bank', children }: { title: string; back?: string | -1; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <AppLayout header={<AppHeader title={title} showBack onBack={() => (back === -1 ? navigate(-1) : navigate(back))} />} activeNav="wallet">
      <div className="p-3 pb-24 space-y-3 max-w-xl mx-auto w-full">{children}</div>
    </AppLayout>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 border border-suwappu-sakura-mid/20 min-w-0 ${className}`}>{children}</div>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pt-1">
      <h2 className="font-heading font-bold text-sm text-suwappu-purple-deep">{children}</h2>
      {right}
    </div>
  )
}

export function Row({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-suwappu-text-secondary shrink-0">{label}</span>
      <span className={`text-right text-suwappu-text min-w-0 break-words ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

const TONE: Record<string, string> = {
  good: 'bg-green-500/15 text-green-600',
  warn: 'bg-yellow-500/15 text-yellow-600',
  bad: 'bg-red-500/15 text-red-500',
  neutral: 'bg-suwappu-text-secondary/15 text-suwappu-text-secondary',
}
const STATUS_TONE: Record<string, string> = {
  confirmed: 'good', completed: 'good', paid: 'good', active: 'good', released: 'good', in_sync: 'good', approved: 'good', ok: 'good', claimed: 'good', funded: 'good', open: 'neutral',
  failed: 'bad', rejected: 'bad', drift: 'bad', critical: 'bad', reversed: 'bad', canceled: 'bad', cancelled: 'bad', void: 'bad', frozen: 'warn', disputed: 'warn',
  pending: 'warn', submitted: 'warn', processing: 'warn', pending_settlement: 'warn', warn: 'warn', draft: 'neutral', executing: 'warn', partial: 'warn', overdue: 'bad',
}
export function Chip({ status, tone }: { status: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const t = tone ?? STATUS_TONE[status] ?? 'neutral'
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${TONE[t]}`}>{status.replace(/_/g, ' ')}</span>
}

export function Btn({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = variant === 'primary' ? 'bg-suwappu-magenta-mid text-white' : variant === 'danger' ? 'bg-red-500/10 text-red-500' : 'bg-suwappu-sakura-light text-suwappu-purple-deep'
  return <button type="button" {...p} className={`min-h-[44px] px-4 rounded-suwappu-lg text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-suwappu-text-secondary mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-suwappu-text-secondary mt-1">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full min-h-[44px] px-3 rounded-suwappu-lg border border-suwappu-sakura-mid/40 bg-white text-sm text-suwappu-text outline-none focus:border-suwappu-magenta-mid'
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />
}
export function Select({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${inputCls} ${p.className ?? ''}`}>{children}</select>
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-suwappu-xl bg-suwappu-sakura-light/60 animate-pulse" />
      ))}
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="text-sm font-semibold text-suwappu-text">{title}</p>
      {hint && <p className="text-xs text-suwappu-text-secondary mt-1">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const na = isNotAvailable(error)
  return (
    <div role="alert" className={`rounded-suwappu-xl p-3 text-sm border break-words ${na ? 'bg-yellow-500/10 border-yellow-500/30 text-suwappu-text' : 'bg-red-500/10 border-red-500/30 text-red-600'}`}>
      <p>{bankErrorText(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 min-h-[36px] text-xs font-semibold underline">
          Try again
        </button>
      )}
    </div>
  )
}

/** Renders loading / error / empty / data for any react-query result. */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  rows,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }
  isEmpty?: (d: T) => boolean
  empty?: ReactNode
  rows?: number
  children: (d: T) => ReactNode
}) {
  if (query.isLoading) return <Loading rows={rows} />
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => void query.refetch()} />
  if (query.data === undefined) return null
  if (isEmpty?.(query.data)) return <>{empty}</>
  return <>{children(query.data)}</>
}

export function QuickLink({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-suwappu-lg bg-suwappu-sakura-light/70 text-suwappu-purple-deep">
      <span aria-hidden className="text-lg leading-none">{icon}</span>
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`min-h-[40px] px-3 rounded-full text-xs font-semibold whitespace-nowrap ${value === t.id ? 'bg-suwappu-magenta-mid text-white' : 'bg-suwappu-sakura-light/70 text-suwappu-purple-deep'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Bottom sheet. Locks Esc-to-close and focus-trap basics; no layout shift (fixed overlay). */
export function Sheet({ title, onClose, children, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; dismissible?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissible && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissible])
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={() => dismissible && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-white rounded-t-suwappu-xl p-4 pb-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-heading font-bold text-base text-suwappu-purple-deep">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} disabled={!dismissible} className="min-w-[44px] min-h-[44px] -mr-2 text-suwappu-text-secondary disabled:opacity-40">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
