/**
 * Copy trade list item.
 */
import { View, Text, StyleSheet } from 'react-native'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { CopyTrade } from '../../../packages/shared/src/types/copy-trading'

interface CopyTradeRowProps {
  trade: CopyTrade
}

export default function CopyTradeRow({ trade }: CopyTradeRowProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.pair}>
            {trade.fromToken} → {trade.toToken}
          </Text>
          <Text style={styles.trader}>by {trade.traderName || `Trader #${trade.traderId}`}</Text>
        </View>
        <StatusBadge status={trade.status} />
      </View>
      <View style={styles.details}>
        <Text style={styles.amount}>{trade.fromAmount} {trade.fromToken}</Text>
        {trade.pnl !== undefined && trade.pnl !== null && (
          <Text style={[styles.pnl, trade.pnl >= 0 ? styles.positive : styles.negative]}>
            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}%
          </Text>
        )}
      </View>
      {trade.createdAt && (
        <Text style={styles.date}>{new Date(trade.createdAt).toLocaleString()}</Text>
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
  pair: { fontSize: 16, fontWeight: '600', color: colors.text },
  trader: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  amount: { fontSize: 14, color: colors.textSecondary, fontFamily: 'SpaceMono' },
  pnl: { fontSize: 14, fontWeight: '600', fontFamily: 'SpaceMono' },
  positive: { color: colors.success },
  negative: { color: colors.error },
  date: { fontSize: 12, color: colors.textTertiary, marginTop: spacing.sm },
})
