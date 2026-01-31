/**
 * Reward shop item with redeem CTA.
 */
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { Reward } from '../../../packages/shared/src/types/points'

interface RewardCardProps {
  reward: Reward
  spendablePoints: number
  onRedeem: (id: number) => void
  isRedeeming: boolean
}

export default function RewardCard({ reward, spendablePoints, onRedeem, isRedeeming }: RewardCardProps) {
  const canAfford = spendablePoints >= reward.cost

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.name}>{reward.name}</Text>
        <Text style={styles.description}>{reward.description}</Text>
        <Text style={styles.cost}>{reward.cost.toLocaleString()} pts</Text>
      </View>
      <TouchableOpacity
        style={[styles.redeemButton, !canAfford && styles.redeemDisabled]}
        onPress={() => onRedeem(reward.id)}
        disabled={!canAfford || isRedeeming}
      >
        {isRedeeming ? (
          <ActivityIndicator color={colors.bg} size="small" />
        ) : (
          <Text style={[styles.redeemText, !canAfford && styles.redeemTextDisabled]}>
            Redeem
          </Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  description: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  cost: { fontSize: 13, color: colors.warning, fontWeight: '500', marginTop: spacing.xs },
  redeemButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  redeemDisabled: { opacity: 0.3 },
  redeemText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  redeemTextDisabled: { color: colors.bg },
})
