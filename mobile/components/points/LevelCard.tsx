/**
 * Level + XP progress bar + fee discount display.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { UserPointsInfo } from '../../../packages/shared/src/types/points'

interface LevelCardProps {
  info: UserPointsInfo
}

export default function LevelCard({ info }: LevelCardProps) {
  const progress = info.xpToNextLevel && info.xpToNextLevel > 0
    ? 1 - (info.xpToNextLevel / (info.xp + info.xpToNextLevel))
    : 1

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{info.levelEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.level}>{info.level}</Text>
          <Text style={styles.xp}>{info.xp.toLocaleString()} XP</Text>
        </View>
        <View style={styles.discount}>
          <Text style={styles.discountValue}>{info.feeDiscount}%</Text>
          <Text style={styles.discountLabel}>fee</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
      </View>
      {info.nextLevel && info.xpToNextLevel && (
        <Text style={styles.nextLevel}>
          {info.xpToNextLevel.toLocaleString()} XP to {info.nextLevel}
        </Text>
      )}

      {/* Points & Streak */}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{info.points.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Points</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{info.spendablePoints.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Spendable</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{info.dailyStreak}</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  emoji: { fontSize: 36 },
  level: { fontSize: 20, fontWeight: '700', color: colors.text },
  xp: { fontSize: 14, color: colors.textSecondary },
  discount: { alignItems: 'center' },
  discountValue: { fontSize: 18, fontWeight: '700', color: colors.success },
  discountLabel: { fontSize: 11, color: colors.textTertiary },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  nextLevel: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '600', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textTertiary },
})
