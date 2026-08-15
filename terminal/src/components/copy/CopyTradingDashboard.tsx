import { useState } from 'react'
import toast from 'react-hot-toast'
import { TraderLeaderboard } from './TraderLeaderboard'
import { TraderCard } from './TraderCard'
import { FollowingList } from './FollowingList'
import { CopyFeed } from './CopyFeed'
import { TraderFeed } from './TraderFeed'
import { CopySettingsModal } from './CopySettingsModal'
import { useTraderProfile, useFollowTrader, useUnfollowTrader } from '../../hooks/useCopyTrading'
import { useAuth } from '../../contexts/AuthContext'
import { usePair } from '../../contexts/PairContext'
import { useTrading } from '../../contexts/TradingContext'
import { WalletConnect } from '../auth/WalletConnect'
import { api } from '../../lib/api'
import { captureTerminalEvent } from '../../lib/posthog'
import type { FollowSettings, TraderActivity } from '../../types/api'

type Tab = 'top-traders' | 'live-feed' | 'following' | 'copy-feed'

const TABS: { id: Tab; label: string }[] = [
  { id: 'top-traders', label: 'Top Traders' },
  { id: 'live-feed', label: 'Live Feed' },
  { id: 'following', label: 'Following' },
  { id: 'copy-feed', label: 'My Copies' },
]

