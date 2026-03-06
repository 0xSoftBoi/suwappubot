/**
 * Swap tab screen.
 *
 * Full-featured token swap with chain selection, token selector bottom sheet,
 * preset amounts, direction toggle, slippage config, haptic feedback,
 * quote details, and execution.
 */
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { api } from '../../lib/api'
import { SwapConfirmSheet } from '../../components/swap/SwapConfirmSheet'
import { TokenSelector } from '../../components/swap/TokenSelector'
import { ChainSelector } from '../../components/swap/ChainSelector'
import type { SwapToken } from '../../../packages/shared/src/types/swap'
import { colors, spacing, radius } from '../../lib/theme'

const PRESET_PERCENTS = [25, 50, 75, 100] as const

export default function SwapScreen() {
  const params = useLocalSearchParams<{ token?: string; chain?: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [fromChain, setFromChain] = useState('ethereum')
  const [toChain, setToChain] = useState('ethereum')
  const [fromToken, setFromToken] = useState('')
  const [toToken, setToToken] = useState('')
  const [amount, setAmount] = useState('')
  const [fromTokenDisplay, setFromTokenDisplay] = useState('ETH')
  const [toTokenDisplay, setToTokenDisplay] = useState('USDC')
  const [fromDecimals, setFromDecimals] = useState(18)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showFromTokenSelector, setShowFromTokenSelector] = useState(false)
  const [showToTokenSelector, setShowToTokenSelector] = useState(false)
  const [slippage, setSlippage] = useState(0.5)
  const [showSlippage, setShowSlippage] = useState(false)

  // Pre-fill from deep link params
  useEffect(() => {
    if (params.token) setToToken(params.token)
    if (params.chain) {
      setFromChain(params.chain)
      setToChain(params.chain)
    }
  }, [params.token, params.chain])

  // Fetch available chains
  const { data: chains } = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.getChains(),
  })

  // Fetch tokens for from chain
  const { data: fromTokens, isLoading: isLoadingFromTokens } = useQuery({
    queryKey: ['tokens', fromChain],
    queryFn: () => api.getTokens(fromChain),
    enabled: !!fromChain,
  })

  // Fetch tokens for to chain (when cross-chain)
  const { data: toTokens, isLoading: isLoadingToTokens } = useQuery({
    queryKey: ['tokens', toChain],
    queryFn: () => api.getTokens(toChain),
    enabled: !!toChain,
  })

  // Get swap quote with debounce
  const { data: quote, isFetching: isQuoting } = useQuery({
    queryKey: ['quote', fromChain, toChain, fromToken, toToken, amount, slippage],
    queryFn: () => api.getSwapQuote({
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromDecimals,
      slippage: slippage * 100, // basis points
    }),
    enabled: !!fromToken && !!toToken && !!amount && parseFloat(amount) > 0,
    staleTime: 15_000,
  })

  // Execute swap
  const swapMutation = useMutation({
    mutationFn: (quoteId: string) => api.executeSwap({ quoteId }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      queryClient.invalidateQueries({ queryKey: ['swaps'] })
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    },
  })

  // Set default tokens when list loads
  useEffect(() => {
    if (fromTokens && fromTokens.length > 0) {
      const eth = fromTokens.find(t => t.symbol === 'ETH')
      const usdc = fromTokens.find(t => t.symbol === 'USDC')
      if (eth && !fromToken) {
        setFromToken(eth.address)
        setFromTokenDisplay(eth.symbol)
        setFromDecimals(eth.decimals)
      }
      if (usdc && !toToken) {
        setToToken(usdc.address)
        setToTokenDisplay(usdc.symbol)
      }
    }
  }, [fromTokens])

  const handleSelectFromToken = (token: SwapToken) => {
    setFromToken(token.address)
    setFromTokenDisplay(token.symbol)
    setFromDecimals(token.decimals)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const handleSelectToToken = (token: SwapToken) => {
    setToToken(token.address)
    setToTokenDisplay(token.symbol)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const handleSwapDirection = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    // Swap everything
    const tmpChain = fromChain
    const tmpToken = fromToken
    const tmpDisplay = fromTokenDisplay
    const tmpDecimals = fromDecimals

    setFromChain(toChain)
    setToChain(tmpChain)
    setFromToken(toToken)
    setToToken(tmpToken)
    setFromTokenDisplay(toTokenDisplay)
    setToTokenDisplay(tmpDisplay)
    setFromDecimals(18) // reset since we don't track toDecimals
    setAmount(quote?.toAmount || '')
  }

  const handlePresetAmount = (percent: number) => {
    // Find the from token in the list to get balance
    const token = fromTokens?.find(t => t.address === fromToken)
    if (token?.balance) {
      const bal = parseFloat(token.balance)
      if (!isNaN(bal)) {
        const val = (bal * percent / 100)
        setAmount(percent === 100 ? token.balance : val.toString())
        Haptics.selectionAsync()
      }
    }
  }

  const handleSwapPress = () => {
    if (quote) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setShowConfirm(true)
    }
  }

  const handleConfirmSwap = () => {
    if (quote?.id) {
      swapMutation.mutate(quote.id, {
        onSettled: () => setShowConfirm(false),
      })
    }
  }

  // USD estimate for amount
  const fromUsdEstimate = quote ? `~$${quote.fromAmountUsd?.toFixed(2) || '--'}` : ''
  const toUsdEstimate = quote ? `~$${quote.toAmountUsd?.toFixed(2) || '--'}` : ''

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Chain selector */}
      {chains && chains.length > 0 && (
        <ChainSelector
          chains={chains}
          selected={fromChain}
          onSelect={(key) => {
            setFromChain(key)
            setToChain(key)
            setFromToken('')
            setToToken('')
            setAmount('')
          }}
        />
      )}

      {/* From card */}
      <View style={styles.tokenCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabel}>From</Text>
          {fromUsdEstimate ? <Text style={styles.usdEstimate}>{fromUsdEstimate}</Text> : null}
        </View>
        <View style={styles.tokenRow}>
          <TouchableOpacity
            style={styles.tokenSelector}
            onPress={() => setShowFromTokenSelector(true)}
          >
            <Text style={styles.tokenSymbolText}>{fromTokenDisplay}</Text>
            <Text style={styles.chevron}>{'>'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
        </View>

        {/* Preset amount buttons */}
        <View style={styles.presets}>
          {PRESET_PERCENTS.map((pct) => (
            <TouchableOpacity
              key={pct}
              style={styles.presetButton}
              onPress={() => handlePresetAmount(pct)}
            >
              <Text style={styles.presetText}>{pct === 100 ? 'MAX' : `${pct}%`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Swap direction toggle */}
      <View style={styles.arrowContainer}>
        <TouchableOpacity style={styles.arrowButton} onPress={handleSwapDirection}>
          <Text style={styles.arrowText}>&#x2195;</Text>
        </TouchableOpacity>
      </View>

      {/* To card */}
      <View style={styles.tokenCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabel}>To</Text>
          {toUsdEstimate ? <Text style={styles.usdEstimate}>{toUsdEstimate}</Text> : null}
        </View>
        <View style={styles.tokenRow}>
          <TouchableOpacity
            style={styles.tokenSelector}
            onPress={() => setShowToTokenSelector(true)}
          >
            <Text style={styles.tokenSymbolText}>{toTokenDisplay}</Text>
            <Text style={styles.chevron}>{'>'}</Text>
          </TouchableOpacity>
          <Text style={styles.receiveAmount}>
            {isQuoting ? '...' : quote?.toAmount || '0.00'}
          </Text>
        </View>
      </View>

      {/* Slippage row */}
      <TouchableOpacity style={styles.slippageRow} onPress={() => setShowSlippage(!showSlippage)}>
        <Text style={styles.slippageLabel}>Slippage Tolerance</Text>
        <Text style={styles.slippageValue}>{slippage}%</Text>
      </TouchableOpacity>

      {showSlippage && (
        <View style={styles.slippageOptions}>
          {[0.1, 0.5, 1.0, 3.0].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.slippageChip, slippage === val && styles.slippageChipActive]}
              onPress={() => { setSlippage(val); Haptics.selectionAsync() }}
            >
              <Text style={[styles.slippageChipText, slippage === val && styles.slippageChipTextActive]}>
                {val}%
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Quote details */}
      {quote && (
        <View style={styles.quoteDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Rate</Text>
            <Text style={styles.detailValue}>
              1 {fromTokenDisplay} = {quote.exchangeRate.toFixed(4)} {toTokenDisplay}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Price Impact</Text>
            <Text style={[styles.detailValue, quote.priceImpact > 3 && styles.warning]}>
              {quote.priceImpact.toFixed(2)}%
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Gas</Text>
            <Text style={styles.detailValue}>${quote.gasUsd.toFixed(2)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Route</Text>
            <Text style={styles.detailValue}>{quote.route}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Min Received</Text>
            <Text style={styles.detailValue}>{quote.minReceived} {toTokenDisplay}</Text>
          </View>
        </View>
      )}

      {/* Swap button */}
      <TouchableOpacity
        style={[
          styles.swapButton,
          (!quote || swapMutation.isPending) && styles.swapButtonDisabled,
        ]}
        onPress={handleSwapPress}
        disabled={!quote || swapMutation.isPending}
      >
        {swapMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.swapButtonText}>
            {!amount ? 'Enter amount' : isQuoting ? 'Getting quote...' : !quote ? 'Enter amount' : 'Review Swap'}
          </Text>
        )}
      </TouchableOpacity>

      {/* Success / Error banners */}
      {swapMutation.isSuccess && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>Swap submitted! Tracking transaction...</Text>
        </View>
      )}
      {swapMutation.isError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            {(swapMutation.error as any)?.detail || 'Swap failed'}
          </Text>
        </View>
      )}

      {/* Token selectors */}
      <TokenSelector
        visible={showFromTokenSelector}
        tokens={fromTokens || []}
        isLoading={isLoadingFromTokens}
        onSelect={handleSelectFromToken}
        onClose={() => setShowFromTokenSelector(false)}
      />
      <TokenSelector
        visible={showToTokenSelector}
        tokens={toTokens || []}
        isLoading={isLoadingToTokens}
        onSelect={handleSelectToToken}
        onClose={() => setShowToTokenSelector(false)}
      />

      {/* Confirmation sheet */}
      <SwapConfirmSheet
        visible={showConfirm}
        isPending={swapMutation.isPending}
        onConfirm={handleConfirmSwap}
        onCancel={() => setShowConfirm(false)}
        details={
          quote
            ? {
                fromToken: fromTokenDisplay,
                toToken: toTokenDisplay,
                fromAmount: amount,
                toAmount: quote.toAmount,
                exchangeRate: quote.exchangeRate,
                priceImpact: quote.priceImpact,
                gasUsd: quote.gasUsd,
                route: quote.route,
                minReceived: quote.minReceived,
              }
            : null
        }
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, gap: 0, paddingBottom: 40 },
  tokenCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardLabel: { fontSize: 13, color: colors.textSecondary },
  usdEstimate: { fontSize: 13, color: colors.textTertiary },
  tokenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tokenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  tokenSymbolText: { fontSize: 18, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 12, color: colors.textSecondary },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    marginLeft: spacing.lg,
  },
  receiveAmount: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
    marginLeft: spacing.lg,
  },
  presets: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  presetButton: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingVertical: 6,
    alignItems: 'center',
  },
  presetText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  arrowContainer: { alignItems: 'center', marginVertical: -12, zIndex: 1 },
  arrowButton: {
    backgroundColor: colors.border,
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  arrowText: { fontSize: 18, color: colors.text },
  slippageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  slippageLabel: { fontSize: 13, color: colors.textSecondary },
  slippageValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  slippageOptions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  slippageChip: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  slippageChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  slippageChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  slippageChipTextActive: { color: colors.primary },
  quoteDetails: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 13, color: colors.text },
  warning: { color: colors.warning },
  swapButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  swapButtonDisabled: { backgroundColor: colors.borderLight },
  swapButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  successBanner: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  successText: { color: colors.primary, fontSize: 14, textAlign: 'center' },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  errorText: { color: colors.error, fontSize: 14, textAlign: 'center' },
})
