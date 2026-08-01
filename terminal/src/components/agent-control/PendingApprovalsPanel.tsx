import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { usePendingApprovals, useApprovalDecision } from '../../hooks/useAgentControlPlane'
import type { PendingApproval } from '../../lib/approvalsApi'
import {
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
  TerminalEmptyState,
  TerminalEyebrow,
} from '../foundation/TerminalPrimitives'

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!expiresAt) return { label: '—', expired: false }
  const diffMs = new Date(expiresAt).getTime() - now
  if (diffMs <= 0) return { label: 'Expired', expired: true }

  const totalSec = Math.floor(diffMs / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return { label: `${min}:${sec.toString().padStart(2, '0')}`, expired: false }
}

function ApprovalRow({ approval }: { approval: PendingApproval }) {
  const { mutate, isPending } = useApprovalDecision()
  const { label: countdown, expired } = useCountdown(approval.expiresAt)

  const decide = (decision: 'approve' | 'deny') => {
    mutate(
      { id: approval.id, decision },
      {
        onError: (err: any) => {
          toast.error(err?.detail || `Could not ${decision} the request. Try again.`)
        },
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Approved' : 'Denied')
        },
      },
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-terminal-border/50 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-terminal-text">
            {approval.agentName || approval.agentId}
          </span>
          <TerminalStatusPill tone="neutral">{approval.chain}</TerminalStatusPill>
        </div>
        <div className="text-xs text-terminal-text-secondary">
          {approval.fromToken && approval.toToken
            ? `${approval.fromToken} → ${approval.toToken}`
            : 'Swap request'}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-sm text-terminal-text">{formatUsd(approval.valueUsd)}</div>
          <div className={`text-[11px] font-mono ${expired ? 'text-bear' : 'text-terminal-text-muted'}`}>
            {expired ? countdown : `expires in ${countdown}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="terminal-button-secondary text-xs"
            disabled={isPending || expired}
            onClick={() => decide('deny')}
          >
            Deny
          </button>
          <button
            className="terminal-button text-xs"
            disabled={isPending || expired}
            onClick={() => decide('approve')}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

export function PendingApprovalsPanel() {
  const { isAuthenticated } = useAuth()
  const { data, isLoading } = usePendingApprovals()

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        Sign in to view agent approvals
      </div>
    )
  }

  const items = data ?? []

  return (
    <div className="flex h-full flex-col bg-terminal-bg">
      <TerminalPanelHeader
        eyebrow={<TerminalEyebrow tone="accent">Agent Control Plane</TerminalEyebrow>}
        title="Pending Approvals"
        description="Agent-initiated actions waiting on your decision, ranked by soonest expiry."
      />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-terminal-text-muted">
            Loading pending approvals...
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <TerminalPanel>
              <TerminalEmptyState
                title="No pending approvals"
                description="Approval requests from your agents will show up here as they come in. Today, decisions are made via the Telegram bot — web approve/deny is not wired up yet."
              />
            </TerminalPanel>
          </div>
        ) : (
          items.map((approval) => <ApprovalRow key={approval.id} approval={approval} />)
        )}
      </div>
    </div>
  )
}
