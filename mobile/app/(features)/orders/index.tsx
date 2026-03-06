/**
 * Orders list with Pending / Executed / Cancelled segments.
 */
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'
import { useOrders, useCancelOrder } from '../../../hooks/useOrders'
import OrderRow from '../../../components/orders/OrderRow'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

type Filter = 'pending' | 'executed' | 'cancelled' | 'all'

export default function OrdersScreen() {
  const router = useRouter()
  const { data: orders, isLoading } = useOrders()
  const cancelMutation = useCancelOrder()
  const [filter, setFilter] = useState<Filter>('pending')

  const handleCancel = (id: number) => {
    Alert.alert('Cancel Order', 'Are you sure you want to cancel this order?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Order',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          cancelMutation.mutate(id)
        },
      },
    ])
  }

  const filtered = useMemo(() => {
    if (!orders) return []
    if (filter === 'all') return orders
    return orders.filter(o => o.status === filter)
  }, [orders, filter])

  const segments: { key: Filter; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'executed', label: 'Executed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.segments}>
        {segments.map(s => (
          <TouchableOpacity
            key={s.key}
            style={[styles.segment, filter === s.key && styles.segmentActive]}
            onPress={() => { setFilter(s.key); Haptics.selectionAsync() }}
          >
            <Text style={[styles.segmentText, filter === s.key && styles.segmentTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.createButton}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          router.push('/(features)/orders/create' as any)
        }}
      >
        <FontAwesome name="plus" size={14} color={colors.bg} />
        <Text style={styles.createText}>New Order</Text>
      </TouchableOpacity>

      {filtered.length === 0 ? (
        <EmptyState
          icon="line-chart"
          title="No orders"
          subtitle="Create a limit order to buy or sell at your target price"
          ctaLabel="Create Order"
          onPress={() => router.push('/(features)/orders/create' as any)}
        />
      ) : (
        <FlashList
          data={filtered}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <OrderRow order={item} onCancel={handleCancel} />
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  segments: {
    flexDirection: 'row',
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.cardAlt },
  segmentText: { fontSize: 14, color: colors.textTertiary, fontWeight: '500' },
  segmentTextActive: { color: colors.text },
  createButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  createText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
