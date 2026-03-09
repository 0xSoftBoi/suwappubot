/**
 * Referral dashboard — code, stats, referral list, share CTA.
 */
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Share } from 'react-native'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'
import { useReferralCode, useReferralStats, useReferralList } from '../../../hooks/useReferrals'
import ReferralCodeCard from '../../../components/referral/ReferralCodeCard'
import ReferralStatsCard from '../../../components/referral/ReferralStatsCard'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

export default function ReferralScreen() {
  const { data: codeData, isLoading: codeLoading } = useReferralCode()
  const { data: stats, isLoading: statsLoading } = useReferralStats()
  const { data: referrals } = useReferralList()

  const isLoading = codeLoading || statsLoading

  const handleShare = async () => {
    if (!codeData?.code) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await Share.share({
        message: `Join Suwappu and trade crypto across 7+ chains! Use my referral code: ${codeData.code}\n\nhttps://app.suwappu.xyz/ref/${codeData.code}`,
      })
    } catch {
      // User cancelled
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Info banner */}
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Earn 30% Commission</Text>
        <Text style={styles.bannerText}>
          Share your referral code and earn 30% of trading fees from everyone who joins
        </Text>
      </View>

      {/* Code */}
      {codeData?.code ? (
        <ReferralCodeCard code={codeData.code} timesUsed={(codeData as any).timesUsed || 0} />
      ) : (
        <View style={styles.noCode}>
          <Text style={styles.noCodeText}>No referral code yet. Complete a swap to get one.</Text>
        </View>
      )}

      {/* Share CTA */}
      {codeData?.code && (
        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <FontAwesome name="share-alt" size={16} color="#fff" />
          <Text style={styles.shareText}>Share & Earn</Text>
        </TouchableOpacity>
      )}

      {/* Stats */}
      {stats && (
        <View style={{ marginTop: spacing.lg }}>
          <ReferralStatsCard stats={stats} />
        </View>
      )}

      {/* Referral list */}
      <Text style={styles.sectionTitle}>Your Referrals</Text>
      {!referrals?.length ? (
        <EmptyState
          icon="users"
          title="No referrals yet"
          subtitle="Share your code to start earning"
        />
      ) : (
        <View>
          {referrals.map(ref => (
            <View key={ref.id} style={styles.referralRow}>
              <View style={styles.referralInfo}>
                <Text style={styles.referralName}>
                  {ref.refereeUsername || `User #${ref.refereeId}`}
                </Text>
                <Text style={styles.referralDate}>
                  Joined {ref.refereeJoinedAt ? new Date(ref.refereeJoinedAt).toLocaleDateString() : 'N/A'}
                </Text>
              </View>
              <View style={styles.referralStats}>
                <Text style={styles.referralVolume}>
                  ${ref.totalVolume.toLocaleString()}
                </Text>
                <Text style={styles.referralReward}>
                  +${ref.totalRewards.toFixed(2)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  banner: {
    backgroundColor: colors.accent + '15',
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accent + '30',
  },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  bannerText: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  noCode: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  noCodeText: { fontSize: 15, color: colors.textSecondary },
  shareButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  shareText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  referralRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  referralInfo: { flex: 1 },
  referralName: { fontSize: 15, fontWeight: '500', color: colors.text },
  referralDate: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  referralStats: { alignItems: 'flex-end' },
  referralVolume: { fontSize: 14, color: colors.textSecondary, fontFamily: 'SpaceMono' },
  referralReward: { fontSize: 13, color: colors.success, fontWeight: '500' },
})
