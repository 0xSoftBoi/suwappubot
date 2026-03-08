/**
 * DCA detail screen with execution history.
 */
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams } from 'expo-router'
import { useDCAPlans, useDCAExecutions } from '../../../hooks/useDCA'
import StatusBadge from '../../../components/ui/StatusBadge'
import ExecutionRow from '../../../components/dca/ExecutionRow'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

export default function DCADetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const dcaId = parseInt(id, 10)
  const { data: plans } = useDCAPlans()
  const { data: executions, isLoading } = useDCAExecutions(dcaId)

  const plan = plans?.find(p => p.id === dcaId)

  if (!plan) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Summary card */}
      <View style={styles.summary}>
        <View style={styles.summaryHeader}>
          <Text style={styles.pair}>
            {plan.fromToken} → {plan.toToken}
          </Text>
          <StatusBadge status={plan.status} />
        </View>

        <View style={styles.grid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Per Execution</Text>
            <Text style={styles.statValue}>
              {plan.amountPerExecution} {plan.fromToken}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Interval</Text>
            <Text style={styles.statValue}>{plan.intervalHours}h</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Executions</Text>
            <Text style={styles.statValue}>
              {plan.executionCount}{plan.maxExecutions ? ` / ${plan.maxExecutions}` : ''}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Total Spent</Text>
            <Text style={styles.statValue}>{plan.totalAmountSpent} {plan.fromToken}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Total Received</Text>
            <Text style={styles.statValue}>{plan.totalAmountReceived} {plan.toToken}</Text>
          </View>
          {plan.averagePrice && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Avg Price</Text>
              <Text style={styles.statValue}>${plan.averagePrice.toFixed(4)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Executions */}
      <Text style={styles.sectionTitle}>Execution History</Text>

      {isLoading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 20 }} />
      ) : !executions?.length ? (
        <EmptyState icon="history" title="No executions yet" subtitle="Waiting for the first scheduled execution" />
      ) : (
        <FlashList
          data={executions}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => <ExecutionRow execution={item} />}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  summary: {
    backgroundColor: colors.card,
    margin: spacing.xxl,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  pair: { fontSize: 20, fontWeight: '700', color: colors.text },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stat: { width: '45%' },
  statLabel: { fontSize: 12, color: colors.textTertiary },
  statValue: { fontSize: 15, color: colors.text, fontWeight: '500', fontFamily: 'SpaceMono' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.sm,
  },
})
