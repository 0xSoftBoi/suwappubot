import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ErrorState, LoadingState, SignedOutState } from '../../src/components/screen-state'
import { useEarn, useEarnDeposit, useEarnWithdraw } from '../../src/hooks/use-gecko'
import { ApiError } from '../../src/lib/api'
import { isAuthenticated } from '../../src/lib/auth'
import { formatUsd } from '../../src/lib/format'
import { palette, radius, spacing, styles as s } from '../../src/theme'
import type { EarnActionResponse } from '../../src/types/api'

type Mode = 'deposit' | 'withdraw'
type Step = 'input' | 'confirm' | 'success'

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

  const [mode, setMode] = useState<Mode | null>(null)
  const [step, setStep] = useState<Step>('input')
  const [rawAmount, setRawAmount] = useState('')
  const [useMax, setUseMax] = useState(false)
  const [result, setResult] = useState<EarnActionResponse | null>(null)

  const refresh = useCallback(() => void refetch(), [refetch])
  const mutation = mode === 'deposit' ? deposit : mode === 'withdraw' ? withdraw : null

  const openAction = useCallback((next: Mode) => {
    setMode(next)
    setStep('input')
    setRawAmount('')
    setUseMax(false)
    setResult(null)
    deposit.reset()
    withdraw.reset()
  }, [deposit, withdraw])

  const closeAction = useCallback(() => {
    setMode(null)
    setStep('input')
    setRawAmount('')
    setUseMax(false)
    setResult(null)
  }, [])

  const amountToSend = useMax ? 'max' : rawAmount.trim()
  const canReview = amountToSend.length > 0 && (useMax || Number(amountToSend) > 0)

  const submit = useCallback(() => {
    if (!mode || !mutation || !canReview) return
    mutation.mutate(amountToSend, {
      onSuccess: (response) => {
        setResult(response)
        setStep('success')
        void refetch()
      },
    })
  }, [mode, mutation, canReview, amountToSend, refetch])

  if (!signedIn) return <SignedOutState />
  if (isLoading && !data) return <LoadingState label="Loading your yield…" />
  if (isError && !data) return <ErrorState message="Gecko couldn’t load your Earn position." onRetry={refresh} />

  const positions = data?.positions ?? []
  const idle = data?.idle ?? []
  const positionUsd = positions.reduce((sum, p) => sum + p.balanceUsd, 0)
  const idleUsd = idle.reduce((sum, i) => sum + i.balanceUsd, 0)
  const apy = data?.apy ?? 0
  const hasPosition = positions.length > 0

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

          {step === 'success' && result ? (
            <>
              <Text style={local.success}>{mode === 'deposit' ? 'Deposit sent.' : 'Withdrawal sent.'}</Text>
              <Text selectable style={s.body}>{result.amount} USDC</Text>
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
  error: { color: palette.danger, fontSize: 13 },
})
