/**
 * Token detail screen — price chart, stats, holdings, contract info, quick actions.
 */
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useState, useCallback } from 'react'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useQuery } from '@tanstack/react-query'
import { PriceHeader } from '../../../components/charts/PriceHeader'
import { PriceChart } from '../../../components/charts/PriceChart'
import { useTokenPrice, type Timeframe } from '../../../hooks/useTokenPrice'
import { api } from '../../../lib/api'
import { colors, spacing, radius } from '../../../lib/theme'
import type { Portfolio } from '../../../../packages/shared/src/types/api'

export default function TokenDetailScreen() {
  const { address, chain = 'ethereum', symbol = '' } = useLocalSearchParams<{
    address: string
    chain?: string
    symbol?: string
  }>()
  const router = useRouter()
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')

  const { data, isLoading } = useTokenPrice(chain, address, timeframe)
  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
  })

  // Find user's holdings for this token
  const holding = portfolio?.tokens.find(
    (t) => t.address.toLowerCase() === address?.toLowerCase() && t.chain === chain,
  )

  const handleCopyAddress = useCallback(async () => {
    if (!address) return
    await Clipboard.setStringAsync(address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Copied', 'Contract address copied to clipboard')
  }, [address])

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

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : ''

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

        {/* Holdings section */}
        {holding && (
          <View style={styles.holdingsCard}>
            <Text style={styles.holdingsTitle}>Your Holdings</Text>
            <View style={styles.holdingsRow}>
              <View>
                <Text style={styles.holdingsBalance}>
                  {Number(holding.balance).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{' '}
                  {holding.symbol}
                </Text>
                <Text style={styles.holdingsValue}>
                  ${holding.usdValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>
              <View style={styles.holdingsActions}>
                <TouchableOpacity
                  style={styles.holdingsActionBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/swap',
                      params: { token: address, chain, side: 'buy' },
                    })
                  }
                >
                  <Text style={styles.holdingsActionText}>Buy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.holdingsActionBtn, styles.holdingsActionSell]}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/swap',
                      params: { token: address, chain, side: 'sell' },
                    })
                  }
                >
                  <Text style={styles.holdingsActionText}>Sell</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatItem label="Market Cap" value={formatLargeNumber(data.marketCap)} />
          <StatItem label="Volume 24h" value={formatLargeNumber(data.volume24h)} />
          <StatItem label="Liquidity" value={formatLargeNumber(data.liquidity)} />
          <StatItem label="Holders" value={data.holders ? data.holders.toLocaleString() : '--'} />
        </View>

        {/* Contract info */}
        <View style={styles.contractCard}>
          <Text style={styles.contractTitle}>Contract</Text>
          <TouchableOpacity style={styles.contractRow} onPress={handleCopyAddress}>
            <View>
              <Text style={styles.contractChain}>{chain}</Text>
              <Text style={styles.contractAddress}>{shortAddress}</Text>
            </View>
            <Text style={styles.copyIcon}>📋</Text>
          </TouchableOpacity>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.swapButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push({ pathname: '/(tabs)/swap', params: { token: address, chain } })
            }}
          >
            <Text style={styles.swapButtonText}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.alertButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push({
                pathname: '/(features)/alerts' as any,
                params: { token: address, chain, symbol: data.symbol },
              })
            }}
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
  holdingsCard: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  holdingsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  holdingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holdingsBalance: { fontSize: 18, fontWeight: '700', color: colors.text },
  holdingsValue: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  holdingsActions: { flexDirection: 'row', gap: spacing.sm },
  holdingsActionBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  holdingsActionSell: { backgroundColor: colors.cardAlt },
  holdingsActionText: { fontSize: 14, fontWeight: '600', color: colors.text },
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
  contractCard: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  contractTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  contractRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contractChain: {
    fontSize: 13,
    color: colors.textTertiary,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  contractAddress: {
    fontSize: 15,
    color: colors.text,
    fontFamily: 'SpaceMono',
  },
  copyIcon: { fontSize: 18 },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
  },
  swapButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  swapButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
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
