/**
 * Order list item with cancel action.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { LimitOrder } from '../../../packages/shared/src/types/orders'

interface OrderRowProps {
  order: LimitOrder
  onCancel: (id: number) => void
}

export default function OrderRow({ order, onCancel }: OrderRowProps) {
  const typeLabel = order.orderType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
  const isPending = order.status === 'pending'

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.type}>{typeLabel}</Text>
          <Text style={styles.pair}>
            {order.fromToken} → {order.toToken}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Amount</Text>
          <Text style={styles.detailValue}>{order.amount} {order.fromToken}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Trigger</Text>
          <Text style={styles.detailValue}>${order.triggerPrice.toLocaleString()}</Text>
        </View>
        {order.expiresAt && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Expires</Text>
            <Text style={styles.detailValue}>
              {new Date(order.expiresAt).toLocaleDateString()}
            </Text>
          </View>
        )}
      </View>

      {isPending && (
        <TouchableOpacity style={styles.cancelButton} onPress={() => onCancel(order.id)}>
          <Text style={styles.cancelText}>Cancel Order</Text>
        </TouchableOpacity>
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
    alignItems: 'flex-start',
  },
  type: { fontSize: 16, fontWeight: '600', color: colors.text },
  pair: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  details: { marginTop: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 14, color: colors.textTertiary },
  detailValue: { fontSize: 14, color: colors.text, fontFamily: 'SpaceMono' },
  cancelButton: {
    marginTop: spacing.md,
    backgroundColor: colors.error + '15',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14, color: colors.error, fontWeight: '500' },
})
