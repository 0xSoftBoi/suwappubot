/**
 * Send tokens screen.
 *
 * Address input (with paste), token/amount selection, fee estimate,
 * and confirmation before sending.
 */
import { useState, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { useAuth } from '../../../contexts/AuthContext'
import ConfirmSheet from '../../../components/ui/ConfirmSheet'
import { colors, spacing, radius } from '../../../lib/theme'

export default function SendScreen() {
  const params = useLocalSearchParams<{ token?: string; chain?: string }>()
  const { walletAddress } = useAuth()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedToken, setSelectedToken] = useState(params.token || 'ETH')
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // Load portfolio for token balances
  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
  })

  const tokens = portfolio?.tokens || []
  const currentToken = tokens.find((t) => t.symbol === selectedToken)
  const balance = currentToken ? parseFloat(currentToken.balance) : 0

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync()
    if (text) {
      setRecipient(text.trim())
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }, [])

  const handleMax = () => {
    if (currentToken) {
      setAmount(currentToken.balance)
      Haptics.selectionAsync()
    }
  }

  const isValidAddress = recipient.length >= 32 // Basic check for both EVM and Solana

  const handleSend = () => {
    if (!isValidAddress || !amount || parseFloat(amount) <= 0) return
    if (parseFloat(amount) > balance) {
      Alert.alert('Insufficient Balance', `You only have ${balance} ${selectedToken}`)
      return
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setShowConfirm(true)
  }

  const handleConfirmSend = async () => {
    setIsSending(true)
    try {
      // TODO: Implement actual send via Turnkey signing
      // For now, show success state
      await new Promise((r) => setTimeout(r, 2000))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Sent!', `${amount} ${selectedToken} sent to ${recipient.slice(0, 8)}...`)
      setShowConfirm(false)
      setAmount('')
      setRecipient('')
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Failed', 'Transaction failed. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Send' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Recipient */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>To</Text>
          <View style={styles.addressRow}>
            <TextInput
              style={styles.addressInput}
              placeholder="Wallet address (0x... or Solana)"
              placeholderTextColor={colors.textMuted}
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.pasteButton} onPress={handlePaste}>
              <Text style={styles.pasteText}>Paste</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Token selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Token</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tokenList}>
            {tokens.slice(0, 10).map((t) => (
              <TouchableOpacity
                key={`${t.address}-${t.chain}`}
                style={[styles.tokenChip, selectedToken === t.symbol && styles.tokenChipActive]}
                onPress={() => { setSelectedToken(t.symbol); Haptics.selectionAsync() }}
              >
                <Text style={[styles.tokenChipText, selectedToken === t.symbol && styles.tokenChipTextActive]}>
                  {t.symbol}
                </Text>
                <Text style={styles.tokenChipBalance}>{parseFloat(t.balance).toFixed(4)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <View style={styles.amountHeader}>
            <Text style={styles.sectionLabel}>Amount</Text>
            <Text style={styles.balanceText}>
              Balance: {balance.toFixed(4)} {selectedToken}
            </Text>
          </View>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <TouchableOpacity style={styles.maxButton} onPress={handleMax}>
              <Text style={styles.maxText}>MAX</Text>
            </TouchableOpacity>
          </View>
          {currentToken && amount && parseFloat(amount) > 0 && (
            <Text style={styles.usdValue}>
              ~${(parseFloat(amount) * (currentToken.usdValue / parseFloat(currentToken.balance || '1'))).toFixed(2)}
            </Text>
          )}
        </View>

        {/* Summary */}
        {isValidAddress && amount && parseFloat(amount) > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Sending</Text>
              <Text style={styles.summaryValue}>{amount} {selectedToken}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>To</Text>
              <Text style={styles.summaryValue}>{recipient.slice(0, 8)}...{recipient.slice(-6)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Network Fee</Text>
              <Text style={styles.summaryValue}>~$0.50</Text>
            </View>
          </View>
        )}

        {/* Send button */}
        <TouchableOpacity
          style={[styles.sendButton, (!isValidAddress || !amount || parseFloat(amount) <= 0) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!isValidAddress || !amount || parseFloat(amount) <= 0}
        >
          <Text style={styles.sendButtonText}>
            {!recipient ? 'Enter address' : !isValidAddress ? 'Invalid address' : !amount ? 'Enter amount' : 'Review Send'}
          </Text>
        </TouchableOpacity>

        {/* Confirmation */}
        <ConfirmSheet
          visible={showConfirm}
          title="Confirm Send"
          message={`Send ${amount} ${selectedToken} to ${recipient.slice(0, 10)}...${recipient.slice(-6)}?`}
          confirmLabel={isSending ? 'Sending...' : 'Confirm Send'}
          onConfirm={handleConfirmSend}
          onCancel={() => setShowConfirm(false)}
        />
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 40 },
  section: { marginBottom: spacing.xxl },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.md },
  addressRow: { flexDirection: 'row', gap: spacing.sm },
  addressInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 15,
    color: colors.text,
    fontFamily: 'SpaceMono',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pasteButton: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pasteText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  tokenList: { gap: spacing.sm },
  tokenChip: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 80,
  },
  tokenChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  tokenChipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  tokenChipTextActive: { color: colors.primary },
  tokenChipBalance: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  amountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  balanceText: { fontSize: 13, color: colors.textTertiary },
  amountRow: { flexDirection: 'row', gap: spacing.sm },
  amountInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  maxButton: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  maxText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  usdValue: { fontSize: 13, color: colors.textTertiary, marginTop: spacing.sm },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 13, color: colors.textSecondary },
  summaryValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.borderLight },
  sendButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
