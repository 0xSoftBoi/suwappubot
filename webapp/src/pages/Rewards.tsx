import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import { a11yToast } from '@/lib/a11yToast'
import type { RewardsEntryView, RewardsSummary } from '../lib/api'

// On-chain fee cashback (Rewards v1).
//
// Money movement rules (mirrors the backend state machine):
//  - "claimable" entries settle to the custodial balance FROM THE BOT (/rewards),
//    because custodial writes live on the Python side. This page surfaces them.
//  - "onchain" entries are claimed by the user's own wallet against the audited
//    SuwappuRewardsDistributor on Base — this page serves the exact claim() args
//    (Merkle proof included) so any wallet can submit the transaction.

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const statusConfig: Record<string, { label: string; chip: string }> = {
  claimable: { label: 'Claimable', chip: 'bg-green-500/15 text-green-500' },
  onchain: { label: 'Claim on-chain', chip: 'bg-blue-500/15 text-blue-400' },
  claimed_onchain: { label: 'Claimed on-chain', chip: 'bg-suwappu-text-secondary/15 text-suwappu-text-secondary' },
  credited: { label: 'Credited', chip: 'bg-suwappu-text-secondary/15 text-suwappu-text-secondary' },
  carryover: { label: 'Rolling over', chip: 'bg-yellow-500/15 text-yellow-500' },
  rolled: { label: 'Rolled over', chip: 'bg-suwappu-text-secondary/15 text-suwappu-text-secondary' },
}

function AccruingCard({ summary }: { summary: RewardsSummary }) {
  return (
    <div className="bg-linear-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white shadow-suwappu-2">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-white/70 text-xs">Accruing this epoch</p>
          <p className="text-3xl font-heading font-bold">{formatUsd(summary.accruingUsd)}</p>
        </div>
        <div className="text-4xl">💸</div>
      </div>
      <p className="text-xs text-white/80">
        You earn {Math.round(summary.cashbackRate * 100)}% of every swap fee back in{' '}
        {summary.payoutToken}. Epoch {summary.accruingEpochIndex} ends{' '}
        {formatDate(summary.accruingEndsAt)}.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatUsd(summary.claimableUsd)}</p>
          <p className="text-[10px] text-white/70">Claimable</p>
        </div>
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatUsd(summary.onchainUsd)}</p>
          <p className="text-[10px] text-white/70">On-chain</p>
        </div>
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatUsd(summary.lifetimeUsd)}</p>
          <p className="text-[10px] text-white/70">Lifetime</p>
        </div>
      </div>
    </div>
  )
}

