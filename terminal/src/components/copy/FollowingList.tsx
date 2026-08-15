import { useState } from 'react'
import toast from 'react-hot-toast'
import { useFollowing, useUnfollowTrader, useUpdateFollowSettings } from '../../hooks/useCopyTrading'
import { CopySettingsModal } from './CopySettingsModal'
import type { FollowedTrader, FollowSettings } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { WalletConnect } from '../auth/WalletConnect'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '-'
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const MODE_LABELS: Record<string, string> = {
  notify: 'Notify',
  fixed: 'Fixed',
  percentage: '%',
}

export function FollowingList() {
  const { isAuthenticated, needsTradingProof, isExternalWallet } = useAuth()
  const { data: following, isLoading } = useFollowing()
  const { mutate: unfollow } = useUnfollowTrader()
  const { mutate: updateSettings } = useUpdateFollowSettings()
  const [settingsTrader, setSettingsTrader] = useState<FollowedTrader | null>(null)
  const autoCopyAvailable = isAuthenticated && !needsTradingProof && !isExternalWallet

  const handleSaveSettings = (settings: FollowSettings) => {
    if (!settingsTrader) return
    updateSettings(
      { traderId: settingsTrader.traderId, settings },
      {
        onSuccess: () => toast.success(settings.copyMode === 'notify' ? 'Follow settings saved' : 'Copy rules saved'),
        onError: error => toast.error(copyErrorMessage(error)),
      },
    )
    setSettingsTrader(null)
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 px-4 py-8 text-center">
        <div>
          <div className="text-sm font-semibold text-terminal-text">Sign in to see traders you follow</div>
          <p className="mt-1 text-xs text-terminal-text-muted">The trader leaderboard stays public.</p>
        </div>
        <WalletConnect showGoogle />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-terminal-text-muted text-sm">
        Loading followed traders...
      </div>
    )
  }

  if (!following?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-terminal-text-muted text-sm gap-2">
        <span>Not following anyone yet</span>
        <span className="text-xs">Browse the Top Traders tab to find traders to follow</span>
      </div>
    )
  }

  return (
    <>
      <div className="divide-y divide-terminal-border/50">
        {following.map((trader: FollowedTrader) => (
          <div
            key={trader.traderId}
            className="flex items-center gap-3 px-3 py-3 hover:bg-terminal-bg-tertiary/50 transition-colors"
          >
            {/* Avatar + Address */}
            <div className="w-7 h-7 rounded-full bg-terminal-bg-tertiary border border-terminal-border flex items-center justify-center text-[10px] font-mono tnum text-terminal-text-secondary shrink-0">
              {(trader.name || trader.address).slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono tnum text-terminal-text truncate">
                {trader.name || truncateAddress(trader.address)}
              </div>
              <div className="text-[10px] text-terminal-text-muted">
                Mode: <span className="text-terminal-text-secondary">{MODE_LABELS[trader.copyMode] || trader.copyMode}</span>
              </div>
            </div>

            {/* PnL */}
            <div className="text-right shrink-0">
              <div className={`text-xs font-mono tnum ${trader.dailyPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatPnl(trader.dailyPnl)}
                <span className="text-terminal-text-muted ml-1">today</span>
              </div>
              <div className={`text-[10px] font-mono tnum ${trader.totalPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatPnl(trader.totalPnl)}
                <span className="text-terminal-text-muted ml-1">total</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setSettingsTrader(trader)}
                className="w-7 h-7 rounded flex items-center justify-center text-terminal-text-muted hover:text-terminal-text hover:bg-terminal-bg-tertiary transition-colors"
                title="Settings"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={() => unfollow(trader.traderId)}
                className="w-7 h-7 rounded flex items-center justify-center text-terminal-text-muted hover:text-bear hover:bg-bear-dim transition-colors"
                title="Unfollow"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      <CopySettingsModal
        isOpen={!!settingsTrader}
        onClose={() => setSettingsTrader(null)}
        onSave={handleSaveSettings}
        initialSettings={settingsTrader?.settings}
        traderName={settingsTrader?.name || (settingsTrader ? truncateAddress(settingsTrader.address) : undefined)}
        autoCopyAvailable={autoCopyAvailable}
      />
    </>
  )
}

function copyErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    return String((error as { detail?: unknown }).detail || 'Copy settings request failed')
  }
  return error instanceof Error ? error.message : 'Copy settings request failed'
}
