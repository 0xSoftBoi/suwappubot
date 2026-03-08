/**
 * DCA plan card with progress indicator.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { DCAOrder } from '../../../packages/shared/src/types/orders'

interface DCACardProps {
  plan: DCAOrder
  onPause?: (id: number) => void
  onResume?: (id: number) => void
  onCancel?: (id: number) => void
}

export default function DCACard({ plan, onPause, onResume, onCancel }: DCACardProps) {
  const router = useRouter()
  const progress = plan.maxExecutions
    ? plan.executionCount / plan.maxExecutions
    : null

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push(`/(features)/dca/${plan.id}` as any)}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.pair}>
            {plan.fromToken} → {plan.toToken}
          </Text>
          <Text style={styles.chain}>{plan.fromChain}</Text>
        </View>
        <StatusBadge status={plan.status} />
      </View>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Per Execution</Text>
          <Text style={styles.detailValue}>{plan.amountPerExecution} {plan.fromToken}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Interval</Text>
          <Text style={styles.detailValue}>{plan.intervalHours}h</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Executions</Text>
          <Text style={styles.detailValue}>
            {plan.executionCount}{plan.maxExecutions ? ` / ${plan.maxExecutions}` : ''}
          </Text>
        </View>
        {plan.averagePrice && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Avg Price</Text>
            <Text style={styles.detailValue}>${plan.averagePrice.toFixed(4)}</Text>
          </View>
        )}
      </View>

      {progress !== null && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      )}

      {plan.status === 'active' || plan.status === 'paused' ? (
        <View style={styles.actions}>
          {plan.status === 'active' && onPause && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onPause(plan.id)}>
              <Text style={styles.actionText}>Pause</Text>
            </TouchableOpacity>
          )}
          {plan.status === 'paused' && onResume && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onResume(plan.id)}>
              <Text style={[styles.actionText, { color: colors.success }]}>Resume</Text>
            </TouchableOpacity>
          )}
          {onCancel && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onCancel(plan.id)}>
              <Text style={[styles.actionText, { color: colors.error }]}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
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
    alignItems: 'flex-start',
  },
  pair: { fontSize: 17, fontWeight: '600', color: colors.text },
  chain: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  details: { marginTop: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 14, color: colors.textTertiary },
  detailValue: { fontSize: 14, color: colors.text, fontFamily: 'SpaceMono' },
  progressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionText: { fontSize: 13, fontWeight: '500', color: colors.text },
})
