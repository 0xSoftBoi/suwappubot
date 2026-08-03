import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  usePendingApprovals,
  useApprovalDecision,
  useApprovalTokenMetadata,
} from '../../hooks/useAgentControlPlane'
import type { PendingApproval } from '../../lib/approvalsApi'
import type { SwapToken } from '../../types/api'
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

function shortAddr(addr: string): string {
  if (!addr) return '—'
  // Solana native SOL / EVM native "0x000...0" sentinels read fine as-is;
  // only truncate genuinely long addresses.
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/** Human-scaled amount for a token whose decimals/symbol we resolved via
 * useApprovalTokenMetadata (same token search the swap UI uses). Falls back
 * to a raw-and-labelled display — never a guessed decimals count — when the
 * token can't be resolved, so the human reviewing the approval always knows
 * whether the number in front of them is real or a placeholder. */
function formatTokenAmount(
  raw: string,
  meta: SwapToken | null | undefined,
  metaLoading: boolean,
  fallbackAddr: string,
): string {
  if (!raw) return '—'
  if (meta) {
    try {
      const scaled = formatUnits(BigInt(raw), meta.decimals)
      const num = Number(scaled)
      const display = Number.isFinite(num)
        ? num.toLocaleString(undefined, { maximumFractionDigits: 6 })
        : scaled
      return `${display} ${meta.symbol}`
    } catch {
      // raw wasn't a valid integer string — fall through to raw display
    }
  }
  if (metaLoading) return `${raw} ${shortAddr(fallbackAddr)} (resolving…)`
  return `${raw} (raw, unknown decimals) ${shortAddr(fallbackAddr)}`
}

function chainLabel(chain: string): string {
  if (chain === 'solana') return 'Solana'
  const n = Number(chain)
  return Number.isFinite(n) ? `Chain ${n}` : chain
}

function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!expiresAt) return { label: '—', totalSec: null as number | null, expired: false }
  const diffMs = new Date(expiresAt).getTime() - now
  if (diffMs <= 0) return { label: 'Expired', totalSec: 0, expired: true }

  const totalSec = Math.floor(diffMs / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return { label: `${min}:${sec.toString().padStart(2, '0')}`, totalSec, expired: false }
}

const APPROVE_CONFIRM_TIMEOUT_MS = 5000
const URGENT_THRESHOLD_SEC = 60

function ApprovalRow({ approval }: { approval: PendingApproval }) {
  const { mutate, isPending } = useApprovalDecision()
  const { label: countdown, totalSec, expired } = useCountdown(approval.expiresAt)
  const [confirmingApprove, setConfirmingApprove] = useState(false)

  useEffect(() => {
    if (!confirmingApprove) return
    const id = setTimeout(() => setConfirmingApprove(false), APPROVE_CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [confirmingApprove])

  // Never leave a stale "Confirm approve?" state armed once the request
  // expires out from under the user.
  useEffect(() => {
    if (expired) setConfirmingApprove(false)
  }, [expired])

  const decide = (decision: 'approve' | 'deny') => {
    setConfirmingApprove(false)
    mutate(
      { id: approval.id, decision },
      {
        onError: (err: any) => {
          toast.error(err?.message || `Could not ${decision} the request. Try again.`)
        },
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Approved' : 'Denied')
        },
      },
    )
  }

  const { payload } = approval
  const fromMeta = useApprovalTokenMetadata(payload.fromChain, payload.fromToken)
  const toMeta = useApprovalTokenMetadata(payload.toChain, payload.toToken)
  const fromAmountLabel = formatTokenAmount(
    payload.amountIn,
    fromMeta.data,
    fromMeta.isLoading,
    payload.fromToken,
  )
  const toTokenLabel = toMeta.data ? toMeta.data.symbol : shortAddr(payload.toToken)
  const amountLine = `${fromAmountLabel} → ${toTokenLabel}`
  const urgent = !expired && totalSec !== null && totalSec <= URGENT_THRESHOLD_SEC

  const handleApproveClick = () => {
    if (!confirmingApprove) {
      setConfirmingApprove(true)
      return
    }
    decide('approve')
  }

  return (
    <div className="flex flex-col gap-2 border-b border-terminal-border/50 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-terminal-text">{approval.agentId}</span>
            <TerminalStatusPill tone="neutral">{chainLabel(payload.fromChain)}</TerminalStatusPill>
            {approval.reason && (
              <span className="truncate text-[11px] text-terminal-text-muted" title={approval.reason}>
                {approval.reason}
              </span>
            )}
          </div>
          <div className="font-mono text-sm text-terminal-text">{amountLine}</div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-sm text-terminal-text">{formatUsd(payload.valueUsd)}</div>
            <div
              className={`text-[11px] font-mono ${
                expired
                  ? 'text-bear'
                  : urgent
                    ? 'animate-pulse font-semibold text-bear'
                    : 'text-terminal-text-muted'
              }`}
            >
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
              className={`text-xs ${
                confirmingApprove ? 'terminal-button !border-bear !bg-bear/20 !text-bear' : 'terminal-button'
              }`}
              disabled={isPending || expired}
              onClick={handleApproveClick}
            >
              {isPending ? 'Approving…' : confirmingApprove ? 'Confirm approve?' : 'Approve'}
            </button>
          </div>
        </div>
      </div>

      {confirmingApprove && !expired && (
        <div className="flex items-center justify-between gap-4 rounded border border-terminal-border/70 bg-terminal-bg-secondary/50 px-3 py-2">
          <div className="text-xs text-terminal-text-secondary">
            Confirm: approve <span className="font-mono text-terminal-text">{amountLine}</span>{' '}
            for <span className="font-mono text-terminal-text">{formatUsd(payload.valueUsd)}</span> on{' '}
            <span className="font-mono text-terminal-text">{chainLabel(payload.fromChain)}</span>?
          </div>
          <button
            className="terminal-button-secondary shrink-0 text-[11px]"
            onClick={() => setConfirmingApprove(false)}
          >
            Cancel
          </button>
        </div>
      )}
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
                description="Approval requests from your agents will show up here as they come in. You can approve or deny them right here, or via the Telegram bot."
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
