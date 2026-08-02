import { useState } from 'react'
import type { IntelFlag } from '../../types/api'
import { FLAG_META, flagSeverity, type FlagSeverity } from '../../lib/intelFormat'
import { TerminalStatusPill } from '../foundation'

interface FlagStripProps {
  flags: IntelFlag[]
}

// Map our danger/warn/ok severity onto the shared pill tone palette.
const severityTone: Record<FlagSeverity, 'down' | 'warm' | 'neutral'> = {
  danger: 'down',
  warn: 'warm',
  ok: 'neutral',
}

function FlagPill({ flag }: { flag: IntelFlag }) {
  const meta = FLAG_META[flag]
  const [showDetail, setShowDetail] = useState(false)
  const severity = flagSeverity(flag)

  if (!meta) return null

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        onMouseEnter={() => setShowDetail(true)}
        onMouseLeave={() => setShowDetail(false)}
        onFocus={() => setShowDetail(true)}
        onBlur={() => setShowDetail(false)}
        title={meta.description}
        aria-describedby={`flag-desc-${flag}`}
        className="cursor-help"
      >
        <TerminalStatusPill tone={severityTone[severity]}>{meta.label}</TerminalStatusPill>
      </button>
      {showDetail && (
        <div
          id={`flag-desc-${flag}`}
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-56 rounded-[var(--terminal-radius-card)] border border-terminal-border bg-terminal-bg-secondary p-2 text-[10px] leading-4 text-terminal-text-secondary shadow-lg"
        >
          {meta.description}
        </div>
      )}
    </div>
  )
}

export function FlagStrip({ flags }: FlagStripProps) {
  if (!flags || flags.length === 0) {
    return (
      <div className="text-[10px] text-terminal-text-muted" data-testid="flag-strip-empty">
        No risk flags detected.
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="flag-strip">
      {flags.map((flag) => (
        <FlagPill key={flag} flag={flag} />
      ))}
    </div>
  )
}
