import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import toast from '@/lib/a11yToast'
import type { SupportTicket, TicketKind, TicketStatus } from '../types/api'

const MAX_MESSAGE_LENGTH = 2000

const KIND_EMOJI: Record<TicketKind, string> = {
  support: '🆘',
  bug: '🐞',
}

const STATUS_META: Record<TicketStatus, { label: string; className: string }> = {
  open: {
    label: 'Open',
    className: 'bg-suwappu-magenta-mid/15 text-suwappu-magenta-mid',
  },
  in_progress: {
    label: 'In progress',
    className: 'bg-suwappu-warning/20 text-orange-700',
  },
  resolved: {
    label: 'Resolved',
    className: 'bg-suwappu-success/15 text-green-700',
  },
  closed: {
    label: 'Closed',
    className: 'bg-suwappu-sakura-mid/20 text-suwappu-text-secondary',
  },
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.open
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function Support() {
  const navigate = useNavigate()

  const [kind, setKind] = useState<TicketKind>('support')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTickets = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await api.getMySupportTickets()
      setTickets(data)
    } catch (err: any) {
      console.error('Failed to load support tickets:', err)
      setError(err.detail || err.message || 'Failed to load your tickets')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (!trimmed) return

    try {
      setIsSubmitting(true)
      await api.createSupportTicket({ kind, message: trimmed })
      toast.success(
        kind === 'bug'
          ? 'Thanks — your bug report was sent. We will take a look.'
          : 'Thanks — your support request was sent. We will get back to you.'
      )
      setMessage('')
      await loadTickets()
    } catch (err: any) {
      toast.error(err.detail || err.message || 'Could not send your message. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppLayout
      header={<AppHeader title="Help & Support" showBack onBack={() => navigate('/settings')} />}
      activeNav="settings"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Compose form */}
        <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 space-y-3">
          <p className="text-xs text-suwappu-text-secondary">
            Tell us what you need help with, or report a bug. Our team reads every message.
          </p>

          {/* Kind segmented control */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKind('support')}
              aria-pressed={kind === 'support'}
              className={`flex-1 py-2 rounded-suwappu-lg text-sm font-heading font-semibold transition-colors ${
                kind === 'support'
                  ? 'bg-suwappu-gradient text-white'
                  : 'bg-suwappu-sakura-light text-suwappu-text'
              }`}
            >
              🆘 Get help
            </button>
            <button
              type="button"
              onClick={() => setKind('bug')}
              aria-pressed={kind === 'bug'}
              className={`flex-1 py-2 rounded-suwappu-lg text-sm font-heading font-semibold transition-colors ${
                kind === 'bug'
                  ? 'bg-suwappu-gradient text-white'
                  : 'bg-suwappu-sakura-light text-suwappu-text'
              }`}
            >
              🐞 Report a bug
            </button>
          </div>

          <div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={5}
              placeholder={
                kind === 'bug'
                  ? 'What went wrong? Steps to reproduce help us fix it faster.'
                  : 'How can we help?'
              }
              aria-label={kind === 'bug' ? 'Describe the bug' : 'Describe what you need help with'}
              className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
            <div className="mt-1 text-right text-[10px] text-suwappu-text-secondary font-mono">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !message.trim()}
            className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg font-heading font-semibold disabled:opacity-50"
          >
            {isSubmitting ? 'Sending...' : kind === 'bug' ? 'Send Bug Report' : 'Send Request'}
          </button>
        </div>

        {/* Tickets list */}
        <div>
          <p className="text-xs text-suwappu-text-secondary mb-2 px-1">Your tickets</p>

          {isLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-suwappu-magenta-mid"></div>
            </div>
          ) : error ? (
            <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          ) : tickets.length === 0 ? (
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
              <div className="text-3xl mb-2">📭</div>
              <p className="text-sm text-suwappu-text-secondary">No tickets yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{KIND_EMOJI[ticket.kind] ?? '🆘'}</span>
                    <StatusBadge status={ticket.status} />
                    {ticket.category && (
                      <span className="text-[10px] text-suwappu-text-secondary">
                        {ticket.category}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-suwappu-text-secondary">
                      {formatDate(ticket.createdAt)}
                    </span>
                  </div>

                  <p className="text-sm text-suwappu-text line-clamp-2">{ticket.message}</p>

                  {ticket.adminReply && (
                    <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-2.5">
                      <p className="text-[10px] font-heading font-semibold text-suwappu-magenta-mid mb-0.5">
                        Suwappu team
                      </p>
                      <p className="text-xs text-suwappu-text-secondary">{ticket.adminReply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
