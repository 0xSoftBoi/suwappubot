import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { EmptyAction, ErrorState, LoadingState, SignedOutState } from '../src/components/screen-state'
import { useStatement } from '../src/hooks/use-gecko'
import { analytics } from '../src/lib/analytics'
import { isAuthenticated } from '../src/lib/auth'
import { formatUsd } from '../src/lib/format'
import { friendlyMessage } from '../src/lib/messages'
import { palette, spacing, styles as s } from '../src/theme'
import type { StatementTransaction } from '../src/types/api'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  return { year: Number(month.slice(0, 4)), monthIndex: Number(month.slice(5, 7)) - 1 }
}

function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month)
  const date = new Date(Date.UTC(year, monthIndex + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const { year, monthIndex } = parseMonth(month)
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

function receiptLabel(hash: string): string {
  if (hash.length <= 14) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

function tone(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('deposit') || t.includes('yield') || t.includes('receive')) return palette.success
  if (t.includes('withdraw') || t.includes('send')) return palette.textSecondary
  return palette.text
}

/** Plain-language label for a transaction type, replacing raw backend
 * type strings (deposit/withdraw/yield/…) with the vocabulary used
 * elsewhere in the app. */
function typeLabel(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('deposit')) return 'Added to Savings'
  if (t.includes('withdraw')) return 'Moved out of Savings'
  if (t.includes('yield')) return 'Earned'
  if (t.includes('receive')) return 'Received'
  if (t.includes('send')) return 'Sent'
  if (t.includes('swap')) return 'Swapped'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function groupByDay(transactions: StatementTransaction[]): { key: string; label: string; items: StatementTransaction[] }[] {
  const groups = new Map<string, StatementTransaction[]>()
  for (const tx of transactions) {
    const key = dayKey(tx.date)
    const bucket = groups.get(key)
    if (bucket) bucket.push(tx)
    else groups.set(key, [tx])
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({ key, label: dayLabel(items[0]?.date ?? key), items }))
}

export default function StatementScreen() {
  const signedIn = isAuthenticated()
  const router = useRouter()
  const [month, setMonth] = useState(currentMonth())
  const statement = useStatement(month, signedIn)

  const isCurrentOrFuture = month >= currentMonth()
  const goPrev = useCallback(() => {
    analytics.track('statement_month_changed', { direction: 'prev' })
    setMonth((m) => shiftMonth(m, -1))
  }, [])
  const goNext = useCallback(() => {
    if (isCurrentOrFuture) return
    analytics.track('statement_month_changed', { direction: 'next' })
    setMonth((m) => shiftMonth(m, 1))
  }, [isCurrentOrFuture])

  const groups = useMemo(() => groupByDay(statement.data?.transactions ?? []), [statement.data])

  useEffect(() => { analytics.screen('Statement') }, [])

  const isEmpty = statement.data !== undefined && groups.length === 0
  useEffect(() => {
    if (isEmpty) analytics.track('empty_state_seen', { screen: 'statement' })
  }, [isEmpty])

  if (!signedIn) return <SignedOutState />

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      <View style={local.monthRow}>
        <Pressable onPress={goPrev} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={12} style={local.chevron}>
          <Text style={local.chevronText}>‹</Text>
        </Pressable>
        <Text style={s.heading}>{monthLabel(month)}</Text>
        <Pressable
          onPress={goNext}
          disabled={isCurrentOrFuture}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={12}
          style={[local.chevron, isCurrentOrFuture && local.chevronDisabled]}
        >
          <Text style={local.chevronText}>›</Text>
        </Pressable>
      </View>

      {statement.isLoading && !statement.data ? <LoadingState label="Loading your statement…" /> : null}
      {statement.isError && !statement.data ? (
        <ErrorState
          message={`Gecko couldn’t load this statement right now. ${friendlyMessage(statement.error)}`}
          onRetry={() => void statement.refetch()}
        />
      ) : null}

      {statement.data ? (
        <>
          <View style={local.summaryGrid}>
            <View style={[s.card, local.summaryCard]}>
              <Text style={s.muted}>Earned from Savings</Text>
              <Text selectable style={local.summaryValue}>{formatUsd(statement.data.yieldEarnedUsd)}</Text>
            </View>
            <View style={[s.card, local.summaryCard]}>
              <Text style={s.muted}>Added to Savings</Text>
              <Text selectable style={local.summaryValue}>{formatUsd(statement.data.depositedUsd)}</Text>
            </View>
            <View style={[s.card, local.summaryCard]}>
              <Text style={s.muted}>Moved out of Savings</Text>
              <Text selectable style={local.summaryValue}>{formatUsd(statement.data.withdrawnUsd)}</Text>
            </View>
            <View style={[s.card, local.summaryCard]}>
              <Text style={s.muted}>Sent</Text>
              <Text selectable style={local.summaryValue}>{formatUsd(statement.data.sentUsd)}</Text>
            </View>
            <View style={[s.card, local.summaryCard]}>
              <Text style={s.muted}>Traded</Text>
              <Text selectable style={local.summaryValue}>{formatUsd(statement.data.swapVolumeUsd)}</Text>
            </View>
          </View>

          {groups.length === 0 ? (
            <EmptyAction
              title="Nothing happened this month"
              body={`No activity in ${monthLabel(month)}. Add money to start earning, or send some to try it out.`}
              actionLabel="Add money"
              onAction={() => router.push('/(tabs)/earn')}
            />
          ) : (
            <View style={local.section}>
              {groups.map((group) => (
                <View key={group.key} style={local.dayGroup}>
                  <Text style={local.dayLabel}>{group.label}</Text>
                  {group.items.map((tx, i) => (
                    <View key={`${tx.txHash}-${i}`} style={local.txRow}>
                      <View style={local.txLabels}>
                        <Text style={s.body} numberOfLines={1}>
                          {typeLabel(tx.type)}
                          {tx.counterparty ? ` · ${receiptLabel(tx.counterparty)}` : ''}
                        </Text>
                        <Text style={s.muted}>Receipt {receiptLabel(tx.txHash)}</Text>
                      </View>
                      <Text selectable style={[local.txAmount, { color: tone(tx.type) }]}>
                        {formatUsd(tx.amountUsd)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chevron: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chevronDisabled: { opacity: 0.3 },
  chevronText: { color: palette.text, fontSize: 22, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryCard: { flexBasis: '47%', flexGrow: 1, gap: spacing.xs },
  summaryValue: { color: palette.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  emptyText: { color: palette.textSecondary, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  section: { gap: spacing.lg },
  dayGroup: { gap: spacing.sm },
  dayLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  txRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs },
  txLabels: { flex: 1, gap: 2 },
  txAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
})
