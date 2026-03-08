/**
 * Trader leaderboard card — shows performance stats.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { colors, spacing, radius } from '../../lib/theme'
import type { TraderProfile } from '../../../packages/shared/src/types/copy-trading'

interface TraderCardProps {
  trader: TraderProfile
  rank?: number
}

export default function TraderCard({ trader, rank }: TraderCardProps) {
  const router = useRouter()
  const pnlColor = trader.totalPnl >= 0 ? colors.success : colors.error

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push(`/(features)/copy-trading/trader/${trader.id}` as any)}
    >
      <View style={styles.header}>
        <View style={styles.nameRow}>
          {rank && <Text style={styles.rank}>#{rank}</Text>}
          <Text style={styles.emoji}>{trader.emoji || '🤖'}</Text>
          <View>
            <Text style={styles.name}>{trader.displayName}</Text>
            <Text style={styles.followers}>{trader.followerCount} followers</Text>
          </View>
        </View>
        <View style={[styles.pnlBadge, { backgroundColor: pnlColor + '15' }]}>
          <Text style={[styles.pnlText, { color: pnlColor }]}>
            {trader.totalPnl >= 0 ? '+' : ''}{trader.totalPnl.toFixed(1)}%
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{trader.totalTrades}</Text>
          <Text style={styles.statLabel}>Trades</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{(trader.winRate * 100).toFixed(0)}%</Text>
          <Text style={styles.statLabel}>Win Rate</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{trader.timesCopied}</Text>
          <Text style={styles.statLabel}>Copied</Text>
        </View>
      </View>
    </TouchableOpacity>
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { fontSize: 16, fontWeight: '700', color: colors.textTertiary, width: 30 },
  emoji: { fontSize: 28 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  followers: { fontSize: 12, color: colors.textTertiary },
  pnlBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  pnlText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceMono' },
  stats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textTertiary },
})
