/**
 * Swap tab screen.
 *
 * Token swap interface with chain selection, quote fetching, and execution.
 */
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { api } from '../../lib/api'
import { SwapConfirmSheet } from '../../components/swap/SwapConfirmSheet'
import { colors, spacing, radius } from '../../lib/theme'

export default function SwapScreen() {
  const params = useLocalSearchParams<{ token?: string; chain?: string }>()
  const [fromChain, setFromChain] = useState('ethereum')
  const [toChain, setToChain] = useState('ethereum')
  const [fromToken, setFromToken] = useState('')
  const [toToken, setToToken] = useState('')
  const [amount, setAmount] = useState('')
  const [fromTokenDisplay, setFromTokenDisplay] = useState('ETH')
  const [toTokenDisplay, setToTokenDisplay] = useState('USDC')
  const [showConfirm, setShowConfirm] = useState(false)

  // Pre-fill from deep link params
  useEffect(() => {
    if (params.token) {
      setToToken(params.token)
    }
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

  // Fetch tokens for selected chain
  const { data: tokens } = useQuery({
    queryKey: ['tokens', fromChain],
    queryFn: () => api.getTokens(fromChain),
    enabled: !!fromChain,
  })

  // Get swap quote
  const { data: quote, isFetching: isQuoting, refetch: refetchQuote } = useQuery({
    queryKey: ['quote', fromChain, toChain, fromToken, toToken, amount],
    queryFn: () => api.getSwapQuote({
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromDecimals: 18,
    }),
    enabled: !!fromToken && !!toToken && !!amount && parseFloat(amount) > 0,
    staleTime: 15_000,
  })

  // Execute swap
  const swapMutation = useMutation({
    mutationFn: (quoteId: string) => api.executeSwap({ quoteId }),
  })

  const handleSwapPress = () => {
    if (quote) {
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

  // Set default tokens when list loads
  useEffect(() => {
    if (tokens && tokens.length > 0) {
      const eth = tokens.find(t => t.symbol === 'ETH')
      const usdc = tokens.find(t => t.symbol === 'USDC')
      if (eth && !fromToken) {
        setFromToken(eth.address)
        setFromTokenDisplay(eth.symbol)
      }
      if (usdc && !toToken) {
        setToToken(usdc.address)
        setToTokenDisplay(usdc.symbol)
      }
    }
  }, [tokens])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* From */}
      <View style={styles.tokenCard}>
        <Text style={styles.cardLabel}>From</Text>
        <View style={styles.tokenRow}>
          <TouchableOpacity style={styles.tokenSelector}>
            <Text style={styles.tokenSymbol}>{fromTokenDisplay}</Text>
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
        <Text style={styles.chainLabel}>{fromChain}</Text>
      </View>

      {/* Swap direction arrow */}
      <View style={styles.arrowContainer}>
        <TouchableOpacity style={styles.arrowButton}>
          <Text style={styles.arrowText}>&#x2195;</Text>
        </TouchableOpacity>
      </View>

      {/* To */}
      <View style={styles.tokenCard}>
        <Text style={styles.cardLabel}>To</Text>
        <View style={styles.tokenRow}>
          <TouchableOpacity style={styles.tokenSelector}>
            <Text style={styles.tokenSymbol}>{toTokenDisplay}</Text>
          </TouchableOpacity>
          <Text style={styles.receiveAmount}>
            {isQuoting ? '...' : quote?.toAmount || '0.00'}
          </Text>
        </View>
        <Text style={styles.chainLabel}>{toChain}</Text>
      </View>

      {/* Quote Details */}
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

      {/* Swap Button */}
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
            {!amount ? 'Enter amount' : !quote ? 'Getting quote...' : 'Review Swap'}
          </Text>
        )}
      </TouchableOpacity>

      {/* Confirmation Sheet */}
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

      {/* Success / Error */}
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, gap: 0 },
  tokenCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  cardLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  tokenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tokenSelector: {
    backgroundColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  tokenSymbol: { fontSize: 18, fontWeight: '600', color: colors.text },
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
  chainLabel: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, textTransform: 'capitalize' },
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
