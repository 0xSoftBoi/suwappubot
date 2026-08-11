import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useCreateGoal, useDeleteGoal, useEarn, useEarnDeposit, useEarnWithdraw, useGoals } from '../../src/hooks/use-gecko'
import { ApiError } from '../../src/lib/api'
import { analytics } from '../../src/lib/analytics'
import { isAuthenticated } from '../../src/lib/auth'
import { formatUsd } from '../../src/lib/format'
import { palette, radius, spacing, styles as s } from '../../src/theme'
import type { EarnActionSuccess, Goal } from '../../src/types/api'

type Mode = 'deposit' | 'withdraw'
type Step = 'input' | 'confirm' | 'pending' | 'success'

// Mirrors _parse_earn_amount in api/routes/mobile.py — kept in sync so the
// input rejects out-of-bounds amounts before a round trip, not just after.
const MIN_EARN_AMOUNT = 0.01
const MAX_EARN_AMOUNT = 1_000_000

// Mirrors the assumed POST /v1/mobile/goals validation — mirror client-side.
const MAX_GOAL_NAME_LENGTH = 64
const MAX_GOALS = 10

/** How long to wait before re-checking an unconfirmed (202) tx. Just a nicer
 * first paint than an immediate refetch that likely still shows the old
 * balance — the manual pull-to-refresh always works in the meantime. */
