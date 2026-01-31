/**
 * Full XP leaderboard.
 */
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLeaderboard } from '../../../hooks/usePoints'
import { colors, spacing, radius } from '../../../lib/theme'
import type { LeaderboardEntry } from '../../../../packages/shared/src/types/points'

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const rankColor = entry.rank === 1
    ? '#fbbf24'
    : entry.rank === 2
    ? '#94a3b8'
    : entry.rank === 3
    ? '#d97706'
    : colors.textTertiary

  return (
    <View style={styles.row}>
      <Text style={[styles.rank, { color: rankColor }]}>#{entry.rank}</Text>
      <Text style={styles.emoji}>{entry.levelEmoji}</Text>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.displayName || entry.username || `User #${entry.userId}`}
        </Text>
        <Text style={styles.level}>{entry.level}</Text>
      </View>
      <Text style={styles.xp}>{entry.xp.toLocaleString()} XP</Text>
    </View>
  )
}

export default function LeaderboardScreen() {
  const { data: entries, isLoading } = useLeaderboard(100)

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FlashList
        data={entries || []}
        contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingVertical: spacing.md }}
        renderItem={({ item }) => <LeaderboardRow entry={item} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rank: { fontSize: 16, fontWeight: '700', width: 36, textAlign: 'center' },
  emoji: { fontSize: 24 },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  level: { fontSize: 12, color: colors.textTertiary },
  xp: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, fontFamily: 'SpaceMono' },
})
