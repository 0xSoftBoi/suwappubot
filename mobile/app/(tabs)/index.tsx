/**
 * Portfolio tab — the app's home screen.
 *
 * Cache-first UX: if we have `data` (even stale, even alongside a background
 * error) we show it immediately. A blank "error" screen when the user has a
 * perfectly good cached balance from 30 seconds ago is a worse experience
 * than a small stale banner.
 */
import { useCallback } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { TokenList } from '../../src/components/TokenList'
import { usePortfolio } from '../../src/hooks/useSuwappu'
import { palette, spacing, styles as s } from '../../src/theme'

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function formatUpdated(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function PortfolioScreen() {
  const { data, isLoading, isRefetching, isError, refetch } = usePortfolio()

  const handleRetry = useCallback(() => {
    void refetch()
  }, [refetch])

  const header = (
    <View style={local.header}>
      <View style={s.card}>
        <Text style={s.muted}>Total balance</Text>
        <Text style={local.totalValue}>{formatUsd(data?.totalUsdValue ?? 0)}</Text>
        {data ? <Text style={s.muted}>{formatUpdated(data.lastUpdated)}</Text> : null}
      </View>
      {isError && data ? (
        <View style={local.staleBanner}>
          <Text style={local.staleText}>Showing cached data — pull to refresh</Text>
        </View>
      ) : null}
    </View>
  )

  if (isLoading && !data) {
    return (
      <View style={[s.screen, local.centered]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    )
  }

  if (isError && !data) {
    return (
      <View style={[s.screen, local.centered]}>
        <Text style={s.body}>Couldn&apos;t load your portfolio.</Text>
        <Text onPress={handleRetry} style={local.retry}>
          Tap to retry
        </Text>
      </View>
    )
  }

  return (
    <View style={s.screen}>
      <TokenList
        tokens={data?.tokens ?? []}
        refreshing={isRefetching}
        onRefresh={handleRetry}
        ListHeaderComponent={header}
      />
    </View>
  )
}

const local = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  header: { paddingTop: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
  totalValue: { color: palette.text, fontSize: 34, fontWeight: '700' },
  staleBanner: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  staleText: { color: palette.textMuted, fontSize: 12 },
  retry: { color: palette.accent, fontSize: 15, fontWeight: '600' },
})
