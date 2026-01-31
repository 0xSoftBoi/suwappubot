/**
 * Create order — type, tokens, trigger price, expiry.
 */
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useCreateOrder } from '../../../hooks/useOrders'
import { colors, spacing, radius } from '../../../lib/theme'
import type { OrderType } from '../../../../packages/shared/src/types/orders'

const ORDER_TYPES: { key: OrderType; label: string }[] = [
  { key: 'limit_buy', label: 'Limit Buy' },
  { key: 'limit_sell', label: 'Limit Sell' },
  { key: 'stop_loss', label: 'Stop Loss' },
  { key: 'take_profit', label: 'Take Profit' },
]

const CHAINS = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'solana']

export default function CreateOrderScreen() {
  const router = useRouter()
  const createMutation = useCreateOrder()

  const [orderType, setOrderType] = useState<OrderType>('limit_buy')
  const [fromToken, setFromToken] = useState('')
  const [toToken, setToToken] = useState('')
  const [fromChain, setFromChain] = useState('ethereum')
  const [amount, setAmount] = useState('')
  const [triggerPrice, setTriggerPrice] = useState('')
  const [expiresInHours, setExpiresInHours] = useState('')

  const handleCreate = () => {
    createMutation.mutate(
      {
        orderType,
        fromToken: fromToken.toUpperCase(),
        toToken: toToken.toUpperCase(),
        fromChain,
        toChain: fromChain,
        amount,
        triggerPrice: parseFloat(triggerPrice),
        expiresInHours: expiresInHours ? parseInt(expiresInHours) : undefined,
      },
      { onSuccess: () => router.back() },
    )
  }

  const isValid = fromToken && toToken && amount && triggerPrice

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Order type */}
      <Text style={styles.label}>Order Type</Text>
      <View style={styles.chips}>
        {ORDER_TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.chip, orderType === t.key && styles.chipActive]}
            onPress={() => setOrderType(t.key)}
          >
            <Text style={[styles.chipText, orderType === t.key && styles.chipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tokens */}
      <Text style={styles.label}>From Token</Text>
      <TextInput
        style={styles.input}
        value={fromToken}
        onChangeText={setFromToken}
        placeholder="USDC"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>To Token</Text>
      <TextInput
        style={styles.input}
        value={toToken}
        onChangeText={setToToken}
        placeholder="ETH"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
      />

      {/* Chain */}
      <Text style={styles.label}>Chain</Text>
      <View style={styles.chips}>
        {CHAINS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, fromChain === c && styles.chipActive]}
            onPress={() => setFromChain(c)}
          >
            <Text style={[styles.chipText, fromChain === c && styles.chipTextActive]}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Amount */}
      <Text style={styles.label}>Amount</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      {/* Trigger price */}
      <Text style={styles.label}>Trigger Price (USD)</Text>
      <TextInput
        style={styles.input}
        value={triggerPrice}
        onChangeText={setTriggerPrice}
        placeholder="0.00"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
      />

      {/* Expiry */}
      <Text style={styles.label}>Expires In (hours, optional)</Text>
      <TextInput
        style={styles.input}
        value={expiresInHours}
        onChangeText={setExpiresInHours}
        placeholder="24"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
      />

      <TouchableOpacity
        style={[styles.submitButton, !isValid && styles.submitDisabled]}
        onPress={handleCreate}
        disabled={!isValid || createMutation.isPending}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.submitText}>Create Order</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: 16,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textSecondary },
  chipTextActive: { color: colors.bg, fontWeight: '600' },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.xxxl,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
})
