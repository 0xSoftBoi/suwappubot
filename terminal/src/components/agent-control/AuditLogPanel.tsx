import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAuditLog, useAuditVerify } from '../../hooks/useAgentControlPlane'
import {
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
  TerminalEmptyState,
  TerminalEyebrow,
} from '../foundation/TerminalPrimitives'

const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All events' },
  { value: 'policy.allow', label: 'Policy allow' },
  { value: 'policy.block', label: 'Policy block' },
  { value: 'policy.require_approval', label: 'Policy require approval' },
  { value: 'approval.created', label: 'Approval created' },
  { value: 'approval.approved', label: 'Approval approved' },
  { value: 'approval.denied', label: 'Approval denied' },
  { value: 'approval.step_up_issued', label: 'Step-up issued' },
  { value: 'approval.validation_failed', label: 'Approval validation failed' },
]

const TIME_RANGE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

function sinceFromRange(range: string): string | undefined {
  if (!range) return undefined
  const now = Date.now()
  const ms =
    range === '1h' ? 60 * 60 * 1000
    : range === '24h' ? 24 * 60 * 60 * 1000
    : range === '7d' ? 7 * 24 * 60 * 60 * 1000
    : range === '30d' ? 30 * 24 * 60 * 60 * 1000
    : 0
  if (!ms) return undefined
  return new Date(now - ms).toISOString()
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function VerifyBadge() {
  const { data, isLoading, isError } = useAuditVerify(1000)

  if (isLoading) {
    return <TerminalStatusPill tone="neutral">Verifying chain...</TerminalStatusPill>
  }
  if (isError || !data) {
    // Neutral state — this endpoint requires an agent/org API key, which the
    // terminal's session does not hold (see AuditLogPanel's banner below).
    // Never render this as "valid".
    return <TerminalStatusPill tone="neutral">Verification unavailable</TerminalStatusPill>
  }
  if (data.note) {
    return <TerminalStatusPill tone="neutral">Not applicable — {data.note}</TerminalStatusPill>
  }
  if (data.valid) {
    return (
      <TerminalStatusPill tone="up">
        Hash chain valid · {data.checked} entries checked
      </TerminalStatusPill>
    )
  }
  return (
    <TerminalStatusPill tone="down">
      Hash chain BROKEN{data.firstBreakId ? ` at entry ${data.firstBreakId}` : ''}
    </TerminalStatusPill>
  )
}

export function AuditLogPanel() {
  const { isAuthenticated } = useAuth()
  const [eventType, setEventType] = useState('')
  const [timeRange, setTimeRange] = useState('')
  const [limit] = useState(100)

  const params = useMemo(
    () => ({
      eventType: eventType || undefined,
      since: sinceFromRange(timeRange),
      limit,
    }),
    [eventType, timeRange, limit],
  )

  const { data, isLoading, isError } = useAuditLog(params)
  const events = data?.events ?? []

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        Sign in to view the audit log
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-terminal-bg">
      <TerminalPanelHeader
        eyebrow={<TerminalEyebrow tone="accent">Agent Control Plane</TerminalEyebrow>}
        title="Audit Log"
        description="Policy, approval, and killswitch events for your agents — tamper-evident via a hash chain."
        meta={<VerifyBadge />}
      />

      <div className="border-b border-terminal-border bg-terminal-bg-secondary/40 px-4 py-2 text-[11px] text-terminal-text-muted">
        GET /v1/agent/audit currently requires an agent or organization API key — your terminal
        session cannot authenticate to it yet, so this list may show as unavailable below. Contact
        support if you need audit visibility from here rather than the bot/API directly.
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-terminal-border px-4 py-2 shrink-0">
        <label className="flex items-center gap-2 text-xs text-terminal-text-muted">
          Event type
          <select
            className="rounded border border-terminal-border bg-terminal-bg-secondary px-2 py-1 text-xs text-terminal-text focus:border-terminal-border-active focus:outline-none"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-terminal-text-muted">
          Time range
          <select
            className="rounded border border-terminal-border bg-terminal-bg-secondary px-2 py-1 text-xs text-terminal-text focus:border-terminal-border-active focus:outline-none"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-terminal-text-muted">
            Loading audit log...
          </div>
        ) : isError ? (
          <div className="p-4">
            <TerminalPanel>
              <TerminalEmptyState
                title="Could not load audit log"
                description="Your session isn't authorized for this endpoint (it currently requires an agent/org API key), or the server hit an error. See the banner above."
              />
            </TerminalPanel>
          </div>
        ) : events.length === 0 ? (
          <div className="p-4">
            <TerminalPanel>
              <TerminalEmptyState
                title="No audit events"
                description="No policy, approval, or killswitch events match these filters."
              />
            </TerminalPanel>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-terminal-border text-xs uppercase tracking-wider text-terminal-text-muted">
                <th className="px-3 py-2 text-left">Event</th>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="px-3 py-2 text-left">Details</th>
                <th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, idx) => (
                <tr
                  key={`${ev.entryHash}-${idx}`}
                  className="border-b border-terminal-border/50 transition-colors hover:bg-terminal-bg-tertiary/50"
                >
                  <td className="px-3 py-2.5">
                    <TerminalStatusPill tone="neutral">{ev.eventType}</TerminalStatusPill>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-terminal-text-secondary">
                    {ev.agentId ?? '—'}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2.5 font-mono text-xs text-terminal-text-secondary">
                    {ev.details ? JSON.stringify(ev.details) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-terminal-text-muted">
                    {formatTimestamp(ev.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {events.length >= limit && (
        <div className="border-t border-terminal-border px-4 py-2 text-center text-xs text-terminal-text-muted">
          Showing latest {limit} events. Narrow filters or refine time range to see more history.
        </div>
      )}
    </div>
  )
}
