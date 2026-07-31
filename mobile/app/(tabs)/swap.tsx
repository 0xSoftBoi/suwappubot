/**
 * Swap tab.
 *
 * The amount field is debounced into the quote params — without this, every
 * keystroke would fire a network request. `useQuote` also polls on a live
 * interval once a request is in flight, so debouncing the *input* keeps that
 * polling anchored to a value the user actually paused on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useExecuteSwap, useQuote, useSwapStatus } from '../../src/hooks/useSuwappu'
import { palette, spacing, styles as s } from '../../src/theme'
import type { Swap } from '../../src/types/api'

const CHAINS = ['base', 'arbitrum'] as const

// Placeholder token addresses per chain — real token picking is a follow-up.
const DEFAULT_TOKEN: Record<(typeof CHAINS)[number], { from: string; to: string }> = {
  base: { from: 'ETH', to: 'USDC' },
  arbitrum: { from: 'ETH', to: 'USDC' },
}

export default function SwapScreen() {
  const [fromChain, setFromChain] = useState<(typeof CHAINS)[number]>('base')
  const [toChain, setToChain] = useState<(typeof CHAINS)[number]>('arbitrum')
  const [amount, setAmount] = useState('')
  const [debouncedAmount, setDebouncedAmount] = useState('')
  const [swapId, setSwapId] = useState<string | null>(null)

  const fromToken = DEFAULT_TOKEN[fromChain].from
  const toToken = DEFAULT_TOKEN[toChain].to

  // Debounce: only push the amount into quote params 350ms after typing stops.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedAmount(amount), 350)
    return () => clearTimeout(handle)
  }, [amount])

  const quoteParams = useMemo(() => {
    if (!debouncedAmount || Number(debouncedAmount) <= 0) return null
    return { fromChain, toChain, fromToken, toToken, amount: debouncedAmount }
  }, [fromChain, toChain, fromToken, toToken, debouncedAmount])

  const { data: quote, isLoading: isQuoting } = useQuote(quoteParams)
  const executeSwap = useExecuteSwap()
  const { data: status } = useSwapStatus(swapId)

  const handleSwap = useCallback(() => {
    if (!quote) return
    executeSwap.mutate(
      { quoteId: quote.quoteId },
      {
        onSuccess: (result: Swap) => {
          setSwapId(result.id)
        },
      },
    )
  }, [quote, executeSwap])

  const selectFromChain = useCallback((chain: (typeof CHAINS)[number]) => {
    setFromChain(chain)
  }, [])
  const selectToChain = useCallback((chain: (typeof CHAINS)[number]) => {
    setToChain(chain)
  }, [])

  const swapDisabled = executeSwap.isPending || !quote

  return (
    <View style={[s.screen, local.container]}>
      <Text style={s.title}>Swap</Text>

      <View style={s.card}>
        <Text style={s.muted}>From</Text>
        <View style={local.chainRow}>
          {CHAINS.map((chain) => (
            <ChainButton key={chain} chain={chain} active={chain === fromChain} onPress={selectFromChain} />
          ))}
        </View>
        <TextInput
          style={local.input}
          keyboardType="decimal-pad"
          placeholder="0.0"
          placeholderTextColor={palette.textMuted}
          value={amount}
          onChangeText={setAmount}
        />
      </View>

      <View style={s.card}>
        <Text style={s.muted}>To</Text>
        <View style={local.chainRow}>
          {CHAINS.map((chain) => (
            <ChainButton key={chain} chain={chain} active={chain === toChain} onPress={selectToChain} />
          ))}
        </View>
        {isQuoting ? (
          <ActivityIndicator color={palette.accent} style={local.quoteLoading} />
        ) : (
          <Text style={local.toAmount}>{quote?.toAmount ?? '—'}</Text>
        )}
      </View>

      {quote ? (
        <View style={local.quoteDetails}>
          {quote.priceImpact !== undefined ? (
            <Text style={s.muted}>Price impact: {quote.priceImpact.toFixed(2)}%</Text>
          ) : null}
          {quote.estimatedGasUsd !== undefined ? (
            <Text style={s.muted}>Est. gas: ${quote.estimatedGasUsd.toFixed(2)}</Text>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity
        style={[local.swapButton, swapDisabled ? local.swapButtonDisabled : null]}
        onPress={handleSwap}
        disabled={swapDisabled}
      >
        {executeSwap.isPending ? (
          <ActivityIndicator color={palette.bg} />
        ) : (
          <Text style={local.swapButtonText}>Swap</Text>
        )}
      </TouchableOpacity>

      {executeSwap.isError ? <Text style={local.errorText}>Swap failed. Try again.</Text> : null}

      {swapId && status ? (
        <View style={s.card}>
          <Text style={s.muted}>Status</Text>
          <Text style={s.body}>{status.status}</Text>
        </View>
      ) : null}
    </View>
  )
}

function ChainButton({
  chain,
  active,
  onPress,
}: {
  chain: (typeof CHAINS)[number]
  active: boolean
  onPress: (chain: (typeof CHAINS)[number]) => void
}) {
  const handlePress = useCallback(() => onPress(chain), [chain, onPress])
  return (
    <TouchableOpacity
      style={[local.chainButton, active ? local.chainButtonActive : null]}
      onPress={handlePress}
    >
      <Text style={active ? local.chainTextActive : local.chainText}>{chain}</Text>
    </TouchableOpacity>
  )
}

const local = StyleSheet.create({
  container: { paddingTop: spacing.xl, gap: spacing.md },
  chainRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  chainButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  chainButtonActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  chainText: { color: palette.textSecondary, fontSize: 13 },
  chainTextActive: { color: palette.bg, fontSize: 13, fontWeight: '600' },
  input: { color: palette.text, fontSize: 28, fontWeight: '600', paddingVertical: spacing.sm },
  quoteLoading: { alignSelf: 'flex-start', marginTop: spacing.sm },
  toAmount: { color: palette.text, fontSize: 28, fontWeight: '600', paddingVertical: spacing.sm },
  quoteDetails: { gap: spacing.xxs },
  swapButton: {
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  swapButtonDisabled: { opacity: 0.4 },
  swapButtonText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  errorText: { color: palette.danger, fontSize: 13 },
})
