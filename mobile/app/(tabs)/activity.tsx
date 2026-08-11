import { memo, useCallback, useEffect } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useActivity } from '../../src/hooks/use-gecko'
import { analytics } from '../../src/lib/analytics'
import { isAuthenticated } from '../../src/lib/auth'
import { relativeTime } from '../../src/lib/format'
import { friendlyMessage } from '../../src/lib/messages'
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
  const router = useRouter()
  const { data, isLoading, isError, isRefetching, refetch, error } = useActivity(20, 0, signedIn)
  const refresh = useCallback(() => void refetch(), [refetch])
  const renderItem = useCallback(({ item }: { item: ActivityEntry }) => <ActivityRow item={item} />, [])
  const keyExtractor = useCallback((item: ActivityEntry) => item.id, [])

  useEffect(() => { analytics.screen('Activity') }, [])

  const isEmpty = data !== undefined && data.length === 0
  useEffect(() => {
    if (isEmpty) analytics.track('empty_state_seen', { screen: 'activity' })
  }, [isEmpty])

  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading activity…" />
  if (isError && !data) {
    return <ErrorState message={`Gecko couldn’t load your activity right now. ${friendlyMessage(error)}`} onRetry={refresh} />
  }

  return (
    <FlashList
      style={s.screen}
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={local.content}
      ListHeaderComponent={
        <Pressable
          onPress={() => router.push('/statement')}
          accessibilityRole="button"
          accessibilityLabel="Open monthly statement"
          style={local.statementLink}
        >
          <Text style={local.statementLinkText}>Monthly statement</Text>
          <Text style={local.statementChevron}>›</Text>
        </Pressable>
      }
      ListEmptyComponent={
        <View style={local.empty}>
          <Text selectable style={local.emptyCopy}>Nothing here yet. Send or add money to see it show up.</Text>
          <Pressable
            onPress={() => router.push('/send')}
            accessibilityRole="button"
            accessibilityLabel="Send money"
            style={local.emptyButton}
          >
            <Text style={local.emptyButtonText}>Send money</Text>
          </Pressable>
        </View>
      }
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
  empty: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md },
  emptyCopy: { color: palette.textSecondary, fontSize: 16, lineHeight: 22, textAlign: 'center', paddingHorizontal: spacing.lg },
  emptyButton: { minHeight: 44, justifyContent: 'center', backgroundColor: palette.accent, borderRadius: 12, paddingHorizontal: spacing.lg },
  emptyButtonText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  statementLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, marginBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  statementLinkText: { color: palette.text, fontSize: 16, fontWeight: '600' },
  statementChevron: { color: palette.textMuted, fontSize: 18, fontWeight: '700' },
})
