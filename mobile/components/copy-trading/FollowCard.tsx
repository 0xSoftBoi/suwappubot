/**
 * Follow config card — shows current follow settings.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { CopyFollow } from '../../../packages/shared/src/types/copy-trading'

interface FollowCardProps {
  follow: CopyFollow
  onUnfollow: (traderId: number) => void
}

export default function FollowCard({ follow, onUnfollow }: FollowCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{follow.traderName}</Text>
        <View style={[styles.modeBadge, {
          backgroundColor: follow.copyMode === 'auto' ? colors.success + '20' : colors.accent + '20',
        }]}>
          <Text style={[styles.modeText, {
            color: follow.copyMode === 'auto' ? colors.success : colors.accent,
          }]}>
            {follow.copyMode === 'auto' ? 'Auto' : 'Notify'}
          </Text>
        </View>
      </View>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Type</Text>
          <Text style={styles.detailValue}>
            {follow.copyType === 'fixed_amount'
              ? `$${follow.copyAmount} fixed`
              : `${follow.copyPercentage}% mirror`}
          </Text>
        </View>
        {follow.maxPerTrade && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Max/Trade</Text>
            <Text style={styles.detailValue}>${follow.maxPerTrade}</Text>
          </View>
        )}
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Copied</Text>
          <Text style={styles.detailValue}>{follow.totalCopied} trades</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>PnL</Text>
          <Text style={[styles.detailValue, {
            color: follow.totalPnl >= 0 ? colors.success : colors.error,
          }]}>
            {follow.totalPnl >= 0 ? '+' : ''}${follow.totalPnl.toFixed(2)}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.unfollowBtn} onPress={() => onUnfollow(follow.traderId)}>
        <Text style={styles.unfollowText}>Unfollow</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  modeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  modeText: { fontSize: 12, fontWeight: '600' },
  details: { marginTop: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 14, color: colors.textTertiary },
  detailValue: { fontSize: 14, color: colors.text, fontFamily: 'SpaceMono' },
  unfollowBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.error + '15',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  unfollowText: { fontSize: 14, color: colors.error, fontWeight: '500' },
})
