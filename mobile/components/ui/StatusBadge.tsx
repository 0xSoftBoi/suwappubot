/**
 * Colored status badge for orders, alerts, DCA plans, etc.
 */
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

type Status =
  | 'active'
  | 'pending'
  | 'triggered'
  | 'executed'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'paused'
  | 'watching'
  | 'executing'

const statusColors: Record<Status, string> = {
  active: colors.statusActive,
  pending: colors.statusPending,
  triggered: colors.statusTriggered,
  executed: colors.statusExecuted,
  completed: colors.statusCompleted,
  cancelled: colors.statusCancelled,
  expired: colors.statusCancelled,
  failed: colors.statusFailed,
  paused: colors.statusPaused,
  watching: colors.statusTriggered,
  executing: colors.statusPending,
}

interface StatusBadgeProps {
  status: string
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const key = status.toLowerCase() as Status
  const color = statusColors[key] || colors.textTertiary

  return (
    <View style={[styles.badge, { backgroundColor: color + '20' }]}>
      <Text style={[styles.text, { color }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
})
