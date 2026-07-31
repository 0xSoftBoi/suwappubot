/**
 * Activity tab — swap history.
 *
 * FlashList + a memoised row: the same rationale as TokenList. History can
 * grow large over a user's lifetime, and status polling elsewhere in the app
 * should not cause this list to re-render rows that haven't changed.
 */
import { memo, useCallback } from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSwaps } from '../../src/hooks/useSuwappu'
import { palette, spacing, styles as s } from '../../src/theme'
import type { Swap, SwapStatus } from '../../src/types/api'

const ROW_HEIGHT = 72

function statusColor(status: SwapStatus): string {
  switch (status) {
    case 'completed':
      return palette.success
    case 'failed':
    case 'cancelled':
      return palette.danger
    default:
      return palette.textMuted
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface RowProps {
  swap: Swap
}

function SwapRowBase({ swap }: RowProps) {
  return (
    <View style={local.row}>
      <View style={local.labels}>
        <Text style={s.heading} numberOfLines={1}>
          {swap.fromToken} → {swap.toToken}
        </Text>
        <Text style={s.muted} numberOfLines={1}>
          {swap.fromChain} → {swap.toChain} · {relativeTime(swap.createdAt)}
        </Text>
      </View>
      <View style={local.values}>
        <Text style={s.body}>{swap.fromAmount}</Text>
        <Text style={[local.status, { color: statusColor(swap.status) }]}>{swap.status}</Text>
      </View>
    </View>
  )
}

const SwapRow = memo(SwapRowBase, (prev, next) => {
  const a = prev.swap
  const b = next.swap
  return a.id === b.id && a.status === b.status && a.toAmount === b.toAmount
})

const Separator = () => <View style={local.separator} />

const Empty = () => (
  <View style={local.empty}>
    <Text style={s.muted}>No swaps yet.</Text>
  </View>
)

export default function ActivityScreen() {
  const { data, isRefetching, refetch } = useSwaps(20, 0)

  const renderItem = useCallback(({ item }: { item: Swap }) => <SwapRow swap={item} />, [])
  const keyExtractor = useCallback((item: Swap) => item.id, [])
  const handleRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return (
    <View style={s.screen}>
      <View style={local.header}>
        <Text style={s.title}>Activity</Text>
      </View>
      <FlashList
        data={data ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={ROW_HEIGHT}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={Empty}
        contentContainerStyle={local.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={palette.accent} />
        }
      />
    </View>
  )
}

const local = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labels: { flex: 1, gap: 2 },
  values: { alignItems: 'flex-end', gap: 2 },
  status: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  separator: { height: spacing.xs },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' },
})
