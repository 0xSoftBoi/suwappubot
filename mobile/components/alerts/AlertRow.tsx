/**
 * Alert list item with toggle switch.
 */
import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native'
import StatusBadge from '../ui/StatusBadge'
import { colors, spacing, radius } from '../../lib/theme'
import type { PriceAlert } from '../../../packages/shared/src/types/alerts'

interface AlertRowProps {
  alert: PriceAlert
  onToggle: (id: number) => void
  onDelete: (id: number) => void
}

export default function AlertRow({ alert, onToggle, onDelete }: AlertRowProps) {
  const typeLabel = alert.alertType === 'price_above'
    ? 'Above'
    : alert.alertType === 'price_below'
    ? 'Below'
    : 'Change'

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.tokenInfo}>
          <Text style={styles.symbol}>{alert.tokenSymbol}</Text>
          <Text style={styles.chain}>{alert.chain}</Text>
        </View>
        {alert.isTriggered ? (
          <StatusBadge status="triggered" />
        ) : (
          <Switch
            value={alert.isActive}
            onValueChange={() => onToggle(alert.id)}
            trackColor={{ false: colors.borderLight, true: colors.primary }}
          />
        )}
      </View>

      <View style={styles.details}>
        <Text style={styles.condition}>
          {typeLabel}: {alert.targetPrice ? `$${alert.targetPrice.toLocaleString()}` : `${alert.percentChange}%`}
        </Text>
        {alert.currentPrice && (
          <Text style={styles.current}>Current: ${alert.currentPrice.toLocaleString()}</Text>
        )}
      </View>

      {alert.isTriggered && alert.triggeredPrice && (
        <Text style={styles.triggered}>
          Triggered at ${alert.triggeredPrice.toLocaleString()}
        </Text>
      )}

      <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(alert.id)}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
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
  tokenInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  symbol: { fontSize: 17, fontWeight: '600', color: colors.text },
  chain: { fontSize: 13, color: colors.textTertiary },
  details: { marginTop: spacing.sm },
  condition: { fontSize: 15, color: colors.textSecondary },
  current: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },
  triggered: { fontSize: 13, color: colors.statusTriggered, marginTop: spacing.sm },
  deleteButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  deleteText: { fontSize: 13, color: colors.error, fontWeight: '500' },
})