function OnchainClaimRow({ entry }: { entry: RewardsEntryView }) {
  const [expanded, setExpanded] = useState(false)

  const { data: payload, isLoading } = useQuery({
    queryKey: ['rewards-claim', entry.epochIndex],
    queryFn: () => api.getRewardsClaimPayload(entry.epochIndex),
    enabled: expanded,
    staleTime: 30_000,
  })

  const copyClaimData = async () => {
    if (!payload) return
    const claimArgs = {
      contract: payload.distributor,
      chainId: payload.chainId,
      function: 'claim(uint256 epochId, uint256 index, address account, uint256 amount, bytes32[] merkleProof)',
      args: [payload.epochId, payload.index, payload.account, payload.amount, payload.merkleProof],
    }
    await navigator.clipboard.writeText(JSON.stringify(claimArgs, null, 2))
    a11yToast.success('Claim data copied')
  }

  return (
    <div className="bg-suwappu-surface rounded-suwappu-xl p-3">
      <button
        type="button"
        className="w-full flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-suwappu-text">
            Epoch {entry.epochIndex} — {formatUsd(entry.amountUsd)}
          </p>
          <p className="text-[11px] text-suwappu-text-secondary">
            Claim by {formatDate(entry.claimDeadline)} or it reverts to balance credit
          </p>
        </div>
        <span className="text-suwappu-text-secondary">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {isLoading && (
            <p className="text-xs text-suwappu-text-secondary animate-pulse">Loading proof…</p>
          )}
          {payload?.alreadyClaimed === true && (
            <p className="text-xs text-green-500">
              Already claimed on-chain — it will show as settled shortly.
            </p>
          )}
          {payload && payload.alreadyClaimed !== true && (
            <>
              <div className="text-[11px] text-suwappu-text-secondary break-all space-y-1">
                <p>To: {payload.distributor ?? 'distributor not announced yet'}</p>
                <p>Account: {payload.account}</p>
                <p>
                  Amount: {payload.amount} ({formatUsd(entry.amountUsd)} USDC)
                </p>
                <p>Proof: {payload.merkleProof.length} hashes</p>
              </div>
              <button
                type="button"
                onClick={copyClaimData}
                className="w-full py-2 rounded-lg bg-suwappu-magenta-mid text-white text-sm font-semibold"
              >
                📋 Copy claim data for your wallet
              </button>
              <p className="text-[10px] text-suwappu-text-secondary">
                Submit claim() on Base from the claim account above — any wallet that can
                send contract transactions works.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function Rewards() {
  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['rewards-summary'],
    queryFn: () => api.getRewardsSummary(),
    staleTime: 30_000,
  })

  const onchainEntries = summary?.entries.filter((e) => e.status === 'onchain') ?? []
  const history = summary?.entries.filter((e) => e.status !== 'onchain') ?? []

  return (
    <AppLayout header={<AppHeader title="Cashback" showBack />} activeNav="home">
      <div className="p-4 space-y-4 pb-24">
        {isLoading && (
          <div className="bg-suwappu-surface rounded-suwappu-xl p-6 animate-pulse text-center text-suwappu-text-secondary">
            Loading rewards…
          </div>
        )}
        {!!error && (
          <div className="bg-suwappu-surface rounded-suwappu-xl p-6 text-center text-suwappu-text-secondary">
            Couldn't load rewards. Pull to refresh or try again later.
          </div>
        )}

        {summary && (
          <>
            <AccruingCard summary={summary} />

            {summary.claimableUsd > 0 && (
              <div className="bg-suwappu-surface rounded-suwappu-xl p-4">
                <p className="text-sm font-semibold text-suwappu-text mb-1">
                  {formatUsd(summary.claimableUsd)} ready to claim
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  Open the bot and tap <span className="font-mono">/rewards</span> →{' '}
                  <b>Claim to balance</b> to credit it as {summary.payoutToken} instantly.
                </p>
              </div>
            )}

            {onchainEntries.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-heading font-semibold text-suwappu-text">
                  ⛓️ Claim on-chain
                </h2>
                {onchainEntries.map((entry) => (
                  <OnchainClaimRow key={entry.epochIndex} entry={entry} />
                ))}
              </div>
            )}

            {summary.carryoverUsd > 0 && (
              <p className="text-xs text-suwappu-text-secondary px-1">
                🔁 {formatUsd(summary.carryoverUsd)} below the $1 minimum is rolling into next
                epoch — nothing is lost.
              </p>
            )}

            {history.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-heading font-semibold text-suwappu-text">History</h2>
                {history.map((entry) => {
                  const cfg = statusConfig[entry.status] ?? {
                    label: entry.status,
                    chip: 'bg-suwappu-text-secondary/15 text-suwappu-text-secondary',
                  }
                  return (
                    <div
                      key={entry.epochIndex}
                      className="bg-suwappu-surface rounded-suwappu-xl p-3 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm text-suwappu-text">
                          Epoch {entry.epochIndex} — {formatUsd(entry.amountUsd)}
                        </p>
                        <p className="text-[11px] text-suwappu-text-secondary">
                          {formatUsd(entry.cashbackUsd)} cashback
                          {entry.carryoverUsd > 0 && ` + ${formatUsd(entry.carryoverUsd)} rolled in`}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-full ${cfg.chip}`}>
                        {cfg.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {summary.entries.length === 0 && summary.accruingUsd === 0 && (
              <div className="bg-suwappu-surface rounded-suwappu-xl p-6 text-center">
                <p className="text-3xl mb-2">💸</p>
                <p className="text-sm text-suwappu-text font-semibold">No cashback yet</p>
                <p className="text-xs text-suwappu-text-secondary mt-1">
                  Every swap earns {Math.round((summary.cashbackRate ?? 0.1) * 100)}% of its fee
                  back. Make a swap and watch this fill up.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
