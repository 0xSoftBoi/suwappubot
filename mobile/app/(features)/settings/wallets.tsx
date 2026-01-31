/**
 * Wallets screen — list, create, set default, copy address, unlink.
 */
import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { useWallets, useCreateWallet, useSetDefaultWallet, useUnlinkWallet } from '../../../hooks/useWallets'
import EmptyState from '../../../components/ui/EmptyState'
import ConfirmSheet from '../../../components/ui/ConfirmSheet'
import { colors, spacing, radius } from '../../../lib/theme'

export default function WalletsScreen() {
  const { data: wallets, isLoading } = useWallets()
  const createWallet = useCreateWallet()
  const setDefault = useSetDefaultWallet()
  const unlinkWallet = useUnlinkWallet()

  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [showChainPicker, setShowChainPicker] = useState(false)

  const handleCopy = async (address: string) => {
    await Clipboard.setStringAsync(address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const handleCreate = (chainType: string) => {
    setShowChainPicker(false)
    createWallet.mutate(chainType)
  }

  const handleSetDefault = (address: string) => {
    setDefault.mutate(address)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const handleUnlink = () => {
    if (confirmTarget) {
      unlinkWallet.mutate(confirmTarget)
      setConfirmTarget(null)
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Create wallet button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => setShowChainPicker(true)}
        disabled={createWallet.isPending}
      >
        {createWallet.isPending ? (
          <ActivityIndicator color={colors.bg} size="small" />
        ) : (
          <>
            <FontAwesome name="plus" size={14} color={colors.bg} />
            <Text style={styles.createText}>Create Wallet</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Chain picker */}
      {showChainPicker && (
        <View style={styles.chainPicker}>
          <TouchableOpacity style={styles.chainOption} onPress={() => handleCreate('evm')}>
            <View style={[styles.chainDot, { backgroundColor: '#627eea' }]} />
            <Text style={styles.chainLabel}>EVM (Ethereum, Base, Arbitrum...)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chainOption} onPress={() => handleCreate('solana')}>
            <View style={[styles.chainDot, { backgroundColor: '#9945ff' }]} />
            <Text style={styles.chainLabel}>Solana</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Wallet list */}
      {!wallets?.length ? (
        <EmptyState
          icon="credit-card"
          title="No wallets yet"
          subtitle="Create your first wallet to start trading"
        />
      ) : (
        <FlashList
          data={wallets}
          contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={styles.walletCard}>
              <View style={styles.walletHeader}>
                <View style={styles.walletInfo}>
                  <Text style={styles.walletName}>{item.name || 'Wallet'}</Text>
                  <View style={styles.badges}>
                    <View style={[styles.chainBadge, {
                      backgroundColor: item.chainType === 'solana' ? '#9945ff20' : '#627eea20',
                    }]}>
                      <Text style={[styles.chainBadgeText, {
                        color: item.chainType === 'solana' ? '#9945ff' : '#627eea',
                      }]}>
                        {item.chainType === 'solana' ? 'SOL' : 'EVM'}
                      </Text>
                    </View>
                    {(item as any).isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              <TouchableOpacity onPress={() => handleCopy(item.address)} style={styles.addressRow}>
                <Text style={styles.address} numberOfLines={1}>
                  {item.address}
                </Text>
                <FontAwesome name="copy" size={14} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.actions}>
                {!(item as any).isDefault && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleSetDefault(item.address)}
                  >
                    <Text style={styles.actionText}>Set Default</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, styles.unlinkButton]}
                  onPress={() => setConfirmTarget(item.address)}
                >
                  <Text style={styles.unlinkText}>Unlink</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Confirm unlink sheet */}
      <ConfirmSheet
        visible={!!confirmTarget}
        title="Unlink Wallet"
        message="Are you sure you want to unlink this wallet? You can re-link it later."
        confirmLabel="Unlink"
        destructive
        onConfirm={handleUnlink}
        onCancel={() => setConfirmTarget(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  createButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  createText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  chainPicker: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  chainOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chainDot: { width: 10, height: 10, borderRadius: 5 },
  chainLabel: { fontSize: 15, color: colors.text },
  walletCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  walletInfo: { gap: spacing.sm },
  walletName: { fontSize: 16, fontWeight: '600', color: colors.text },
  badges: { flexDirection: 'row', gap: spacing.sm },
  chainBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  chainBadgeText: { fontSize: 11, fontWeight: '600' },
  defaultBadge: {
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  defaultBadgeText: { fontSize: 11, fontWeight: '600', color: colors.success },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  address: {
    flex: 1,
    fontSize: 13,
    color: colors.textTertiary,
    fontFamily: 'SpaceMono',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  unlinkButton: { backgroundColor: colors.error + '15' },
  unlinkText: { fontSize: 13, color: colors.error, fontWeight: '500' },
})
