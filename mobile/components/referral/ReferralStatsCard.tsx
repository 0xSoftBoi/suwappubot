/**
 * Referral statistics summary card.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'
import type { ReferralStats } from '../../../packages/shared/src/types/referral'

interface ReferralStatsCardProps {
  stats: ReferralStats
}

export default function ReferralStatsCard({ stats }: ReferralStatsCardProps) {
  const items = [
    { label: 'Referrals', value: stats.totalReferrals.toString() },
    { label: 'Active', value: stats.activeReferrals.toString() },
    { label: 'Volume', value: `$${stats.totalVolume.toLocaleString()}` },
    { label: 'Earned', value: `$${stats.totalRewards.toFixed(2)}` },
    { label: 'Unpaid', value: `$${stats.unpaidRewards.toFixed(2)}` },
  ]

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Stats</Text>
      <View style={styles.grid}>
        {items.map(item => (
          <View key={item.label} style={styles.stat}>
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        ))}
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
  title: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: spacing.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stat: {
    width: '30%',
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '600', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textTertiary },
})
