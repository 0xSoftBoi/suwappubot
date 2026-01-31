import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { useAuth } from '../contexts/AuthContext'

interface ReferralStats {
  totalReferrals: number
  activeReferrals: number
  totalEarned: number
  pendingRewards: number
}

interface Referral {
  id: string
  username: string
  joinedAt: string
  volumeGenerated: number
  rewardEarned: number
}

// Mock data - will connect to API
const mockStats: ReferralStats = {
  totalReferrals: 0,
  activeReferrals: 0,
  totalEarned: 0,
  pendingRewards: 0,
}

export function Referrals() {
  const navigate = useNavigate()
  const { telegramUser } = useAuth()
  const [stats] = useState<ReferralStats>(mockStats)
  const [referrals] = useState<Referral[]>([])
  const [copied, setCopied] = useState(false)

  // Generate referral link
  const referralCode = telegramUser?.id?.toString() || 'SUWAPPU'
  const referralLink = `https://t.me/SuwappuBot?start=ref_${referralCode}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input')
      input.value = referralLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Join Suwappu!',
        text: 'Swap tokens across 7 chains with me on Suwappu!',
        url: referralLink,
      })
    } else {
      handleCopy()
    }
  }

  return (
    <AppLayout 
      header={<AppHeader title="Referrals" showBack onBack={() => navigate(-1)} />} 
      activeNav="home"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Referral Link Card */}
        <div className="bg-gradient-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🎁</span>
            <div>
              <p className="font-heading font-bold">Invite Friends, Earn Rewards!</p>
              <p className="text-xs text-white/70">Earn 10% of your referrals' trading fees</p>
            </div>
          </div>
          
          <div className="bg-white/10 rounded-lg p-3 mb-3">
            <p className="text-xs text-white/70 mb-1">Your Referral Link</p>
            <p className="font-mono text-sm break-all">{referralLink}</p>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 py-2 bg-white/20 rounded-suwappu-lg font-medium text-sm hover:bg-white/30 transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
            <button
              onClick={handleShare}
              className="flex-1 py-2 bg-white rounded-suwappu-lg text-suwappu-magenta-mid font-medium text-sm hover:bg-white/90 transition-colors"
            >
              📤 Share
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
            <p className="text-xs text-suwappu-text-secondary mb-1">Total Referrals</p>
            <p className="font-heading font-bold text-2xl text-suwappu-purple-deep">
              {stats.totalReferrals}
            </p>
          </div>
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
            <p className="text-xs text-suwappu-text-secondary mb-1">Active</p>
            <p className="font-heading font-bold text-2xl text-suwappu-success">
              {stats.activeReferrals}
            </p>
          </div>
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
            <p className="text-xs text-suwappu-text-secondary mb-1">Total Earned</p>
            <p className="font-heading font-bold text-2xl text-suwappu-purple-deep">
              ${stats.totalEarned.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
            <p className="text-xs text-suwappu-text-secondary mb-1">Pending</p>
            <p className="font-heading font-bold text-2xl text-suwappu-warning">
              ${stats.pendingRewards.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Referrals List */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              Your Referrals
            </span>
          </div>
          
          {referrals.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">👥</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
                No referrals yet
              </p>
              <p className="text-xs text-suwappu-text-secondary">
                Share your link to start earning!
              </p>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {referrals.map((ref) => (
                <div key={ref.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm text-suwappu-text">@{ref.username}</p>
                    <p className="text-[10px] text-suwappu-text-secondary">
                      Joined {new Date(ref.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-heading font-bold text-suwappu-success">
                      +${ref.rewardEarned.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-suwappu-text-secondary">
                      ${ref.volumeGenerated.toFixed(0)} volume
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-xl p-4">
          <p className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">
            How Referrals Work
          </p>
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-suwappu-magenta-mid text-white text-xs flex items-center justify-center font-bold">1</span>
              <p className="flex-1 text-xs text-suwappu-text">Share your unique referral link with friends</p>
            </div>
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-suwappu-magenta-mid text-white text-xs flex items-center justify-center font-bold">2</span>
              <p className="flex-1 text-xs text-suwappu-text">They sign up and start trading on Suwappu</p>
            </div>
            <div className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-suwappu-magenta-mid text-white text-xs flex items-center justify-center font-bold">3</span>
              <p className="flex-1 text-xs text-suwappu-text">You earn 10% of their trading fees forever!</p>
            </div>
          </div>
        </div>

        {/* Coming Soon */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
            🚧 Rewards tracking coming soon
          </span>
        </div>
      </div>
    </AppLayout>
  )
}
