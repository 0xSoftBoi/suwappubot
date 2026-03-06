/**
 * Trader profile screen — performance stats, follow CTA.
 */
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useTraderProfile } from '../../../hooks/useCopyTrading'
import { useUIStore } from '../../../stores/ui'
import { colors, spacing, radius } from '../../../lib/theme'

export default function TraderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const traderId = id ? parseInt(id, 10) : 0
  const { data: trader, isLoading } = useTraderProfile(traderId)
  const setSelectedTraderId = useUIStore((s) => s.setSelectedTraderId)

  if (isLoading || !trader) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: 'Trader' }} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} size="large" />
        </View>
      </>
    )
  }

  const pnlColor = trader.totalPnl >= 0 ? colors.success : colors.error
  const pnlPrefix = trader.totalPnl >= 0 ? '+' : ''

  return (
    <>
      <Stack.Screen options={{ headerTitle: trader.displayName }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Profile header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{trader.emoji || trader.displayName.slice(0, 2)}</Text>
          </View>
          <Text style={styles.name}>{trader.displayName}</Text>
          {trader.bio && <Text style={styles.bio}>{trader.bio}</Text>}
          <View style={styles.headerStats}>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{trader.followerCount}</Text>
              <Text style={styles.headerStatLabel}>Followers</Text>
            </View>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{trader.timesCopied}</Text>
              <Text style={styles.headerStatLabel}>Copied</Text>
            </View>
            <View style={styles.headerStat}>
              <Text style={styles.headerStatValue}>{trader.totalTrades}</Text>
              <Text style={styles.headerStatLabel}>Trades</Text>
            </View>
          </View>
        </View>

        {/* Performance grid */}
        <View style={styles.statsGrid}>
          <StatCard
            label="Win Rate"
            value={`${(trader.winRate * 100).toFixed(1)}%`}
            color={trader.winRate >= 0.5 ? colors.success : colors.error}
          />
          <StatCard
            label="Total PnL"
            value={`${pnlPrefix}$${Math.abs(trader.totalPnl).toLocaleString()}`}
            color={pnlColor}
          />
          <StatCard
            label="Best Trade"
            value={`+$${trader.bestTrade.toLocaleString()}`}
            color={colors.success}
          />
          <StatCard
            label="Worst Trade"
            value={`-$${Math.abs(trader.worstTrade).toLocaleString()}`}
            color={colors.error}
          />
          <StatCard
            label="Rank Score"
            value={trader.rankScore.toFixed(1)}
            color={colors.primary}
          />
          <StatCard
            label="Member Since"
            value={new Date(trader.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              year: 'numeric',
            })}
            color={colors.textSecondary}
          />
        </View>

        {/* Follow CTA */}
        <TouchableOpacity
          style={styles.followButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setSelectedTraderId(traderId)
            router.push('/(features)/copy-trading/follow-config' as any)
          }}
        >
          <Text style={styles.followButtonText}>Follow Trader</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 28, color: colors.primary },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  bio: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  headerStats: {
    flexDirection: 'row',
    gap: spacing.xxxl,
    marginTop: spacing.xl,
  },
  headerStat: { alignItems: 'center' },
  headerStatValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  headerStatLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  statLabel: { fontSize: 12, color: colors.textSecondary },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  followButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  followButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