export function CopyTradingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('top-traders')
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null)
  const [followModalTraderId, setFollowModalTraderId] = useState<string | null>(null)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)

  const { data: selectedTrader } = useTraderProfile(selectedTraderId)
  const { mutate: followTrader } = useFollowTrader()
  const { mutate: unfollowTrader } = useUnfollowTrader()
  const { isAuthenticated, needsTradingProof, isExternalWallet } = useAuth()
  const { setSelectedPair } = usePair()
  const { setTradingMode, setSide } = useTrading()
  const autoCopyAvailable = isAuthenticated && !needsTradingProof && !isExternalWallet

  const handleFollow = (traderId: string) => {
    captureTerminalEvent('copy_follow_intent', { trader_id: traderId, signed_in: isAuthenticated })
    if (!isAuthenticated) {
      setShowAuthPrompt(true)
      return
    }
    setFollowModalTraderId(traderId)
  }

  const handleConfirmFollow = (settings: FollowSettings) => {
    if (!followModalTraderId) return
    followTrader(
      { traderId: followModalTraderId, settings },
      {
        onSuccess: () => {
          captureTerminalEvent('copy_follow_saved', {
            trader_id: followModalTraderId,
            copy_mode: settings.copyMode,
          })
          toast.success(settings.copyMode === 'notify' ? 'Trader followed' : 'Copy rules saved')
        },
        onError: (error) => toast.error(copyErrorMessage(error)),
      },
    )
    setFollowModalTraderId(null)
  }

  const handleUnfollow = (traderId: string) => {
    unfollowTrader(traderId, {
      onSuccess: () => toast.success('Trader unfollowed'),
      onError: (error) => toast.error(copyErrorMessage(error)),
    })
    if (selectedTraderId === traderId) setSelectedTraderId(null)
  }

  const handleTrade = async (activity: TraderActivity) => {
    try {
      const [fromMatches, toMatches] = await Promise.all([
        api.searchTokens(activity.fromToken, activity.fromChain),
        api.searchTokens(activity.toToken, activity.toChain),
      ])
      const exactFrom = fromMatches.filter(
        match => match.symbol.toLowerCase() === activity.fromToken.toLowerCase() && match.chain === activity.fromChain,
      )
      const exactTo = toMatches.filter(
        match => match.symbol.toLowerCase() === activity.toToken.toLowerCase() && match.chain === activity.toChain,
      )
      if (exactFrom.length === 0 || exactTo.length === 0) {
        captureTerminalEvent('copy_trade_ticket_blocked', {
          token: exactFrom.length === 0 ? activity.fromToken : activity.toToken,
          chain: exactFrom.length === 0 ? activity.fromChain : activity.toChain,
          reason: 'not_found',
        })
        toast.error(`${activity.tokenPair} is not fully available in the Terminal token registry yet`)
        return
      }
      if (exactFrom.length > 1 || exactTo.length > 1) {
        captureTerminalEvent('copy_trade_ticket_blocked', {
          token: exactFrom.length > 1 ? activity.fromToken : activity.toToken,
          chain: exactFrom.length > 1 ? activity.fromChain : activity.toChain,
          reason: 'ambiguous_symbol',
        })
        toast.error(
          `Multiple tokens match ${activity.tokenPair} — token-address handoff is required before we can load it safely`,
        )
        return
      }
      const fromToken = exactFrom[0]
      const toToken = exactTo[0]
      // Pair + side encode the exact leader route into the existing spot ticket:
      // buy => quote(from) -> base(to), sell => base(from) -> quote(to).
      // This preserves SOL -> MEME and cross-chain routes instead of silently
      // replacing the other leg with same-chain USDC.
      setSelectedPair(
        activity.action === 'buy'
          ? { base: toToken, quote: fromToken }
          : { base: fromToken, quote: toToken },
      )
      setTradingMode('spot')
      setSide(activity.action)
      captureTerminalEvent('copy_trade_ticket_loaded', {
        token: activity.token,
        chain: activity.chain,
        side: activity.action,
      })
      toast.success(`${activity.tokenPair} loaded in the trade ticket — review before confirming`)
    } catch (error) {
      toast.error(copyErrorMessage(error))
    }
  }

  const handleSelectFeedTrader = (traderId: string) => {
    captureTerminalEvent('copy_trader_opened', { trader_id: traderId, source: 'live_feed' })
    setActiveTab('top-traders')
    setSelectedTraderId(traderId)
  }

  const handleSelectLeaderboardTrader = (traderId: string) => {
    captureTerminalEvent('copy_trader_opened', { trader_id: traderId, source: 'leaderboard' })
    setSelectedTraderId(traderId)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-terminal-border px-2 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              captureTerminalEvent('copy_tab_selected', { tab: tab.id })
              setActiveTab(tab.id)
              setSelectedTraderId(null)
            }}
            className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'top-traders' && (
          selectedTrader ? (
            <div className="p-3">
              <button
                onClick={() => setSelectedTraderId(null)}
                className="text-xs text-terminal-text-muted hover:text-terminal-text mb-3 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to leaderboard
              </button>
              <TraderCard
                trader={selectedTrader}
                onFollow={() => handleFollow(selectedTrader.id)}
                onUnfollow={() => handleUnfollow(selectedTrader.id)}
                onTrade={handleTrade}
              />
            </div>
          ) : (
            <TraderLeaderboard
              onSelectTrader={handleSelectLeaderboardTrader}
              onFollow={handleFollow}
            />
          )
        )}
        {activeTab === 'live-feed' && (
          <TraderFeed onSelectTrader={handleSelectFeedTrader} onTrade={handleTrade} />
        )}
        {activeTab === 'following' && <FollowingList />}
        {activeTab === 'copy-feed' && <CopyFeed />}
      </div>

      {/* Follow settings modal */}
      <CopySettingsModal
        isOpen={!!followModalTraderId}
        onClose={() => setFollowModalTraderId(null)}
        onSave={handleConfirmFollow}
        autoCopyAvailable={autoCopyAvailable}
      />

      {showAuthPrompt && !isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4" onClick={() => setShowAuthPrompt(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="copy-signin-title"
            className="terminal-theme-overlay w-full max-w-sm rounded-xl border border-terminal-border p-5"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 id="copy-signin-title" className="text-sm font-semibold text-terminal-text">Sign in to follow traders</h3>
                <p className="mt-1 text-xs leading-relaxed text-terminal-text-muted">
                  Browse performance without an account. Sign in only when you want alerts or copy settings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthPrompt(false)}
                className="text-lg leading-none text-terminal-text-muted hover:text-terminal-text"
                aria-label="Close sign in"
              >
                &times;
              </button>
            </div>
            <WalletConnect showGoogle />
          </div>
        </div>
      )}
    </div>
  )
}

function copyErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    return String((error as { detail?: unknown }).detail || 'Copy trading request failed')
  }
  return error instanceof Error ? error.message : 'Copy trading request failed'
}
