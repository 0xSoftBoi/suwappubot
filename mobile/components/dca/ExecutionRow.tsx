/**
 * DCA execution history item.
 */
import { View, Text, StyleSheet } from 'react-native'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { DCAExecution } from '../../../packages/shared/src/types/orders'

interface ExecutionRowProps {
  execution: DCAExecution
}

export default function ExecutionRow({ execution }: ExecutionRowProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.number}>#{execution.executionNumber}</Text>
        <StatusBadge status={execution.status} />
      </View>
      <View style={styles.details}>
        <View style={styles.row}>
          <Text style={styles.label}>Spent</Text>
          <Text style={styles.value}>{execution.fromAmount}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Received</Text>
          <Text style={styles.value}>{execution.toAmount}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Price</Text>
          <Text style={styles.value}>${execution.price.toFixed(4)}</Text>
        </View>
      </View>
      {execution.executedAt && (
        <Text style={styles.date}>
          {new Date(execution.executedAt).toLocaleString()}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  number: { fontSize: 16, fontWeight: '600', color: colors.text },
  details: { marginTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 14, color: colors.textTertiary },
  value: { fontSize: 14, color: colors.text, fontFamily: 'SpaceMono' },
  date: { fontSize: 12, color: colors.textTertiary, marginTop: spacing.sm },
})
