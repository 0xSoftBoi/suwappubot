/**
 * Virtualised token list.
 *
 * FlashList rather than FlatList: FlatList keeps every rendered cell mounted
 * and grows memory linearly with scroll distance, and it blanks cells during
 * fast flings. FlashList recycles a fixed pool of views, so a 500-token
 * portfolio costs the same as a 20-token one.
 *
 * `estimatedItemSize` is the one thing FlashList genuinely needs to be fast —
 * it is how it decides how many cells to keep in the recycle pool. We know the
 * exact row height, so we give it exactly that.
 */
import { useCallback } from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { TokenRow, TOKEN_ROW_HEIGHT } from './TokenRow'
import { palette, spacing, styles as s } from '../theme'
import type { Token } from '../types/api'

interface Props {
  tokens: Token[]
  refreshing?: boolean
  onRefresh?: () => void
  ListHeaderComponent?: React.ReactElement
}

export function TokenList({ tokens, refreshing = false, onRefresh, ListHeaderComponent }: Props) {
  // Stable identity: an inline arrow here would break FlashList's own memoisation.
  const renderItem = useCallback(({ item }: { item: Token }) => <TokenRow token={item} />, [])
  const keyExtractor = useCallback((item: Token) => `${item.chain}:${item.address}`, [])

  return (
    <FlashList
      data={tokens}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      estimatedItemSize={TOKEN_ROW_HEIGHT}
      ListHeaderComponent={ListHeaderComponent}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={Empty}
      contentContainerStyle={local.content}
      // Trim the render window on low-end devices; the default draws ~2 screens
      // ahead, which is wasted work on a list this cheap to recycle.
      drawDistance={TOKEN_ROW_HEIGHT * 8}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.accent}
          />
        ) : undefined
      }
    />
  )
}

const Separator = () => <View style={local.separator} />

const Empty = () => (
  <View style={local.empty}>
    <Text style={s.muted}>No tokens yet. Fund your wallet to get started.</Text>
  </View>
)

const local = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  separator: { height: spacing.xs },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' },
})
