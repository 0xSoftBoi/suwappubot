import { useRewardStore, useRedeemReward } from '../../hooks/usePoints'
import type { Reward } from '../../types/api'
import toast from 'react-hot-toast'

function RewardCard({ reward, userXp }: { reward: Reward; userXp: number }) {
  const redeemMutation = useRedeemReward()
  const canAfford = userXp >= reward.cost
  const outOfStock = reward.stock <= 0

  const handleRedeem = () => {
    if (!canAfford || outOfStock) return
    redeemMutation.mutate(reward.id, {
      onSuccess: (data) => {
        toast.success(data.message || `Redeemed ${reward.name}!`)
      },
      onError: () => {
        toast.error('Redemption failed')
      },
    })
  }

  return (
    <div className="terminal-panel p-4 flex flex-col gap-3" data-testid="reward-card">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-terminal-text">{reward.name}</span>
        <span className="text-xs text-terminal-text-muted">{reward.description}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-sakura-400">
          {reward.cost.toLocaleString()} XP
        </span>
        <span className={`text-xs font-mono ${reward.stock <= 5 ? 'text-red-400' : 'text-terminal-text-secondary'}`}>
          {reward.stock} left
        </span>
      </div>

      <button
        onClick={handleRedeem}
        disabled={!canAfford || outOfStock || redeemMutation.isPending}
        className={`terminal-button text-sm w-full ${
          outOfStock
            ? 'bg-terminal-bg-tertiary text-terminal-text-muted'
            : !canAfford
              ? 'bg-terminal-bg-tertiary text-terminal-text-muted'
              : ''
        }`}
      >
        {redeemMutation.isPending
          ? 'Redeeming...'
          : outOfStock
            ? 'Out of Stock'
            : !canAfford
              ? `Need ${(reward.cost - userXp).toLocaleString()} more XP`
              : 'Redeem'}
      </button>
    </div>
  )
}

export function RewardStore() {
  const { data } = useRewardStore()
  const rewards = data?.rewards ?? []
  const userXp = data?.userXp ?? 0

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-terminal-text-secondary">Available Rewards</span>
        <span className="font-mono text-xs text-sakura-400">
          Your balance: {userXp.toLocaleString()} XP
        </span>
      </div>
      {rewards.length === 0 ? (
        <div className="terminal-panel p-6 text-center text-sm text-terminal-text-muted">
          Reward store is not connected yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rewards.map(r => (
            <RewardCard key={r.id} reward={r} userXp={userXp} />
          ))}
        </div>
      )}
    </div>
  )
}
