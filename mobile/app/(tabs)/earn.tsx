/**
 * Discover tab — trending tokens at top, earn features below.
 * (File kept as earn.tsx to avoid breaking expo-router tab naming.)
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTrendingTokens } from '../../hooks/useTokenDiscovery'
import { TrendingTokenRow } from '../../components/discovery/TrendingTokenRow'
import { colors, spacing, radius } from '../../lib/theme'

export default function DiscoverTab() {
  const router = useRouter()
  const { data: trending, isLoading } = useTrendingTokens('all', 10)

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Trending Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Trending</Text>
        <TouchableOpacity onPress={() => router.push('/(features)/discover' as any)}>
          <Text style={styles.seeAll}>See All</Text>
        </TouchableOpacity>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.text} style={{ paddingVertical: 24 }} />
      ) : trending && trending.length > 0 ? (
        trending.map((token, i) => (
          <TrendingTokenRow key={`${token.address}-${token.chain}`} token={token} rank={i + 1} />
        ))
      ) : (
        <Text style={styles.emptyText}>No trending tokens</Text>
      )}

      {/* Earn Features */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.xxl }]}>Earn</Text>
      <Text style={styles.subtitle}>Grow your rewards and follow top traders</Text>

      <View style={styles.cards}>
        {[
          {
            title: 'Points & XP',
            description: 'Earn XP, level up, and unlock fee discounts',
            route: '/points',
          },
          {
            title: 'Copy Trading',
            description: 'Follow top traders and copy their moves',
            route: '/copy-trading',
          },
          {
            title: 'Referrals',
            description: 'Earn 30% of trading fees from your referrals',
            route: '/referral',
          },
        ].map((feature) => (
          <TouchableOpacity
            key={feature.title}
            style={styles.card}
            onPress={() => router.push(`/(features)${feature.route}` as any)}
          >
            <Text style={styles.cardTitle}>{feature.title}</Text>
            <Text style={styles.cardDescription}>{feature.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 40 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  seeAll: { fontSize: 14, color: colors.accent, fontWeight: '500' },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.lg },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  cards: { gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardDescription: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
})
