import { memo, useCallback } from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useActivity } from '../../src/hooks/use-gecko'
import { isAuthenticated } from '../../src/lib/auth'
import { relativeTime } from '../../src/lib/format'
import { palette, spacing, styles as s } from '../../src/theme'
import type { ActivityEntry } from '../../src/types/api'

const ROW_HEIGHT = 76

function ActivityRowBase({ item }: { item: ActivityEntry }) {
  const color = item.status === 'failed' || item.status === 'cancelled'
    ? palette.danger
    : item.status === 'completed' ? palette.success : palette.textMuted
  return (
    <View style={local.row}>
      <View style={local.labels}>
        <Text style={s.heading} numberOfLines={1}>{item.fromToken} → {item.toToken}</Text>
        <Text style={s.muted}>{relativeTime(item.createdAt)}</Text>
      </View>
      <View style={local.values}>
        <Text selectable style={s.body}>{item.fromAmount}</Text>
        <Text style={[local.status, { color }]}>{item.status}</Text>
      </View>
    </View>
  )
}
const ActivityRow = memo(ActivityRowBase, (a, b) => a.item.id === b.item.id && a.item.status === b.item.status)

export default function ActivityScreen() {
  const signedIn = isAuthenticated()
  const { data, isLoading, isError, isRefetching, refetch } = useActivity(20, 0, signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])
  const renderItem = useCallback(({ item }: { item: ActivityEntry }) => <ActivityRow item={item} />, [])
  const keyExtractor = useCallback((item: ActivityEntry) => item.id, [])

  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading activity…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your activity." onRetry={refresh} />

  return (
    <FlashList
      style={s.screen}
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={local.content}
      ListEmptyComponent={<View style={local.empty}><Text style={s.muted}>Nothing here yet.</Text></View>}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={palette.accent} />}
    />
  )
}

const local = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  labels: { flex: 1, gap: 2 },
  values: { alignItems: 'flex-end', gap: 2 },
  status: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' },
})
