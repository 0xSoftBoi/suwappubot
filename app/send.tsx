import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { ErrorState, LoadingState, SignedOutState } from '../src/components/screen-state'
import { useEarn, useResolveEns, useSend, useWallets } from '../src/hooks/use-gecko'
import { ApiError } from '../src/lib/api'
import { getAuthRevision, isAuthenticated } from '../src/lib/auth'
import { formatUsd } from '../src/lib/format'
import { queryKeys } from '../src/lib/queryKeys'
import { palette, radius, spacing, styles as s } from '../src/theme'
import type { SendActionSuccess } from '../src/types/api'

type Step = 'input' | 'confirm' | 'pending' | 'success'

// Same bounds as Earn (api/routes/mobile.py's shared amount validator).
const MIN_SEND_AMOUNT = 0.01
const MAX_SEND_AMOUNT = 1_000_000
const PENDING_REFETCH_DELAY_MS = 5_000
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const ENS_NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i
const ENS_DEBOUNCE_MS = 500

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof Error) return err.message
  return 'Something went wrong. Try again.'
}

function truncate(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export default function SendScreen() {
  const signedIn = isAuthenticated()
  const router = useRouter()
  const qc = useQueryClient()
  const wallets = useWallets(signedIn)
  // Idle-USDC hint only — never blocks Send if /earn is unavailable.
  const earn = useEarn(signedIn)
  const send = useSend()

  const [step, setStep] = useState<Step>('input')
  const [toInput, setToInput] = useState('')
  const [debouncedEnsName, setDebouncedEnsName] = useState('')
  const [rawAmount, setRawAmount] = useState('')
  const [useMax, setUseMax] = useState(false)
  const [result, setResult] = useState<SendActionSuccess | null>(null)
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
  }, [])

  const clearPendingTimer = useCallback(() => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current)
      pendingTimer.current = null
    }
  }, [])

  const toTrimmed = toInput.trim()
  const loweredTo = toTrimmed.toLowerCase()
  const isHexInput = EVM_ADDRESS_RE.test(toTrimmed)
  const isEnsInput = ENS_NAME_RE.test(toTrimmed)

  // Debounce ~500ms after typing stops before firing the resolve lookup.
  useEffect(() => {
    if (!isEnsInput) {
      setDebouncedEnsName('')
      return
    }
    const timer = setTimeout(() => setDebouncedEnsName(loweredTo), ENS_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [isEnsInput, loweredTo])

  const ensReady = isEnsInput && debouncedEnsName === loweredTo
  const ens = useResolveEns(debouncedEnsName, ensReady)
  const ensResolving = isEnsInput && (!ensReady || ens.isFetching)
  const ensResolvedAddress = ensReady && ens.data ? ens.data.address : null
  const ensFailed = ensReady && ens.isError

  if (!signedIn) return <SignedOutState />
  if (wallets.isLoading && !wallets.data) return <LoadingState label="Loading your wallet…" />
  if (wallets.isError && !wallets.data) {
    return <ErrorState message="Gecko couldn’t load your wallet." onRetry={() => void wallets.refetch()} />
  }

  const ownAddresses = new Set((wallets.data ?? []).map((w) => w.address.toLowerCase()))
  const idleUsdc = (earn.data?.idle ?? [])
    .filter((i) => i.token === 'USDC')
    .reduce((sum, i) => sum + i.balanceUsd, 0)

  // The resolved 0x recipient: direct for a plain hex address, otherwise
  // whatever a successful ENS lookup returned. This — never the raw input —
  // is what gets sent to POST /v1/mobile/send.
  const resolvedTo = isHexInput ? toTrimmed : ensResolvedAddress
  const toValid = Boolean(resolvedTo)
  const isOwnAddress = Boolean(resolvedTo) && ownAddresses.has((resolvedTo as string).toLowerCase())

  const amountToSend = useMax ? 'max' : rawAmount.trim()
  const numericAmount = Number(rawAmount.trim())
  const amountInBounds = useMax
    || (rawAmount.trim().length > 0
      && Number.isFinite(numericAmount)
      && numericAmount >= MIN_SEND_AMOUNT
      && numericAmount <= MAX_SEND_AMOUNT)
  const canReview = toValid && !isOwnAddress && !ensResolving && amountToSend.length > 0 && amountInBounds

  const paste = useCallback(async () => {
    const text = await Clipboard.getStringAsync()
    if (text) setToInput(text.trim())
  }, [])

  const reset = useCallback(() => {
    clearPendingTimer()
    setStep('input')
    setToInput('')
    setRawAmount('')
    setUseMax(false)
    setResult(null)
    setPendingTxHash(null)
    send.reset()
  }, [clearPendingTimer, send])

  const submit = useCallback(() => {
    if (!canReview || !resolvedTo) return
    send.mutate({ to: resolvedTo, amount: amountToSend }, {
      onSuccess: (response) => {
        const authRevision = getAuthRevision()
        if (response.ok) {
          setResult(response)
          setStep('success')
          void qc.invalidateQueries({ queryKey: queryKeys.snapshot(authRevision) })
        } else {
          setPendingTxHash(response.txHash)
          setStep('pending')
          clearPendingTimer()
          pendingTimer.current = setTimeout(() => {
            void qc.invalidateQueries({ queryKey: queryKeys.snapshot(authRevision) })
          }, PENDING_REFETCH_DELAY_MS)
        }
      },
    })
  }, [canReview, resolvedTo, send, amountToSend, qc, clearPendingTimer])

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      {step === 'input' ? (
        <>
          <View style={s.card}>
            <Text style={s.muted}>To</Text>
            <View style={local.addressRow}>
              <TextInput
                value={toInput}
                onChangeText={setToInput}
                placeholder="0x… or name.eth"
                placeholderTextColor={palette.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={local.addressInput}
              />
              <Pressable onPress={() => void paste()} style={local.pasteChip}>
                <Text style={local.pasteChipText}>Paste</Text>
              </Pressable>
            </View>
            {isEnsInput && ensResolving ? (
              <Text style={s.muted}>Resolving {loweredTo}…</Text>
            ) : null}
            {isEnsInput && ensFailed ? (
              <Text selectable style={local.error}>{errorMessage(ens.error)}</Text>
            ) : null}
            {isEnsInput && ensResolvedAddress ? (
              <Text selectable style={s.muted}>{loweredTo} → {truncate(ensResolvedAddress)}</Text>
            ) : null}
            {toTrimmed.length > 0 && !isHexInput && !isEnsInput ? (
              <Text selectable style={local.error}>That doesn’t look like a valid address or ENS name.</Text>
            ) : null}
            {isOwnAddress ? (
              <Text selectable style={local.error}>That’s one of your own wallets — pick a different address.</Text>
            ) : null}
          </View>

          <View style={s.card}>
            <Text style={s.muted}>Amount (USDC on Base)</Text>
            <View style={local.amountRow}>
              <TextInput
                value={useMax ? '' : rawAmount}
                onChangeText={(t) => { setRawAmount(t); setUseMax(false) }}
                placeholder={useMax ? 'Max available' : '0.00'}
                placeholderTextColor={palette.textMuted}
                keyboardType="decimal-pad"
                editable={!useMax}
                style={local.amountInput}
              />
              <Pressable onPress={() => { setUseMax(true); setRawAmount('') }} style={local.maxChip}>
                <Text style={local.maxChipText}>Max</Text>
              </Pressable>
            </View>
            {idleUsdc > 0 ? <Text style={s.muted}>~{formatUsd(idleUsdc)} idle USDC available</Text> : null}
            {!useMax && rawAmount.trim().length > 0 && !amountInBounds ? (
              <Text selectable style={local.error}>
                Enter an amount between {MIN_SEND_AMOUNT} and {MAX_SEND_AMOUNT.toLocaleString('en-US')} USDC.
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={() => setStep('confirm')}
            disabled={!canReview}
            style={[local.primaryButton, !canReview && local.disabled]}
          >
            <Text style={local.primaryButtonText}>Review</Text>
          </Pressable>
        </>
      ) : null}

      {step === 'confirm' ? (
        <View style={[s.card, local.panel]}>
          <Text style={s.heading}>Confirm send</Text>
          <Text selectable style={local.copy}>
            Send {useMax ? 'the max available amount' : `${amountToSend} USDC`} to{' '}
            {isEnsInput && resolvedTo ? `${loweredTo} → ${truncate(resolvedTo)}` : truncate(resolvedTo ?? toTrimmed)}.
            {' '}This moves real funds and can’t be undone from here.
          </Text>
          {send.isError ? <Text selectable style={local.error}>{errorMessage(send.error)}</Text> : null}
          <View style={local.panelActions}>
            <Pressable onPress={() => setStep('input')} disabled={send.isPending} style={local.cancelButton}>
              <Text style={local.cancelText}>Back</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={send.isPending}
              style={[local.confirmButton, send.isPending && local.disabled]}
            >
              <Text style={local.confirmText}>{send.isPending ? 'Sending…' : 'Confirm'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 'pending' && pendingTxHash ? (
        <View style={[s.card, local.panel]}>
          <Text style={local.pending}>Submitted — confirming on-chain.</Text>
          <Text selectable style={s.muted}>Tx {truncate(pendingTxHash, 8, 6)}</Text>
          <Text selectable style={local.copy}>
            This can take a minute. Gecko will refresh your balance automatically — no need to resend.
          </Text>
          <Pressable onPress={() => router.back()} style={local.confirmButton}>
            <Text style={local.confirmText}>Done</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'success' && result ? (
        <View style={[s.card, local.panel]}>
          <Text style={local.success}>Sent.</Text>
          <Text selectable style={s.body}>{result.amount} USDC to {truncate(result.to)}</Text>
          <Text selectable style={s.muted}>Tx {truncate(result.txHash, 8, 6)}</Text>
          <View style={local.panelActions}>
            <Pressable onPress={reset} style={local.cancelButton}>
              <Text style={local.cancelText}>Send again</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={local.confirmButton}>
              <Text style={local.confirmText}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  addressInput: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 14, paddingHorizontal: spacing.md, fontSize: 15 },
  pasteChip: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pasteChipText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  amountInput: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  maxChip: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  maxChipText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600' },
  primaryButton: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  primaryButtonText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  panel: { gap: spacing.md },
  copy: { color: palette.textSecondary, fontSize: 15, lineHeight: 22 },
  panelActions: { flexDirection: 'row', gap: spacing.md },
  cancelButton: { flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: spacing.md },
  cancelText: { color: palette.textSecondary, fontSize: 15, fontWeight: '600' },
  confirmButton: { flex: 1, alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  confirmText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  success: { color: palette.success, fontSize: 15, fontWeight: '700' },
  pending: { color: palette.textSecondary, fontSize: 15, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 13, marginTop: spacing.xs },
})
