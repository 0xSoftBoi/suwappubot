/**
 * Receive tokens screen.
 *
 * Shows wallet address with copy + share actions,
 * chain selector for multi-chain support,
 * and a placeholder for QR code generation.
 */
import { useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Share,
  Alert,
} from 'react-native'
import { Stack } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useAuth } from '../../../contexts/AuthContext'
import { colors, spacing, radius } from '../../../lib/theme'

const CHAINS = [
  { id: 'ethereum', label: 'Ethereum', prefix: '0x' },
  { id: 'base', label: 'Base', prefix: '0x' },
  { id: 'arbitrum', label: 'Arbitrum', prefix: '0x' },
  { id: 'optimism', label: 'Optimism', prefix: '0x' },
  { id: 'polygon', label: 'Polygon', prefix: '0x' },
  { id: 'bsc', label: 'BSC', prefix: '0x' },
  { id: 'solana', label: 'Solana', prefix: '' },
] as const

export default function ReceiveScreen() {
  const { walletAddress } = useAuth()
  const [selectedChain, setSelectedChain] = useState<string>('ethereum')

  const address = walletAddress || ''
  const chain = CHAINS.find((c) => c.id === selectedChain) || CHAINS[0]

  const handleCopy = useCallback(async () => {
    if (!address) return
    await Clipboard.setStringAsync(address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Copied', 'Address copied to clipboard')
  }, [address])

  const handleShare = useCallback(async () => {
    if (!address) return
    try {
      await Share.share({
        message: `My ${chain.label} wallet address: ${address}`,
      })
    } catch {
      // User cancelled share
    }
  }, [address, chain.label])

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : 'No wallet'

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Chain selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Network</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chainList}
          >
            {CHAINS.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.chainChip,
                  selectedChain === c.id && styles.chainChipActive,
                ]}
                onPress={() => {
                  setSelectedChain(c.id)
                  Haptics.selectionAsync()
                }}
              >
                <Text
                  style={[
                    styles.chainChipText,
                    selectedChain === c.id && styles.chainChipTextActive,
                  ]}
                >
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* QR Code area */}
        <View style={styles.qrContainer}>
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>QR</Text>
            <Text style={styles.qrSubtext}>{shortAddress}</Text>
          </View>
          <Text style={styles.networkLabel}>
            Send only {chain.label} assets to this address
          </Text>
        </View>

        {/* Full address display */}
        <View style={styles.addressCard}>
          <Text style={styles.addressLabel}>Your {chain.label} Address</Text>
          <Text style={styles.addressText} selectable>
            {address || 'Connect wallet to see address'}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleCopy}
            disabled={!address}
          >
            <Text style={styles.actionIcon}>📋</Text>
            <Text style={styles.actionLabel}>Copy Address</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleShare}
            disabled={!address}
          >
            <Text style={styles.actionIcon}>↗</Text>
            <Text style={styles.actionLabel}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Warning */}
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            Only send {chain.label} compatible tokens to this address. Sending
            tokens on the wrong network may result in permanent loss.
          </Text>
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 40 },
  section: { marginBottom: spacing.xxl },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  chainList: { gap: spacing.sm },
  chainChip: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chainChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  chainChipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chainChipTextActive: { color: colors.primary },
  qrContainer: { alignItems: 'center', marginBottom: spacing.xxl },
  qrPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: radius.xl,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  qrPlaceholderText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#000',
  },
  qrSubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: spacing.sm,
    fontFamily: 'SpaceMono',
  },
  networkLabel: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  addressCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addressLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  addressText: {
    fontSize: 14,
    color: colors.text,
    fontFamily: 'SpaceMono',
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  warningCard: {
    backgroundColor: colors.warningDim,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  warningText: {
    fontSize: 13,
    color: colors.warning,
    lineHeight: 20,
  },
})
