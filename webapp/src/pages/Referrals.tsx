import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type ReferralStats, type ReferredUser } from '../lib/api'

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function Referrals() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [referrals, setReferrals] = useState<ReferredUser[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // The /webapp/referrals* endpoints do not exist in api-ts yet — fetching them
  // 404s on every load and toasts an error at the user. Until the backend ships,
  // render the coming-soon state instead of firing dead requests. Referral links
  // remain available in the Telegram bot via /ref.
  const REFERRALS_API_AVAILABLE = false

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
      const [statsData, referralsData] = await Promise.all([
        api.getReferralStats(),
        api.getReferredUsers(),
      ])
      setStats(statsData)
      setReferrals(referralsData)
    } catch (err: any) {
      toast.error(err.detail || 'Failed to load referral data')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!stats?.referralLink) return
    try {
      await navigator.clipboard.writeText(stats.referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input')
      input.value = stats.referralLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = async () => {
    if (!stats?.referralLink) return
    const text = `Join me on Suwappu and get bonus rewards! 🎁\n\n${stats.referralLink}`
    
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        // User cancelled or not supported
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

        {!loading && !stats && (
          <div className="text-center py-12">
            <span className="text-4xl block mb-3">🎁</span>
            <h2 className="font-semibold text-suwappu-text-primary mb-1">
              Referrals coming soon
            </h2>
            <p className="text-sm text-suwappu-text-secondary">
              Earn 30% of trading fees from friends you refer. Until this page
              launches, grab your personal link with /ref in the Telegram bot.
            </p>
          </div>
        )}

        {!loading && stats && (
          <>
            {/* Referral Link Card */}
            <div className="bg-gradient-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white">
              <div className="flex items-center justify-between mb-3">
                <span className="text-3xl">🎁</span>
                <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
                  {stats.referralCode || 'Loading...'}
                </span>
              </div>
              
              <p className="font-heading font-semibold text-lg mb-1">
                Invite Friends, Earn Rewards
              </p>
              <p className="text-sm text-white/80 mb-4">
                Earn 10% of your friends' swap fees forever!
              </p>
              
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-2.5 bg-white text-suwappu-purple-deep font-medium rounded-lg text-sm active:scale-[0.98] transition-transform"
                >
                  {copied ? '✓ Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={handleShare}
                  className="flex-1 py-2.5 bg-white/20 text-white font-medium rounded-lg text-sm active:scale-[0.98] transition-transform"
                >
                  Share
                </button>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Total Referrals</p>
                <p className="font-heading font-bold text-2xl text-suwappu-purple-deep">
                  {stats.totalReferrals}
                </p>
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Active</p>
                <p className="font-heading font-bold text-2xl text-green-600">
                  {stats.activeReferrals}
                </p>
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Total Earned</p>
                <p className="font-heading font-bold text-2xl text-suwappu-text">
                  ${stats.totalEarned.toFixed(2)}
                </p>
              </div>
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <p className="text-[10px] text-suwappu-text-secondary mb-1">Pending</p>
                <p className="font-heading font-bold text-2xl text-yellow-600">
                  ${stats.pendingRewards.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Referrals List */}
            {referrals.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium text-suwappu-text-secondary mb-2">
                  Your Referrals
                </h3>
                <div className="space-y-2">
                  {referrals.map((referral) => (
                    <div key={referral.id} className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm text-suwappu-text">
                          {referral.username || `User #${referral.id}`}
                        </p>
                        <p className="text-[10px] text-suwappu-text-secondary">
                          Joined {formatTime(referral.joinedAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-heading font-bold text-sm text-green-600">
                          +${referral.rewardsGenerated.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-suwappu-text-secondary">
                          earned
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
                <span className="text-4xl block mb-2">👋</span>
                <p className="font-heading font-semibold text-suwappu-text mb-1">
                  No referrals yet
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  Share your link to start earning rewards!
                </p>
              </div>
            )}

            {/* How it works */}
            <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
              <p className="text-xs font-medium text-suwappu-text mb-2">How it works:</p>
              <ul className="text-xs text-suwappu-text-secondary space-y-1">
                <li>1. Share your unique referral link</li>
                <li>2. Friends sign up and start swapping</li>
                <li>3. You earn 10% of their swap fees forever!</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
