import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useRewardsSummary, useRewardsClaimPayload } from '../../hooks/useRewards'
import type { RewardsEntry } from '../../types/api'
import {
  TerminalPanel,
  TerminalPanelHeader,
  TerminalMetricCard,
  TerminalStatusPill,
  TerminalEmptyState,
  TerminalEyebrow,
} from '../foundation/TerminalPrimitives'

type Tab = 'overview' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
]

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function formatCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms) || ms <= 0) return 'ending now'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'neutral' | 'warm' | 'accent' }> = {
    claimable: { label: 'Claimable', tone: 'warm' },
    onchain: { label: 'Claim on-chain', tone: 'accent' },
    credited: { label: 'Credited', tone: 'neutral' },
    claimed_onchain: { label: 'Claimed on-chain', tone: 'neutral' },
    carryover: { label: 'Carries over', tone: 'neutral' },
    rolled: { label: 'Rolled forward', tone: 'neutral' },
  }
  const { label, tone } = map[status] ?? { label: status, tone: 'neutral' as const }
  return <TerminalStatusPill tone={tone}>{label}</TerminalStatusPill>
}

// Wallet-claim args for one published epoch — copyable claim() payload with the
// stored Merkle proof. The tx itself is submitted from the user's own wallet.
function OnchainClaimCard({ entry }: { entry: RewardsEntry }) {
  const { data: payload, isLoading, isError } = useRewardsClaimPayload(entry.epochIndex)

  if (isLoading) {
    return (
      <div className="text-terminal-text-muted text-xs px-3 py-2">
        Loading claim data for epoch {entry.epochIndex}...
      </div>
    )
  }
  if (isError || !payload) return null

  const copyArgs = () => {
    const args = JSON.stringify(
      {
        function: 'claim(uint256,uint256,address,uint256,bytes32[])',
        distributor: payload.distributor,
        chainId: payload.chainId,
        epochId: payload.epochId,
        index: payload.index,
        account: payload.account,
        amount: payload.amount,
        merkleProof: payload.merkleProof,
      },
      null,
      2,
    )
    navigator.clipboard.writeText(args).then(() => toast('claim() args copied'))
  }

  return (
    <TerminalPanel>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-terminal-text-muted tracking-wider mb-1">
            Epoch {entry.epochIndex} · {formatUsd(entry.amountUsd)} USDC
            {payload.alreadyClaimed ? ' · already claimed' : ''}
          </div>
          <div className="font-mono text-xs text-terminal-text-secondary truncate">
            to {payload.account}
          </div>
          {payload.claimDeadline && (
            <div className="text-[11px] text-terminal-text-muted mt-0.5">
              Claim by {formatDate(payload.claimDeadline)} — after that it reverts to a balance credit
            </div>
          )}
        </div>
        <button
          className="terminal-button-secondary text-xs shrink-0"
          onClick={copyArgs}
          disabled={payload.alreadyClaimed === true}
        >
          Copy claim() args
        </button>
      </div>
    </TerminalPanel>
  )
}

function OverviewTab() {
  const { data: summary, isLoading } = useRewardsSummary()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm">
        Loading rewards...
      </div>
    )
  }

  if (!summary) {
    return (
      <TerminalEmptyState
        title="No rewards data"
        description="We could not load your cashback rewards. Try again in a moment."
      />
    )
  }

  const ratePct = Math.round(summary.cashbackRate * 100)
  const onchainEntries = summary.entries.filter(e => e.status === 'onchain' && e.hasOnchainLeaf)

  return (
    <div className="flex flex-col gap-5 p-4">
      <TerminalPanelHeader
        eyebrow={<TerminalEyebrow>Cashback</TerminalEyebrow>}
        title={`Earn ${ratePct}% of your trading fees back — every week`}
        description={`Cashback accrues per weekly epoch and settles in ${summary.payoutToken} on ${summary.payoutChain === 'base' ? 'Base' : summary.payoutChain}. Claim to your balance in the bot, or on-chain from your own wallet.`}
        meta={<TerminalStatusPill tone="warm">{ratePct}% back</TerminalStatusPill>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TerminalMetricCard
          label="Accruing This Epoch"
          value={formatUsd(summary.accruingUsd)}
          detail={`Epoch ${summary.accruingEpochIndex} · ${formatCountdown(summary.accruingEndsAt)}`}
          tone="warm"
        />
        <TerminalMetricCard
          label="Claimable Now"
          value={formatUsd(summary.claimableUsd)}
          detail={summary.claimableUsd > 0 ? 'Claim in the bot with /rewards' : undefined}
        />
        <TerminalMetricCard
          label="On-Chain Claims"
          value={formatUsd(summary.onchainUsd)}
          detail={onchainEntries.length > 0 ? `${onchainEntries.length} published epoch${onchainEntries.length > 1 ? 's' : ''}` : undefined}
          tone="accent"
        />
        <TerminalMetricCard
          label="Lifetime Earned"
          value={formatUsd(summary.lifetimeUsd)}
          detail={summary.carryoverUsd > 0 ? `+${formatUsd(summary.carryoverUsd)} carrying over` : undefined}
        />
      </div>

      {onchainEntries.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase text-terminal-text-muted tracking-wider">
            Claim from your wallet
          </div>
          {onchainEntries.map(entry => (
            <OnchainClaimCard key={entry.epochIndex} entry={entry} />
          ))}
        </div>
      )}

      <div className="text-[12px] text-terminal-text-muted text-center border border-terminal-border/50 rounded px-3 py-2">
        Claim your balance in the Telegram bot with <span className="font-mono text-sakura-400">/rewards</span> — amounts under $1 roll into the next epoch automatically
      </div>
    </div>
  )
}

function HistoryTab() {
  const { data: summary, isLoading } = useRewardsSummary()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm">
        Loading history...
      </div>
    )
  }

  const items = summary?.entries ?? []

  if (items.length === 0) {
    return (
      <div className="p-4">
        <TerminalEmptyState
          title="No epochs yet"
          description="Your weekly cashback epochs will appear here after your first week of trading."
        />
      </div>
    )
  }

  return (
    <div className="p-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-terminal-text-muted text-xs uppercase tracking-wider border-b border-terminal-border">
            <th className="text-left py-2 px-3">Epoch</th>
            <th className="text-right py-2 px-3">Amount</th>
            <th className="text-left py-2 px-3">Status</th>
            <th className="text-left py-2 px-3">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {items.map(entry => (
            <tr
              key={entry.epochIndex}
              className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
            >
              <td className="py-2.5 px-3 font-mono text-terminal-text">#{entry.epochIndex}</td>
              <td className="py-2.5 px-3 font-mono text-right text-sakura-400">
                {formatUsd(entry.amountUsd)}
              </td>
              <td className="py-2.5 px-3">
                <StatusPill status={entry.status} />
              </td>
              <td className="py-2.5 px-3 text-terminal-text-secondary text-xs">
                {formatDate(entry.claimDeadline)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RewardsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        Sign in to view your cashback rewards
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-terminal-bg">
      <div className="flex items-center border-b border-terminal-border px-2 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </div>
  )
}
