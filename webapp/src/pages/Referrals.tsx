import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from '@/lib/a11yToast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type ReferralStats, type ReferredUser, type ReferralLeaderboardEntry } from '../lib/api'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function TierBadge({ tier }: { tier: ReferralStats['tier'] }) {
  const labels: Record<ReferralStats['tier'], string> = {
    standard: 'Standard Partner',
    power: 'Power Partner',
    elite: 'Elite Partner',
  }
  const colours: Record<ReferralStats['tier'], string> = {
    standard: 'bg-slate-100 text-slate-700',
    power: 'bg-amber-100 text-amber-700',
    elite: 'bg-purple-100 text-suwappu-purple-deep',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colours[tier]}`}>
      {labels[tier]}
    </span>
  )
}

type Tab = 'referrals' | 'leaderboard'

export function Referrals() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [referrals, setReferrals] = useState<ReferredUser[]>([])
  const [leaderboard, setLeaderboard] = useState<ReferralLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<Tab>('referrals')

  const REFERRALS_API_AVAILABLE = true

  useEffect(() => {
    if (REFERRALS_API_AVAILABLE) {
      loadData()
    } else {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [statsData, referralsData, lbData] = await Promise.all([
        api.getReferralStats(),
        api.getReferredUsers(),
        api.getReferralLeaderboard(),
      ])
      setStats(statsData)
      setReferrals(referralsData)
      setLeaderboard(lbData)
    } catch (err: any) {
      toast.error(err.detail || 'Could not load referral data. Try again later.')
    } finally {
      setLoading(false)
    }
  }

  const referralLink = stats?.referral_link ?? ''

  const handleCopy = async () => {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
    } catch {
      // Fallback for older browsers / Telegram WebView
      const input = document.createElement('input')
      input.value = referralLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    toast.success('Referral link copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = async () => {
    if (!referralLink) return
    const text = `Join me on Suwappu — swap cross-chain in seconds and earn rewards!\n\n${referralLink}`
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        // User cancelled or not supported — fall back to copy
        handleCopy()
      }
    } else {
      handleCopy()
    }
  }

  return (
    <AppLayout
      header={<AppHeader title="Referrals" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Loading state */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-suwappu-purple-deep border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-suwappu-text-secondary text-sm">Loading...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Hero / share card — always shown so new users can immediately copy their link */}
            <div className="bg-gradient-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white">
              <div className="flex items-center justify-between mb-3">
                <span className="text-3xl" aria-hidden="true">🎁</span>
                {stats ? (
                  <div className="flex items-center gap-2">
                    <TierBadge tier={stats.tier} />
                    <span className="text-xs bg-white/20 px-2 py-1 rounded-full font-mono">
                      {stats.referral_code}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Your code</span>
                )}
              </div>

              <p className="font-heading font-semibold text-lg mb-1">
                Invite Friends, Earn Rewards
              </p>
              <p className="text-sm text-white/80 mb-1">
                Earn {stats ? stats.reward_rate_pct : 30}% of every trade your friends make — forever.
              </p>
              {stats && stats.tier !== 'elite' && (
                <p className="text-xs text-white/60 mb-3">
                  Refer more volume to unlock 40% (Elite Partner tier)
                </p>
              )}
              {(!stats || stats.tier === 'elite') && <div className="mb-3" />}

              {/* Link display */}
              {referralLink && (
                <div className="bg-white/10 rounded-lg px-3 py-2 mb-3 text-xs text-white/90 truncate font-mono">
                  {referralLink}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-2.5 bg-white text-suwappu-purple-deep font-medium rounded-lg text-sm active:scale-[0.98] transition-transform"
                  aria-label="Copy referral link"
                >
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={handleShare}
                  className="flex-1 py-2.5 bg-white/20 text-white font-medium rounded-lg text-sm active:scale-[0.98] transition-transform"
                  aria-label="Share referral link"
                >
                  Share
                </button>
              </div>
            </div>

            {/* Stats grid — zeros shown for new users */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Lifetime Earned</p>
                <p className="font-heading font-bold text-2xl text-suwappu-text">
                  ${(stats?.total_earnings_usd ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Claimable</p>
                <p className="font-heading font-bold text-2xl text-yellow-600">
                  ${(stats?.pending_rewards_usd ?? 0).toFixed(2)}
                </p>
                {(stats?.pending_rewards_count ?? 0) > 0 && (
                  <p className="text-[10px] text-suwappu-text-secondary">
                    {stats!.pending_rewards_count} reward{stats!.pending_rewards_count !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Total Referrals</p>
                <p className="font-heading font-bold text-2xl text-suwappu-purple-deep">
                  {stats?.total_referrals ?? 0}
                </p>
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Active</p>
                <p className="font-heading font-bold text-2xl text-green-600">
                  {stats?.active_referrals ?? 0}
                </p>
              </div>
            </div>

            {/* Claim note */}
            {(stats?.pending_rewards_usd ?? 0) > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-suwappu-lg p-3">
                <p className="text-xs text-yellow-800 font-medium mb-0.5">Pending rewards</p>
                <p className="text-xs text-yellow-700">
                  Claim your rewards in the Telegram bot using <span className="font-mono font-semibold">/ref</span>. In-app claiming is coming soon.
                </p>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-suwappu-sakura-light/30 rounded-lg p-1">
              {(['referrals', 'leaderboard'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    tab === t
                      ? 'bg-white text-suwappu-purple-deep shadow-sm'
                      : 'text-suwappu-text-secondary'
                  }`}
                >
                  {t === 'referrals' ? 'Your Referrals' : 'Leaderboard'}
                </button>
              ))}
            </div>

            {/* Your Referrals tab */}
            {tab === 'referrals' && (
              <>
                {referrals.length > 0 ? (
                  <div className="space-y-2">
                    {referrals.map((r) => (
                      <div
                        key={r.user_id}
                        className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-sm text-suwappu-text">
                            {r.username ? `@${r.username}` : `User #${r.user_id}`}
                          </p>
                          <p className="text-[10px] text-suwappu-text-secondary">
                            Joined {formatDate(r.joined_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-heading font-bold text-sm text-green-600">
                            +${r.total_rewards_usd.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-suwappu-text-secondary">earned</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
                    <span className="text-4xl block mb-2" aria-hidden="true">👋</span>
                    <p className="font-heading font-semibold text-suwappu-text mb-1">No referrals yet</p>
                    <p className="text-xs text-suwappu-text-secondary">
                      Share your link above and start earning {stats?.reward_rate_pct ?? 30}% of every swap your friends make.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Leaderboard tab */}
            {tab === 'leaderboard' && (
              <>
                {leaderboard.length > 0 ? (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => (
                      <div
                        key={entry.rank}
                        className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 flex items-center gap-3"
                      >
                        <span
                          className={`w-7 text-center font-heading font-bold text-sm ${
                            entry.rank === 1
                              ? 'text-yellow-500'
                              : entry.rank === 2
                              ? 'text-slate-400'
                              : entry.rank === 3
                              ? 'text-amber-600'
                              : 'text-suwappu-text-secondary'
                          }`}
                        >
                          #{entry.rank}
                        </span>
                        <p className="flex-1 font-medium text-sm text-suwappu-text truncate">
                          {entry.username ? `@${entry.username}` : 'Anonymous'}
                        </p>
                        <p className="font-heading font-bold text-sm text-green-600">
                          ${entry.total_reward_usd.toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
                    <p className="text-xs text-suwappu-text-secondary">Leaderboard is empty — be the first!</p>
                  </div>
                )}
              </>
            )}

            {/* How it works */}
            <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
              <p className="text-xs font-medium text-suwappu-text mb-2">How it works</p>
              <ul className="text-xs text-suwappu-text-secondary space-y-1">
                <li>1. Share your unique referral link</li>
                <li>2. Friends sign up and start swapping</li>
                <li>3. You earn {stats?.reward_rate_pct ?? 30}% of their swap fees — forever</li>
                <li>4. Claim rewards anytime via <span className="font-mono">/ref</span> in the bot</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
