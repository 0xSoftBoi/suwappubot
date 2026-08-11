import { useCallback } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useEarn, useSnapshot } from '../../src/hooks/use-gecko'
import { isAuthenticated } from '../../src/lib/auth'
import { formatUsd } from '../../src/lib/format'
import { palette, radius, spacing, styles as s } from '../../src/theme'

function titleCase(raw: string): string {
  return raw.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export default function MoneyScreen() {
  const signedIn = isAuthenticated()
  const { data, isLoading, isError, isRefetching, refetch } = useSnapshot(signedIn)
  // Savings is a separate read that must never block or error out Money —
  // if /earn is loading, degraded, or unavailable, this screen simply shows
  // no Savings section rather than an error state (see earn.tsx for that).
  const earn = useEarn(signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])
  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading your money…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your money." onRetry={refresh} />

  const positions = earn.data?.positions ?? []
  const hasSavings = positions.length > 0
  // The wallet snapshot's byToken never contains the Aave aUSDC receipt token
  // — bot/config/tokens.py's TOKENS registry (what the balance reader prices)
  // has no aUSDC entry, only the AAVE governance token. So a deposited
  // position is invisible to /v1/mobile/snapshot today and this sum is
  // purely additive, never a double-count with an existing holding.
  const savingsUsd = positions.reduce((sum, p) => sum + p.balanceUsd, 0)
  const combinedTotal = (data?.totalValueUsd ?? 0) + savingsUsd
  const pctOf = (valueUsd: number) => (combinedTotal > 0 ? (valueUsd / combinedTotal) * 100 : 0)

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={palette.accent} />}>
      <View style={s.card}>
        <Text style={s.muted}>Money I can price</Text>
        <Text selectable style={local.total}>{formatUsd(combinedTotal)}</Text>
        {data?.coverage === 'best_effort' ? (
          <Text style={s.muted}>Available sources only. Gecko won’t infer missing balances.</Text>
        ) : null}
      </View>
      <View style={local.section}>
        <Text style={s.heading}>Holdings</Text>
        {(data?.byToken ?? []).map((holding) => {
          const pct = combinedTotal > 0 ? pctOf(holding.valueUsd) : holding.allocationPct
          return (
            <View key={holding.symbol} style={local.holding}>
              <View style={local.row}>
                <Text style={s.heading}>{holding.symbol}</Text>
                <View style={local.right}>
                  <Text selectable style={s.body}>{formatUsd(holding.valueUsd)}</Text>
                  <Text selectable style={s.muted}>{pct.toFixed(1)}%</Text>
                </View>
              </View>
              <View style={local.track}><View style={[local.fill, { width: `${Math.min(100, Math.max(0, pct))}%` }]} /></View>
            </View>
          )
        })}
        {data?.byToken.length === 0 ? <Text style={s.muted}>No priced holdings are available yet.</Text> : null}
      </View>
      {hasSavings ? (
        <View style={local.section}>
          <Text style={s.heading}>Savings</Text>
          {positions.map((p, i) => {
            const pct = pctOf(p.balanceUsd)
            return (
              <View key={`${p.walletId}-${p.protocol}-${p.chain}-${p.token}-${i}`} style={local.holding}>
                <View style={local.row}>
                  <View>
                    <View style={local.savingsHeader}>
                      <Text style={s.heading}>{p.token}</Text>
                      <View style={local.apyBadge}><Text style={local.apyBadgeText}>{p.apy.toFixed(2)}% APY</Text></View>
                    </View>
                    <Text style={s.muted}>{titleCase(p.protocol)} · {titleCase(p.chain)}</Text>
                  </View>
                  <View style={local.right}>
                    <Text selectable style={s.body}>{formatUsd(p.balanceUsd)}</Text>
                    <Text selectable style={s.muted}>{pct.toFixed(1)}%</Text>
                  </View>
                </View>
                <View style={local.track}><View style={[local.fill, local.fillSavings, { width: `${Math.min(100, Math.max(0, pct))}%` }]} /></View>
              </View>
            )
          })}
        </View>
      ) : null}
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  total: { color: palette.text, fontSize: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { gap: spacing.md },
  holding: { gap: spacing.sm, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  right: { alignItems: 'flex-end', gap: 2 },
  track: { height: 6, borderRadius: radius.full, backgroundColor: palette.surfaceElevated, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.full, backgroundColor: palette.accent },
  fillSavings: { backgroundColor: palette.success },
  savingsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  apyBadge: { backgroundColor: palette.accentSoft, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  apyBadgeText: { color: palette.accent, fontSize: 11, fontWeight: '700' },
})
