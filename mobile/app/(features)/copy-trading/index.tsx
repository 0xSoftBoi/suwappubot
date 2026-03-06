/**
 * Copy trading hub — Discover / Following / My Trades tabs.
 */
import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Haptics from 'expo-haptics'
import { useTraderLeaderboard, useMyFollows, useCopyTrades, useUnfollowTrader } from '../../../hooks/useCopyTrading'
import TraderCard from '../../../components/copy-trading/TraderCard'
import FollowCard from '../../../components/copy-trading/FollowCard'
import CopyTradeRow from '../../../components/copy-trading/CopyTradeRow'
import EmptyState from '../../../components/ui/EmptyState'
import { colors, spacing, radius } from '../../../lib/theme'

type Tab = 'discover' | 'following' | 'trades'

export default function CopyTradingScreen() {
  const [tab, setTab] = useState<Tab>('discover')
  const { data: traders, isLoading: tradersLoading } = useTraderLeaderboard()
  const { data: follows, isLoading: followsLoading } = useMyFollows()
  const { data: trades, isLoading: tradesLoading } = useCopyTrades()
  const unfollowMutation = useUnfollowTrader()

  const tabs: { key: Tab; label: string }[] = [
    { key: 'discover', label: 'Discover' },
    { key: 'following', label: 'Following' },
    { key: 'trades', label: 'My Trades' },
  ]

  const handleUnfollow = (id: number, name: string) => {
    Alert.alert('Unfollow Trader', `Stop copying ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unfollow',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          unfollowMutation.mutate(id)
        },
      },
    ])
  }

  const isLoading =
    (tab === 'discover' && tradersLoading) ||
    (tab === 'following' && followsLoading) ||
    (tab === 'trades' && tradesLoading)

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => { setTab(t.key); Haptics.selectionAsync() }}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : tab === 'discover' ? (
        !traders?.length ? (
          <EmptyState icon="users" title="No traders yet" subtitle="Top traders will appear here as they trade" />
        ) : (
          <FlashList
            data={traders}
            contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
            renderItem={({ item, index }) => <TraderCard trader={item} rank={index + 1} />}
          />
        )
      ) : tab === 'following' ? (
        !follows?.length ? (
          <EmptyState icon="user-plus" title="Not following anyone" subtitle="Follow top traders to copy their moves" />
        ) : (
          <FlashList
            data={follows}
            contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <FollowCard follow={item} onUnfollow={(id) => handleUnfollow(id, item.traderName)} />
            )}
          />
        )
      ) : (
        !trades?.length ? (
          <EmptyState icon="exchange" title="No copy trades" subtitle="Trades copied from traders you follow will appear here" />
        ) : (
          <FlashList
            data={trades}
            contentContainerStyle={{ paddingHorizontal: spacing.xxl, paddingBottom: 40 }}
            renderItem={({ item }) => <CopyTradeRow trade={item} />}
          />
        )
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.cardAlt },
  tabText: { fontSize: 14, color: colors.textTertiary, fontWeight: '500' },
  tabTextActive: { color: colors.text },
})
