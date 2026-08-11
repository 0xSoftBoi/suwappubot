import { useCallback } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ErrorState, LegalLinks, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useEarn, useSnapshot } from '../../src/hooks/use-gecko'
import { isAuthenticated } from '../../src/lib/auth'
import { formatDate, formatUsd, snapshotChange } from '../../src/lib/format'
import { palette, radius, spacing, styles as s } from '../../src/theme'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export default function TodayScreen() {
  const signedIn = isAuthenticated()
  const router = useRouter()
  const { data, isLoading, isError, isRefetching, refetch } = useSnapshot(signedIn)
  // Read-only and purely additive to this screen — if /earn is loading or
  // errored, earn.data stays undefined and the card below just doesn't
  // render. Today's own loading/error gates above are untouched by this.
  const earn = useEarn(signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])

  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Reading your money…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your money." onRetry={refresh} />

  const change = data?.coverage === 'complete'
    ? snapshotChange(data.history, data.totalValueUsd)
    : null
  const top = data?.byToken[0]

  const earnPositions = earn.data?.positions ?? []
  const hasSavings = earnPositions.length > 0
  const dailyEarnings = earnPositions.reduce((sum, p) => sum + (p.balanceUsd * p.apy) / 100 / 365, 0)
  const earnApy = earn.data?.apy ?? earnPositions[0]?.apy ?? 0

  return (
    <ScrollView
      style={s.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={palette.accent} />}
    >
      <View style={local.intro}>
        <Text style={s.title}>{greeting()}</Text>
        <Text style={local.lede}>Here’s what matters in your money right now.</Text>
      </View>

      <View style={s.card}>
        <Text style={s.muted}>Money I can price</Text>
        <Text selectable style={local.total}>{formatUsd(data?.totalValueUsd ?? 0)}</Text>
        {data ? <Text style={s.muted}>Updated {formatDate(data.lastUpdated)}</Text> : null}
      </View>

      <View style={local.actions}>
        <Pressable onPress={() => router.push('/send')} style={local.actionButton}>
          <Text style={local.actionText}>Send</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/receive')} style={local.actionButtonSecondary}>
          <Text style={local.actionTextSecondary}>Receive</Text>
        </Pressable>
      </View>

      {hasSavings ? (
        <Pressable
          onPress={() => router.push('/earn')}
          accessibilityRole="button"
          accessibilityLabel="Open Earn"
          style={local.earnCard}
        >
          <Text selectable style={local.earnText}>
            Earning ~{formatUsd(dailyEarnings)}/day · {earnApy.toFixed(2)}% APY
          </Text>
          <Text style={local.earnChevron}>›</Text>
        </Pressable>
      ) : null}

      <Text style={s.heading}>Quick read</Text>
      <View style={local.stack}>
        <View style={s.card}>
          <Text style={s.muted}>Change</Text>
          <Text selectable style={s.body}>
            {change
              ? `${change.delta >= 0 ? 'Up' : 'Down'} ${formatUsd(Math.abs(change.delta))} (${Math.abs(change.percent).toFixed(1)}%) since ${formatDate(change.since)}`
              : data?.coverage === 'best_effort'
                ? 'I’m withholding gain/loss until I can verify complete source coverage.'
                : 'History is still building. I’ll compare changes when there’s enough real data.'}
          </Text>
        </View>
        <View style={s.card}>
          <Text style={s.muted}>Concentration</Text>
          <Text selectable style={s.body}>
            {top
              ? `${top.symbol} is your largest holding at ${top.allocationPct.toFixed(1)}% of the money I can price.`
              : 'No priced holdings are available yet.'}
          </Text>
        </View>
      </View>
      {isError && data ? <Text selectable style={local.stale}>Offline for now — showing your last saved snapshot.</Text> : null}
      <LegalLinks />
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  intro: { gap: spacing.xs },
  lede: { color: palette.textSecondary, fontSize: 17, lineHeight: 24 },
  total: { color: palette.text, fontSize: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stack: { gap: spacing.sm },
  stale: { color: palette.textMuted, fontSize: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionButton: { flex: 1, alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  actionButtonSecondary: { flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: spacing.md },
  actionText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  actionTextSecondary: { color: palette.text, fontSize: 15, fontWeight: '700' },
  earnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  earnText: { color: palette.text, fontSize: 14, fontWeight: '600', flex: 1 },
  earnChevron: { color: palette.textMuted, fontSize: 18, fontWeight: '700' },
})
