/**
 * Milestone grid item with progress indicator.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { Milestone } from '../../../packages/shared/src/types/points'

interface MilestoneCardProps {
  milestone: Milestone
}

export default function MilestoneCard({ milestone }: MilestoneCardProps) {
  const progress = Math.min(milestone.currentProgress / milestone.requirement, 1)

  return (
    <View style={[styles.container, milestone.isAchieved && styles.achieved]}>
      <Text style={styles.emoji}>{milestone.emoji}</Text>
      <Text style={styles.name} numberOfLines={1}>{milestone.name}</Text>
      <Text style={styles.description} numberOfLines={2}>{milestone.description}</Text>

      {milestone.isAchieved ? (
        <Text style={styles.done}>Completed</Text>
      ) : (
        <>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {milestone.currentProgress}/{milestone.requirement}
          </Text>
        </>
      )}

      <Text style={styles.reward}>+{milestone.pointsReward} pts</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    width: '48%',
    gap: spacing.xs,
  },
  achieved: { borderWidth: 1, borderColor: colors.success + '40' },
  emoji: { fontSize: 28 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  description: { fontSize: 12, color: colors.textTertiary, lineHeight: 16 },
  progressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  progressText: { fontSize: 11, color: colors.textTertiary },
  done: { fontSize: 12, color: colors.success, fontWeight: '600' },
  reward: { fontSize: 12, color: colors.warning, fontWeight: '500' },
})
