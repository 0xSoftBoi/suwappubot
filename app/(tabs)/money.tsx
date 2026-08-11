import { useCallback, useEffect } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ErrorState, InfoNote, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useBorrow, useEarn, useSnapshot } from '../../src/hooks/use-gecko'
import { analytics } from '../../src/lib/analytics'
import { isAuthenticated } from '../../src/lib/auth'
import { formatUsd } from '../../src/lib/format'
import { DOLLAR_DISCLOSURE, friendlyMessage } from '../../src/lib/messages'
import { palette, radius, spacing, styles as s } from '../../src/theme'

function loanSafetyLabel(hf: number | null): string {
  if (hf === null) return 'No loan'
  if (hf > 1.5) return 'Safe'
  if (hf >= 1.1) return 'Watch closely'
  return 'At risk'
}

function healthFactorColor(hf: number): string {
  if (hf > 1.5) return palette.success
  if (hf >= 1.1) return palette.warning
  return palette.danger
}

export default function MoneyScreen() {
  const signedIn = isAuthenticated()
  const { data, isLoading, isError, isRefetching, refetch, error } = useSnapshot(signedIn)
  // Savings and Credit are separate reads that must never block or error out
  // Money — if /earn or /borrow is loading, degraded, or unavailable, this
  // screen simply omits that section rather than showing an error state.
  const earn = useEarn(signedIn)
  const borrow = useBorrow(signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])
  useEffect(() => { analytics.screen('Money') }, [])
  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading your money…" />
  if (isError && !data) {
    return <ErrorState message={`Gecko couldn’t load your money right now. ${friendlyMessage(error)}`} onRetry={refresh} />
  }

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
        <Text style={s.muted}>Your money</Text>
        <Text selectable style={local.total}>{formatUsd(combinedTotal)}</Text>
        {data?.coverage === 'best_effort' ? (
          <Text style={s.muted}>Showing what Gecko can currently see. It won’t guess at anything missing.</Text>
        ) : null}
        <InfoNote detail={DOLLAR_DISCLOSURE} />
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
        {data?.byToken.length === 0 ? <Text style={s.muted}>Nothing to show here yet.</Text> : null}
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
                      <Text style={s.heading}>Savings</Text>
                      <View style={local.apyBadge}><Text style={local.apyBadgeText}>~{p.apy.toFixed(2)}%/yr</Text></View>
                    </View>
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
      {borrow.data && (borrow.data.collateral.length > 0 || borrow.data.borrowed.length > 0) ? (
        <View style={local.section}>
          <Text style={s.heading}>Credit</Text>
          <View style={s.card}>
            <View style={local.row}>
              <Text style={s.muted}>Loan safety</Text>
              <Text selectable style={[local.hf, borrow.data.healthFactor !== null && { color: healthFactorColor(borrow.data.healthFactor) }]}>
                {loanSafetyLabel(borrow.data.healthFactor)}
              </Text>
            </View>
            <Text style={local.hfCaption}>
              This shows how much room your collateral has before a loan could be automatically closed out. “At risk” means act soon — add money or repay part of what you borrowed.
            </Text>
            <View style={local.row}>
              <Text style={s.muted}>Borrowed</Text>
              <Text selectable style={s.body}>{formatUsd(borrow.data.borrowed.reduce((sum, b) => sum + b.balanceUsd, 0))}</Text>
            </View>
            <View style={local.row}>
              <Text style={s.muted}>Available to borrow</Text>
              <Text selectable style={s.body}>{formatUsd(borrow.data.availableToBorrowUsd)}</Text>
            </View>
            {borrow.data.coverage === 'best_effort' ? (
              <Text style={s.muted}>Showing what Gecko can currently see. It won’t guess at anything missing.</Text>
            ) : null}
          </View>
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
  hf: { color: palette.text, fontSize: 16, fontWeight: '700' },
  hfCaption: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
})
