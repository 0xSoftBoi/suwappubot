/**
 * Points transaction history.
 */
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { usePointsHistory } from '../../../hooks/usePoints'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'
import type { PointTransaction } from '../../../../packages/shared/src/types/points'

function HistoryRow({ txn }: { txn: PointTransaction }) {
  const isPositive = txn.amount > 0

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.reason}>{txn.reason}</Text>
        <Text style={styles.date}>
          {txn.createdAt ? new Date(txn.createdAt).toLocaleString() : ''}
        </Text>
      </View>
      <Text style={[styles.amount, isPositive ? styles.positive : styles.negative]}>
        {isPositive ? '+' : ''}{txn.amount}
      </Text>
    </View>
  )
}

export default function PointsHistoryScreen() {
  const { data: history, isLoading } = usePointsHistory(100)

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  if (!history?.length) {
    return <EmptyState icon="history" title="No history" subtitle="Points transactions will appear here" />
  }

  return (
    <View style={styles.container}>
      <FlashList
        data={history}
        contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingVertical: spacing.md }}
        renderItem={({ item }) => <HistoryRow txn={item} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  info: { flex: 1 },
  reason: { fontSize: 15, color: colors.text },
  date: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '600', fontFamily: 'SpaceMono' },
  positive: { color: colors.success },
  negative: { color: colors.error },
})
