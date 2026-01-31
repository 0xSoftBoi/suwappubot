/**
 * Snipe order card — shows order details and status.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { SnipeOrder } from '../../../packages/shared/src/types/sniping'

interface SnipeOrderCardProps {
  order: SnipeOrder
  onCancel?: (id: number) => void
}

export default function SnipeOrderCard({ order, onCancel }: SnipeOrderCardProps) {
  const canCancel = order.status === 'pending' || order.status === 'watching'

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.token}>
            {order.tokenSymbol || order.tokenAddress?.slice(0, 8) || 'Any Token'}
          </Text>
          <Text style={styles.platform}>{order.platform} / {order.mode}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Amount</Text>
          <Text style={styles.detailValue}>{order.amountSol} SOL</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Slippage</Text>
          <Text style={styles.detailValue}>{(order.slippage / 100).toFixed(0)}%</Text>
        </View>
        {order.useMevProtection && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>MEV Protection</Text>
            <Text style={[styles.detailValue, { color: colors.success }]}>On</Text>
          </View>
        )}
        {order.tokensReceived && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Received</Text>
            <Text style={styles.detailValue}>{order.tokensReceived}</Text>
          </View>
        )}
      </View>

      {canCancel && onCancel && (
        <TouchableOpacity style={styles.cancelBtn} onPress={() => onCancel(order.id)}>
          <Text style={styles.cancelText}>Cancel</Text>
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
  token: { fontSize: 17, fontWeight: '600', color: colors.text },
  platform: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  details: { marginTop: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 14, color: colors.textTertiary },
  detailValue: { fontSize: 14, color: colors.text, fontFamily: 'SpaceMono' },
  cancelBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.error + '15',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14, color: colors.error, fontWeight: '500' },
})
