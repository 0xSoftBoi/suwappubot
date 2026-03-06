/**
 * Bottom-sheet token selector with search, balances, and recent tokens.
 *
 * Used by the Swap screen to pick from/to tokens, and reusable by
 * Orders, DCA, Alerts, etc.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import type { SwapToken } from '../../../packages/shared/src/types/swap'
import { colors, spacing, radius } from '../../lib/theme'

interface TokenSelectorProps {
  visible: boolean
  tokens: SwapToken[]
  isLoading?: boolean
  onSelect: (token: SwapToken) => void
  onClose: () => void
  /** Optional: tokens the user owns (shows balance) */
  balances?: Map<string, string>
}

export function TokenSelector({
  visible,
  tokens,
  isLoading,
  onSelect,
  onClose,
  balances,
}: TokenSelectorProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput>(null)

  // Reset search on open
  useEffect(() => {
    if (visible) {
      setQuery('')
      // Small delay so the modal animation finishes before keyboard opens
      setTimeout(() => inputRef.current?.focus(), 350)
    }
  }, [visible])

  const filtered = query.length > 0
    ? tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(query.toLowerCase()) ||
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.address.toLowerCase() === query.toLowerCase(),
      )
    : tokens

  const handleSelect = useCallback(
    (token: SwapToken) => {
      onSelect(token)
      onClose()
    },
    [onSelect, onClose],
  )

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Handle */}
        <View style={styles.handleBar}>
          <View style={styles.handle} />
        </View>

        {/* Header */}
        <Text style={styles.title}>Select Token</Text>

        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search name, symbol, or address"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {/* Token list */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : (
          <View style={styles.listContainer}>
            <FlashList
              data={filtered}
              keyExtractor={(item) => `${item.address}-${item.chain}`}

              renderItem={({ item }) => {
                const bal = balances?.get(item.address)
                return (
                  <TouchableOpacity
                    style={styles.tokenRow}
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.6}
                  >
                    {/* Token icon placeholder */}
                    <View style={styles.tokenIcon}>
                      <Text style={styles.tokenIconText}>
                        {item.symbol.slice(0, 2)}
                      </Text>
                    </View>

                    {/* Name + symbol */}
                    <View style={styles.tokenInfo}>
                      <Text style={styles.tokenSymbol}>{item.symbol}</Text>
                      <Text style={styles.tokenName} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>

                    {/* Balance (if available) */}
                    {bal && (
                      <Text style={styles.tokenBalance}>{bal}</Text>
                    )}
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No tokens found</Text>
              }
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    maxHeight: '80%',
    minHeight: '60%',
  },
  handleBar: { alignItems: 'center', paddingTop: spacing.md },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderLight,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  searchContainer: { paddingHorizontal: spacing.xxl, marginBottom: spacing.lg },
  searchInput: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContainer: { flex: 1, minHeight: 200 },
  loadingContainer: { paddingVertical: 40, alignItems: 'center' },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenIconText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tokenInfo: { flex: 1 },
  tokenSymbol: { fontSize: 16, fontWeight: '600', color: colors.text },
  tokenName: { fontSize: 13, color: colors.textTertiary, marginTop: 1 },
  tokenBalance: { fontSize: 14, color: colors.textSecondary, fontFamily: 'SpaceMono' },
  emptyText: {
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing.xxxl,
  },
})
