/**
 * Watchlist screen — user's saved tokens with prices and quick actions.
 */
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Stack, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useWatchlist, useRemoveFromWatchlist } from '../../../hooks/useWatchlist'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'
import type { WatchedToken } from '../../../../packages/shared/src/types/sniping'

function WatchlistRow({
  item,
  onRemove,
  onPress,
}: {
  item: WatchedToken
  onRemove: (id: number) => void
  onPress: (item: WatchedToken) => void
}) {
  const shortAddress = item.tokenAddress
    ? `${item.tokenAddress.slice(0, 6)}...${item.tokenAddress.slice(-4)}`
    : ''

  const handleRemove = () => {
    Alert.alert('Remove from Watchlist', `Remove ${item.tokenSymbol || shortAddress}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          onRemove(item.id)
        },
      },
    ])
  }

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
      onLongPress={handleRemove}
    >
      {/* Token icon placeholder */}
      <View style={styles.iconWrap}>
        <Text style={styles.iconText}>
          {(item.tokenSymbol || '??').slice(0, 2).toUpperCase()}
        </Text>
      </View>

      {/* Token info */}
      <View style={styles.info}>
        <Text style={styles.symbol}>{item.tokenSymbol || 'Unknown'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.chain}>{item.platform}</Text>
          <Text style={styles.address}>{shortAddress}</Text>
        </View>
      </View>

      {/* Status badges */}
      <View style={styles.badges}>
        {item.isMigrated && (
          <View style={styles.migratedBadge}>
            <Text style={styles.migratedText}>Migrated</Text>
          </View>
        )}
      </View>

      {/* Remove button */}
      <TouchableOpacity style={styles.removeBtn} onPress={handleRemove}>
        <Text style={styles.removeIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

export default function WatchlistScreen() {
  const router = useRouter()
  const { data: watchlist, isLoading, refetch, isRefetching } = useWatchlist()
  const removeMutation = useRemoveFromWatchlist()

  const handleRemove = (id: number) => {
    removeMutation.mutate(id)
  }

  const handlePress = (item: WatchedToken) => {
    router.push({
      pathname: '/(features)/token/[address]',
      params: {
        address: item.tokenAddress,
        chain: item.platform,
        symbol: item.tokenSymbol || '',
      },
    })
  }

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: 'Watchlist' }} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Watchlist' }} />
      <View style={styles.container}>
        {!watchlist?.length ? (
          <EmptyState
            icon="star"
            title="No watched tokens"
            subtitle="Add tokens to your watchlist to track them here"
          />
        ) : (
          <FlashList
            data={watchlist}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{
              paddingHorizontal: spacing.xxl,
              paddingVertical: spacing.md,
            }}
            renderItem={({ item }) => (
              <WatchlistRow item={item} onRemove={handleRemove} onPress={handlePress} />
            )}
            onRefresh={refetch}
            refreshing={isRefetching}
          />
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  info: { flex: 1 },
  symbol: { fontSize: 15, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  chain: {
    fontSize: 12,
    color: colors.textTertiary,
    textTransform: 'capitalize',
  },
  address: { fontSize: 12, color: colors.textMuted, fontFamily: 'SpaceMono' },
  badges: { flexDirection: 'row', gap: spacing.xs },
  migratedBadge: {
    backgroundColor: colors.info,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  migratedText: { fontSize: 10, fontWeight: '600', color: '#fff' },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: { fontSize: 12, color: colors.textSecondary },
})
