/**
 * DCA plans list with Active / Paused / Completed segments.
 */
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useDCAPlans, usePauseDCA, useResumeDCA, useCancelDCA } from '../../../hooks/useDCA'
import DCACard from '../../../components/dca/DCACard'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

type Filter = 'active' | 'paused' | 'completed' | 'all'

export default function DCAScreen() {
  const router = useRouter()
  const { data: plans, isLoading } = useDCAPlans()
  const pauseMutation = usePauseDCA()
  const resumeMutation = useResumeDCA()
  const cancelMutation = useCancelDCA()
  const [filter, setFilter] = useState<Filter>('active')

  const filtered = useMemo(() => {
    if (!plans) return []
    if (filter === 'all') return plans
    return plans.filter(p => p.status === filter)
  }, [plans, filter])

  const segments: { key: Filter; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'paused', label: 'Paused' },
    { key: 'completed', label: 'Done' },
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
            onPress={() => setFilter(s.key)}
          >
            <Text style={[styles.segmentText, filter === s.key && styles.segmentTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.createButton}
        onPress={() => router.push('/(features)/dca/create' as any)}
      >
        <FontAwesome name="plus" size={14} color={colors.bg} />
        <Text style={styles.createText}>New DCA Plan</Text>
      </TouchableOpacity>

      {filtered.length === 0 ? (
        <EmptyState
          icon="refresh"
          title="No DCA plans"
          subtitle="Dollar-cost average into any token on a schedule"
          ctaLabel="Create DCA Plan"
          onPress={() => router.push('/(features)/dca/create' as any)}
        />
      ) : (
        <FlashList
          data={filtered}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <DCACard
              plan={item}
              onPause={id => pauseMutation.mutate(id)}
              onResume={id => resumeMutation.mutate(id)}
              onCancel={id => cancelMutation.mutate(id)}
            />
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
