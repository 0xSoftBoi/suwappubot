/**
 * Trader profile + stats + recent trades.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTraderProfile } from '../../../../hooks/useCopyTrading'
import { useUIStore } from '../../../../stores/ui'
import { colors, spacing, radius } from '../../../../lib/theme'

export default function TraderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const traderId = parseInt(id, 10)
  const { data: trader, isLoading } = useTraderProfile(traderId)
  const setSelectedTraderId = useUIStore(s => s.setSelectedTraderId)

  const handleFollow = () => {
    setSelectedTraderId(traderId)
    router.push('/(features)/copy-trading/follow-config' as any)
  }

  if (isLoading || !trader) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  const pnlColor = trader.totalPnl >= 0 ? colors.success : colors.error

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile header */}
      <View style={styles.profileCard}>
        <Text style={styles.emoji}>{trader.emoji || '🤖'}</Text>
        <Text style={styles.name}>{trader.displayName}</Text>
        {trader.bio && <Text style={styles.bio}>{trader.bio}</Text>}
        <Text style={styles.followers}>{trader.followerCount} followers</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: pnlColor }]}>
            {trader.totalPnl >= 0 ? '+' : ''}{trader.totalPnl.toFixed(1)}%
          </Text>
          <Text style={styles.statLabel}>Total PnL</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{(trader.winRate * 100).toFixed(0)}%</Text>
          <Text style={styles.statLabel}>Win Rate</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{trader.totalTrades}</Text>
          <Text style={styles.statLabel}>Trades</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{trader.timesCopied}</Text>
          <Text style={styles.statLabel}>Times Copied</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.success }]}>
            +{trader.bestTrade.toFixed(1)}%
          </Text>
          <Text style={styles.statLabel}>Best Trade</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.error }]}>
            {trader.worstTrade.toFixed(1)}%
          </Text>
          <Text style={styles.statLabel}>Worst Trade</Text>
        </View>
      </View>

      {/* Follow CTA */}
      <TouchableOpacity style={styles.followButton} onPress={handleFollow}>
        <Text style={styles.followText}>Follow Trader</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emoji: { fontSize: 48 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  bio: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  followers: { fontSize: 13, color: colors.textTertiary },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  stat: {
    width: '30%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  followButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  followText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
})
