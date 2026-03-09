/**
 * Points dashboard — level, check-in, milestones, rewards.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'
import { usePoints, useDailyCheckin, useMilestones, useRewards, useRedeemReward } from '../../../hooks/usePoints'
import LevelCard from '../../../components/points/LevelCard'
import MilestoneCard from '../../../components/points/MilestoneCard'
import RewardCard from '../../../components/points/RewardCard'
import { colors, spacing, radius } from '../../../lib/theme'

export default function PointsScreen() {
  const router = useRouter()
  const { data: points, isLoading } = usePoints()
  const { data: milestones } = useMilestones()
  const { data: rewards } = useRewards()
  const checkinMutation = useDailyCheckin()
  const redeemMutation = useRedeemReward()

  if (isLoading || !points) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Level card */}
      <LevelCard info={points} />

      {/* Daily check-in */}
      <TouchableOpacity
        style={[styles.checkinButton, !points.canCheckin && styles.checkinDisabled]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          checkinMutation.mutate(undefined, {
            onSuccess: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              Alert.alert('Checked In!', '+10 points earned')
            },
          })
        }}
        disabled={!points.canCheckin || checkinMutation.isPending}
      >
        {checkinMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <>
            <FontAwesome name="calendar-check-o" size={18} color={points.canCheckin ? colors.bg : colors.textTertiary} />
            <Text style={[styles.checkinText, !points.canCheckin && styles.checkinTextDisabled]}>
              {points.canCheckin ? 'Daily Check-in (+10 pts)' : 'Checked in today'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Quick links */}
      <View style={styles.quickLinks}>
        <TouchableOpacity
          style={styles.quickLink}
          onPress={() => { Haptics.selectionAsync(); router.push('/(features)/points/leaderboard' as any) }}
        >
          <FontAwesome name="trophy" size={16} color={colors.warning} />
          <Text style={styles.quickLinkText}>Leaderboard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickLink}
          onPress={() => { Haptics.selectionAsync(); router.push('/(features)/points/history' as any) }}
        >
          <FontAwesome name="history" size={16} color={colors.textSecondary} />
          <Text style={styles.quickLinkText}>History</Text>
        </TouchableOpacity>
      </View>

      {/* Milestones */}
      {milestones && milestones.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Milestones</Text>
          <View style={styles.milestoneGrid}>
            {milestones.map(m => (
              <MilestoneCard key={m.id} milestone={m} />
            ))}
          </View>
        </>
      )}

      {/* Rewards shop */}
      {rewards && rewards.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Rewards Shop</Text>
          {rewards.map(r => (
            <RewardCard
              key={r.id}
              reward={r}
              spendablePoints={points.spendablePoints}
              onRedeem={id => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                redeemMutation.mutate(id, {
                  onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
                  onError: () => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
                    Alert.alert('Error', 'Failed to redeem reward.')
                  },
                })
              }}
              isRedeeming={redeemMutation.isPending}
            />
          ))}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  checkinButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  checkinDisabled: { backgroundColor: colors.cardAlt },
  checkinText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  checkinTextDisabled: { color: colors.textTertiary },
  quickLinks: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  quickLink: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  quickLinkText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  milestoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
})