const PENDING_REFETCH_DELAY_MS = 5_000

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof Error) return err.message
  return 'Something went wrong. Try again.'
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export default function EarnScreen() {
  const signedIn = isAuthenticated()
  const { data, isLoading, isError, isRefetching, refetch } = useEarn(signedIn)
  const deposit = useEarnDeposit()
  const withdraw = useEarnWithdraw()
  // Goals is a separate read that must never block or error out Earn — if
  // /goals is loading, degraded, or unavailable, the section is just omitted.
  const goals = useGoals(signedIn)
  const createGoal = useCreateGoal()
  const deleteGoal = useDeleteGoal()

  const [mode, setMode] = useState<Mode | null>(null)
  const [step, setStep] = useState<Step>('input')
  const [rawAmount, setRawAmount] = useState('')
  const [useMax, setUseMax] = useState(false)
  const [result, setResult] = useState<EarnActionSuccess | null>(null)
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showNewGoal, setShowNewGoal] = useState(false)
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  useEffect(() => () => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
  }, [])

  const refresh = useCallback(() => void refetch(), [refetch])
  const mutation = mode === 'deposit' ? deposit : mode === 'withdraw' ? withdraw : null

  const clearPendingTimer = useCallback(() => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current)
      pendingTimer.current = null
    }
  }, [])

  const openAction = useCallback((next: Mode) => {
    clearPendingTimer()
    setMode(next)
    setStep('input')
    setRawAmount('')
    setUseMax(false)
    setResult(null)
    setPendingTxHash(null)
    deposit.reset()
    withdraw.reset()
  }, [deposit, withdraw, clearPendingTimer])

  const closeAction = useCallback(() => {
    clearPendingTimer()
    setMode(null)
    setStep('input')
    setRawAmount('')
    setUseMax(false)
    setResult(null)
    setPendingTxHash(null)
  }, [clearPendingTimer])

  const amountToSend = useMax ? 'max' : rawAmount.trim()
  const numericAmount = Number(rawAmount.trim())
  const amountInBounds = useMax
    || (rawAmount.trim().length > 0
      && Number.isFinite(numericAmount)
      && numericAmount >= MIN_EARN_AMOUNT
      && numericAmount <= MAX_EARN_AMOUNT)
  const canReview = amountToSend.length > 0 && amountInBounds

  const submit = useCallback(() => {
    if (!mode || !mutation || !canReview) return
    mutation.mutate({ amount: amountToSend }, {
      onSuccess: (response) => {
        if (response.ok) {
          setResult(response)
          setStep('success')
          void refetch()
        } else {
          // 202 broadcast-but-unconfirmed: not an error, and never auto-retried
          // (a retry here could double-submit on top of a tx that still lands).
          setPendingTxHash(response.txHash)
          setStep('pending')
          clearPendingTimer()
          pendingTimer.current = setTimeout(() => { void refetch() }, PENDING_REFETCH_DELAY_MS)
        }
      },
    })
  }, [mode, mutation, canReview, amountToSend, refetch, clearPendingTimer])

  useEffect(() => { analytics.screen('Earn') }, [])

  const goalsEmpty = goals.data !== undefined && (goals.data.goals ?? []).length === 0
  const positionEmpty = data !== undefined && (data.positions ?? []).length === 0
  useEffect(() => {
    if (goalsEmpty) analytics.track('empty_state_seen', { screen: 'earn_goals' })
  }, [goalsEmpty])
  useEffect(() => {
    if (positionEmpty) analytics.track('empty_state_seen', { screen: 'earn_position' })
  }, [positionEmpty])

  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading your yield…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your Earn position." onRetry={refresh} />

  const positions = data?.positions ?? []
  const idle = data?.idle ?? []
  const positionUsd = positions.reduce((sum, p) => sum + p.balanceUsd, 0)
  const idleUsd = idle.reduce((sum, i) => sum + i.balanceUsd, 0)
  const apy = data?.apy ?? 0
  const hasPosition = positions.length > 0

  const goalList = goals.data?.goals ?? []
  const goalNameTrimmed = goalName.trim()
  const goalTargetNum = Number(goalTarget.trim())
  const goalTargetValid = goalTarget.trim().length > 0 && Number.isFinite(goalTargetNum) && goalTargetNum > 0
  const goalNameValid = goalNameTrimmed.length > 0 && goalNameTrimmed.length <= MAX_GOAL_NAME_LENGTH
  const canCreateGoal = goalNameValid && goalTargetValid && goalList.length < MAX_GOALS

  const submitGoal = () => {
    if (!canCreateGoal) return
    createGoal.mutate({ name: goalNameTrimmed, targetUsd: goalTargetNum }, {
      onSuccess: () => {
        setShowNewGoal(false)
        setGoalName('')
        setGoalTarget('')
        void goals.refetch()
      },
    })
  }

  const confirmDelete = (goalId: number) => {
    deleteGoal.mutate(goalId, {
      onSuccess: () => {
        setConfirmDeleteId(null)
        void goals.refetch()
      },
    })
  }

  return (
    <ScrollView
      style={s.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={palette.accent} />}
    >
      <View style={s.card}>
        <Text style={s.muted}>Aave APY</Text>
        <Text selectable style={local.apy}>{apy.toFixed(2)}%</Text>
        {data?.coverage === 'best_effort' ? (
          <Text style={s.muted}>Available sources only. Gecko won’t infer missing balances.</Text>
        ) : null}
      </View>

      <View style={local.section}>
        <Text style={s.heading}>Your position</Text>
        {hasPosition ? (
          <View style={s.card}>
            <Text selectable style={local.positionTotal}>{formatUsd(positionUsd)}</Text>
            <View style={local.positionList}>
              {positions.map((p, i) => (
                <View key={`${p.protocol}-${p.chain}-${p.token}-${i}`} style={local.row}>
                  <View>
                    <Text style={s.body}>{p.protocol} · {p.chain}</Text>
                    <Text style={s.muted}>{p.balance} {p.token}</Text>
                  </View>
                  <View style={local.right}>
                    <Text selectable style={s.body}>{formatUsd(p.balanceUsd)}</Text>
                    <Text style={s.muted}>{p.apy.toFixed(2)}% APY</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <Text selectable style={local.copy}>Idle USDC earns 0% — Aave pays {apy.toFixed(2)}%.</Text>
          </View>
        )}
      </View>

      {goals.data ? (
        <View style={local.section}>
          <Text style={s.heading}>Goals</Text>
          {goalList.length === 0 && !showNewGoal ? (
            <View style={s.card}>
              <Text selectable style={local.copy}>Set a target and watch your savings close in on it.</Text>
            </View>
          ) : null}
          {goalList.map((goal: Goal) => {
            const progress = goal.targetUsd > 0 ? Math.min(positionUsd / goal.targetUsd, 1) : 0
            return (
              <View key={goal.id} style={local.holding}>
                <View style={local.row}>
                  <Text style={s.body} numberOfLines={1}>{goal.name}</Text>
                  {confirmDeleteId === goal.id ? (
                    <View style={local.goalConfirmRow}>
                      <Pressable onPress={() => confirmDelete(goal.id)} disabled={deleteGoal.isPending} hitSlop={8}>
                        <Text style={local.goalConfirmText}>{deleteGoal.isPending ? 'Removing…' : 'Remove'}</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmDeleteId(null)} hitSlop={8}>
                        <Text style={s.muted}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setConfirmDeleteId(goal.id)}
                      onLongPress={() => setConfirmDeleteId(goal.id)}
                      hitSlop={8}
                    >
                      <Text style={local.goalDelete}>✕</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={s.muted}>{formatUsd(positionUsd)} of {formatUsd(goal.targetUsd)}</Text>
                <View style={local.track}>
                  <View style={[local.fill, local.fillSavings, { width: `${progress * 100}%` }]} />
                </View>
              </View>
            )
          })}
          {goalList.length > 0 ? (
            <Text style={local.goalCaption}>All goals draw on the same savings balance — this is a single pot, not separate buckets (v0).</Text>
          ) : null}

          {showNewGoal ? (
            <View style={local.panel}>
              <TextInput
                value={goalName}
                onChangeText={setGoalName}
                placeholder="Goal name"
                placeholderTextColor={palette.textMuted}
                maxLength={MAX_GOAL_NAME_LENGTH}
                style={local.goalInput}
              />
              <TextInput
                value={goalTarget}
                onChangeText={setGoalTarget}
                placeholder="Target amount (USD)"
                placeholderTextColor={palette.textMuted}
                keyboardType="decimal-pad"
                style={local.goalInput}
              />
              {createGoal.isError ? <Text selectable style={local.error}>{errorMessage(createGoal.error)}</Text> : null}
              <View style={local.panelActions}>
                <Pressable onPress={() => { setShowNewGoal(false); setGoalName(''); setGoalTarget(''); createGoal.reset() }} style={local.cancelButton}>
                  <Text style={local.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submitGoal}
                  disabled={!canCreateGoal || createGoal.isPending}
                  style={[local.confirmButton, (!canCreateGoal || createGoal.isPending) && local.actionDisabled]}
                >
                  <Text style={local.confirmText}>{createGoal.isPending ? 'Saving…' : 'Save goal'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setShowNewGoal(true)} disabled={goalList.length >= MAX_GOALS} style={[local.actionButtonSecondary, goalList.length >= MAX_GOALS && local.actionDisabled]}>
              <Text style={local.actionTextSecondary}>New goal</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={local.section}>
        <Text style={s.heading}>Idle USDC</Text>
        <View style={s.card}>
          <Text selectable style={local.positionTotal}>{formatUsd(idleUsd)}</Text>
          <Text style={s.muted}>Available to deposit</Text>
        </View>
      </View>

      {mode === null ? (
        <View style={local.actions}>
          <Pressable
            onPress={() => openAction('deposit')}
            disabled={idleUsd <= 0}
            style={[local.actionButton, idleUsd <= 0 && local.actionDisabled]}
          >
            <Text style={local.actionText}>Deposit</Text>
          </Pressable>
          <Pressable
            onPress={() => openAction('withdraw')}
            disabled={!hasPosition}
            style={[local.actionButtonSecondary, !hasPosition && local.actionDisabled]}
          >
            <Text style={local.actionTextSecondary}>Withdraw</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[s.card, local.panel]}>
          <Text style={s.heading}>{mode === 'deposit' ? 'Deposit to Aave' : 'Withdraw from Aave'}</Text>

          {step === 'input' ? (
            <>
              <View style={local.amountRow}>
                <TextInput
                  value={useMax ? '' : rawAmount}
                  onChangeText={(t) => { setRawAmount(t); setUseMax(false) }}
                  placeholder={useMax ? 'Max available' : '0.00'}
                  placeholderTextColor={palette.textMuted}
                  keyboardType="decimal-pad"
                  editable={!useMax}
                  style={local.input}
                />
                <Pressable onPress={() => { setUseMax(true); setRawAmount('') }} style={local.maxChip}>
                  <Text style={local.maxChipText}>Max</Text>
                </Pressable>
              </View>
              {!useMax && rawAmount.trim().length > 0 && !amountInBounds ? (
                <Text selectable style={local.error}>
                  Enter an amount between {MIN_EARN_AMOUNT} and {MAX_EARN_AMOUNT.toLocaleString('en-US')} USDC.
                </Text>
              ) : null}
              <View style={local.panelActions}>
                <Pressable onPress={closeAction} style={local.cancelButton}>
                  <Text style={local.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => setStep('confirm')}
                  disabled={!canReview}
                  style={[local.confirmButton, !canReview && local.actionDisabled]}
                >
                  <Text style={local.confirmText}>Review</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <Text selectable style={local.copy}>
                {mode === 'deposit' ? 'Deposit' : 'Withdraw'} {useMax ? 'the max available amount' : `${amountToSend} USDC`}. This moves real funds and can’t be undone from here.
              </Text>
              {mutation?.isError ? <Text selectable style={local.error}>{errorMessage(mutation.error)}</Text> : null}
              <View style={local.panelActions}>
                <Pressable onPress={() => setStep('input')} disabled={mutation?.isPending} style={local.cancelButton}>
                  <Text style={local.cancelText}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={mutation?.isPending}
                  style={[local.confirmButton, mutation?.isPending && local.actionDisabled]}
                >
                  <Text style={local.confirmText}>{mutation?.isPending ? 'Sending…' : 'Confirm'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {step === 'pending' && pendingTxHash ? (
            <>
              <Text style={local.pending}>Submitted — confirming on-chain.</Text>
              <Text selectable style={s.muted}>Tx {truncateHash(pendingTxHash)}</Text>
              <Text selectable style={local.copy}>
                This can take a minute. Gecko will refresh your position automatically — no need to resend.
              </Text>
              <Pressable onPress={closeAction} style={local.confirmButton}>
                <Text style={local.confirmText}>Done</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'success' && result ? (
            <>
              <Text style={local.success}>{mode === 'deposit' ? 'Deposit sent.' : 'Withdrawal sent.'}</Text>
              <Text selectable style={s.body}>{result.approximate ? '~' : ''}{result.amount} USDC</Text>
              <Text selectable style={s.muted}>Tx {truncateHash(result.txHash)}</Text>
              <Pressable onPress={closeAction} style={local.confirmButton}>
                <Text style={local.confirmText}>Done</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  apy: { color: palette.text, fontSize: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { gap: spacing.md },
  positionTotal: { color: palette.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  positionList: { gap: spacing.md, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  right: { alignItems: 'flex-end', gap: 2 },
  copy: { color: palette.textSecondary, fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionButton: { flex: 1, alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  actionButtonSecondary: { flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: spacing.md },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  actionTextSecondary: { color: palette.text, fontSize: 15, fontWeight: '700' },
  panel: { gap: spacing.md },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  maxChip: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  maxChipText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600' },
  panelActions: { flexDirection: 'row', gap: spacing.md },
  cancelButton: { flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: spacing.md },
  cancelText: { color: palette.textSecondary, fontSize: 15, fontWeight: '600' },
  confirmButton: { flex: 1, alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  confirmText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  success: { color: palette.success, fontSize: 15, fontWeight: '700' },
  pending: { color: palette.textSecondary, fontSize: 15, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 13 },
  holding: { gap: spacing.sm, paddingVertical: spacing.xs },
  track: { height: 6, borderRadius: radius.full, backgroundColor: palette.surfaceElevated, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.full, backgroundColor: palette.accent },
  fillSavings: { backgroundColor: palette.success },
  goalDelete: { color: palette.textMuted, fontSize: 16, fontWeight: '700', paddingHorizontal: spacing.xs },
  goalConfirmRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  goalConfirmText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  goalCaption: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
  goalInput: { minHeight: 48, color: palette.text, backgroundColor: palette.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 14, paddingHorizontal: spacing.md, fontSize: 16 },
})
