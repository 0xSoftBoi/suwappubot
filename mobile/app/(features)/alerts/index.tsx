/**
 * Alerts list with Active / Triggered / All segments.
 */
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'
import { useAlerts, useToggleAlert, useDeleteAlert } from '../../../hooks/useAlerts'
import AlertRow from '../../../components/alerts/AlertRow'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

type Filter = 'active' | 'triggered' | 'all'

export default function AlertsScreen() {
  const router = useRouter()
  const { data: alerts, isLoading } = useAlerts()
  const toggleMutation = useToggleAlert()
  const deleteMutation = useDeleteAlert()
  const [filter, setFilter] = useState<Filter>('active')

  const handleToggle = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    toggleMutation.mutate(id)
  }

  const handleDelete = (id: number) => {
    Alert.alert('Delete Alert', 'Are you sure you want to delete this alert?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          deleteMutation.mutate(id)
        },
      },
    ])
  }

  const filtered = useMemo(() => {
    if (!alerts) return []
    switch (filter) {
      case 'active':
        return alerts.filter(a => a.isActive && !a.isTriggered)
      case 'triggered':
        return alerts.filter(a => a.isTriggered)
      default:
        return alerts
    }
  }, [alerts, filter])

  const segments: { key: Filter; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'triggered', label: 'Triggered' },
    { key: 'all', label: 'All' },
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
      {/* Segment control */}
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

      {/* Create button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          router.push('/(features)/alerts/create' as any)
        }}
      >
        <FontAwesome name="plus" size={14} color={colors.bg} />
        <Text style={styles.createText}>New Alert</Text>
      </TouchableOpacity>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="bell-o"
          title="No alerts"
          subtitle="Create a price alert to get notified when tokens hit your target"
          ctaLabel="Create Alert"
          onPress={() => router.push('/(features)/alerts/create' as any)}
        />
      ) : (
        <FlashList
          data={filtered}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <AlertRow
              alert={item}
              onToggle={handleToggle}
              onDelete={handleDelete}
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
