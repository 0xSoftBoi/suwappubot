/**
 * Token detail screen — price chart, stats, swap CTA.
 */
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { PriceHeader } from '../../../components/charts/PriceHeader'
import { PriceChart } from '../../../components/charts/PriceChart'
import { useTokenPrice, type Timeframe } from '../../../hooks/useTokenPrice'
import { colors, spacing, radius } from '../../../lib/theme'

export default function TokenDetailScreen() {
  const { address, chain = 'ethereum', symbol = '' } = useLocalSearchParams<{
    address: string
    chain?: string
    symbol?: string
  }>()
  const router = useRouter()
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')

  const { data, isLoading } = useTokenPrice(chain, address, timeframe)

  if (isLoading || !data) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: symbol || 'Token' }} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} size="large" />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerTitle: data.symbol || symbol || 'Token' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Price Header */}
        <PriceHeader
          symbol={data.symbol}
          name={data.name}
          price={data.price}
          changePercent24h={data.changePercent24h}
        />

        {/* Chart */}
        <PriceChart
          prices={data.prices}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
        />

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatItem label="Market Cap" value={formatLargeNumber(data.marketCap)} />
          <StatItem label="Volume 24h" value={formatLargeNumber(data.volume24h)} />
          <StatItem label="Liquidity" value={formatLargeNumber(data.liquidity)} />
          <StatItem label="Holders" value={data.holders ? data.holders.toLocaleString() : '--'} />
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.swapButton}
            onPress={() => router.push({ pathname: '/(tabs)/swap', params: { token: address, chain } })}
          >
            <Text style={styles.swapButtonText}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.alertButton}
            onPress={() =>
              router.push({
                pathname: '/(features)/alerts' as any,
                params: { token: address, chain, symbol: data.symbol },
              })
            }
          >
            <Text style={styles.alertButtonText}>Set Alert</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

function formatLargeNumber(num: number | null | undefined): string {
  if (num == null) return '--'
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`
  return `$${num.toFixed(2)}`
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  statItem: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  statLabel: { fontSize: 12, color: colors.textSecondary },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 4 },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
  },
  swapButton: {
    flex: 1,
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  swapButtonText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  alertButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  alertButtonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
})
