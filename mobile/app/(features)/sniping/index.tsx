/**
 * Sniping dashboard — active and history.
 */
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useSnipeOrders, useCancelSnipeOrder } from '../../../hooks/useSniping'
import SnipeOrderCard from '../../../components/sniping/SnipeOrderCard'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

type Filter = 'active' | 'history'

export default function SnipingScreen() {
  const router = useRouter()
  const { data: orders, isLoading } = useSnipeOrders()
  const cancelMutation = useCancelSnipeOrder()
  const [filter, setFilter] = useState<Filter>('active')

  const filtered = useMemo(() => {
    if (!orders) return []
    if (filter === 'active') {
      return orders.filter(o => ['pending', 'watching', 'executing'].includes(o.status))
    }
    return orders.filter(o => ['executed', 'failed', 'cancelled'].includes(o.status))
  }, [orders, filter])

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
        <TouchableOpacity
          style={[styles.segment, filter === 'active' && styles.segmentActive]}
          onPress={() => setFilter('active')}
        >
          <Text style={[styles.segmentText, filter === 'active' && styles.segmentTextActive]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, filter === 'history' && styles.segmentActive]}
          onPress={() => setFilter('history')}
        >
          <Text style={[styles.segmentText, filter === 'history' && styles.segmentTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.createButton}
        onPress={() => router.push('/(features)/sniping/create' as any)}
      >
        <FontAwesome name="plus" size={14} color={colors.bg} />
        <Text style={styles.createText}>New Snipe</Text>
      </TouchableOpacity>

      {filtered.length === 0 ? (
        <EmptyState
          icon="crosshairs"
          title={filter === 'active' ? 'No active snipes' : 'No snipe history'}
          subtitle="Snipe new token launches on Solana with MEV protection"
          ctaLabel="Create Snipe"
          onPress={() => router.push('/(features)/sniping/create' as any)}
        />
      ) : (
        <FlashList
          data={filtered}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <SnipeOrderCard order={item} onCancel={id => cancelMutation.mutate(id)} />
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
  createText: { color: colors.bg, fontSize: 15, fontWeight: '600' },
})
