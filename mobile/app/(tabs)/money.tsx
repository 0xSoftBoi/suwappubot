import { useCallback } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useSnapshot } from '../../src/hooks/use-gecko'
import { isAuthenticated } from '../../src/lib/auth'
import { formatUsd } from '../../src/lib/format'
import { palette, radius, spacing, styles as s } from '../../src/theme'

export default function MoneyScreen() {
  const signedIn = isAuthenticated()
  const { data, isLoading, isError, isRefetching, refetch } = useSnapshot(signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])
  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading your money…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your money." onRetry={refresh} />

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={palette.accent} />}>
      <View style={s.card}>
        <Text style={s.muted}>Money I can price</Text>
        <Text selectable style={local.total}>{formatUsd(data?.totalValueUsd ?? 0)}</Text>
        {data?.coverage === 'best_effort' ? (
          <Text style={s.muted}>Available sources only. Gecko won’t infer missing balances.</Text>
        ) : null}
      </View>
      <View style={local.section}>
        <Text style={s.heading}>Holdings</Text>
        {(data?.byToken ?? []).map((holding) => (
          <View key={holding.symbol} style={local.holding}>
            <View style={local.row}>
              <Text style={s.heading}>{holding.symbol}</Text>
              <View style={local.right}>
                <Text selectable style={s.body}>{formatUsd(holding.valueUsd)}</Text>
                <Text selectable style={s.muted}>{holding.allocationPct.toFixed(1)}%</Text>
              </View>
            </View>
            <View style={local.track}><View style={[local.fill, { width: `${Math.min(100, Math.max(0, holding.allocationPct))}%` }]} /></View>
          </View>
        ))}
        {data?.byToken.length === 0 ? <Text style={s.muted}>No priced holdings are available yet.</Text> : null}
      </View>
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
})
