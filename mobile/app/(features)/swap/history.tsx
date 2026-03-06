/**
 * Full swap history screen with status badges, amounts, and chain info.
 */
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Stack } from 'expo-router'
import { useSwapHistory } from '../../../hooks/useSwapHistory'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'
import type { Swap } from '../../../../packages/shared/src/types/api'

const STATUS_COLORS: Record<Swap['status'], string> = {
  pending: colors.warning,
  completed: colors.success,
  failed: colors.error,
  cancelled: colors.textMuted,
}

function SwapRow({ swap }: { swap: Swap }) {
  const statusColor = STATUS_COLORS[swap.status]
  const isCrossChain = swap.fromChain !== swap.toChain
  const date = swap.createdAt ? new Date(swap.createdAt) : null

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7}>
      {/* Direction indicator */}
      <View style={styles.iconWrap}>
        <Text style={styles.iconText}>{isCrossChain ? '⇄' : '↔'}</Text>
      </View>

      {/* Swap details */}
      <View style={styles.info}>
        <View style={styles.pairRow}>
          <Text style={styles.pairText}>
            {swap.fromToken} → {swap.toToken}
          </Text>
          {isCrossChain && (
            <Text style={styles.chainBadge}>
              {swap.fromChain} → {swap.toChain}
            </Text>
          )}
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {swap.status}
          </Text>
          {date && (
            <Text style={styles.dateText}>
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {' '}
              {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      </View>

      {/* Amounts */}
      <View style={styles.amounts}>
        <Text style={styles.fromAmount}>-{swap.fromAmount}</Text>
        {swap.toAmount && (
          <Text style={styles.toAmount}>+{swap.toAmount}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function SwapHistoryScreen() {
  const { data: swaps, isLoading, refetch, isRefetching } = useSwapHistory(50)

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: 'Swap History' }} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Swap History' }} />
      <View style={styles.container}>
        {!swaps?.length ? (
          <EmptyState
            icon="exchange"
            title="No swaps yet"
            subtitle="Your swap history will appear here"
          />
        ) : (
          <FlashList
            data={swaps}
            keyExtractor={(item) => item.id}

            contentContainerStyle={{
              paddingHorizontal: spacing.xxl,
              paddingVertical: spacing.md,
            }}
            renderItem={({ item }) => <SwapRow swap={item} />}
            onRefresh={refetch}
            refreshing={isRefetching}
          />
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 18 },
  info: { flex: 1 },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chainBadge: {
    fontSize: 11,
    color: colors.textTertiary,
    backgroundColor: colors.cardAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  dateText: { fontSize: 11, color: colors.textTertiary, marginLeft: spacing.xs },
  amounts: { alignItems: 'flex-end' },
  fromAmount: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: 'SpaceMono',
  },
  toAmount: {
    fontSize: 14,
    color: colors.success,
    fontFamily: 'SpaceMono',
    marginTop: 2,
  },
})
