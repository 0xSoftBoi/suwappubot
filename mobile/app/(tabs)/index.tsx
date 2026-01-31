/**
 * Home / Dashboard tab.
 *
 * Shows portfolio value, quick actions, and recent activity.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useState, useCallback } from 'react'

export default function HomeScreen() {
  const { user, walletAddress } = useAuth()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const { data: portfolio, refetch: refetchPortfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
    refetchInterval: 30_000,
  })

  const { data: recentSwaps } = useQuery({
    queryKey: ['swaps', 'recent'],
    queryFn: () => api.getSwaps(3, 0),
  })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetchPortfolio()
    setRefreshing(false)
  }, [refetchPortfolio])

  const totalValue = portfolio?.totalUsdValue ?? 0

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {user?.firstName ? `Hey, ${user.firstName}` : 'Welcome'}
        </Text>
        {walletAddress && (
          <Text style={styles.address}>
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </Text>
        )}
      </View>

      {/* Portfolio Value */}
      <View style={styles.valueCard}>
        <Text style={styles.valueLabel}>Total Balance</Text>
        <Text style={styles.valueAmount}>
          ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(tabs)/swap')}>
          <Text style={styles.actionEmoji}>&#x21C4;</Text>
          <Text style={styles.actionLabel}>Swap</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(tabs)/portfolio')}>
          <Text style={styles.actionEmoji}>&#x1F4B0;</Text>
          <Text style={styles.actionLabel}>Portfolio</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(features)/discover' as any)}>
          <Text style={styles.actionEmoji}>&#x1F50D;</Text>
          <Text style={styles.actionLabel}>Discover</Text>
        </TouchableOpacity>
      </View>

      {/* Recent Activity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentSwaps && recentSwaps.length > 0 ? (
          recentSwaps.map((swap) => (
            <TouchableOpacity
              key={swap.id}
              style={styles.swapRow}
              onPress={() =>
                router.push({
                  pathname: '/(features)/tx/[hash]' as any,
                  params: {
                    hash: swap.txHash || String(swap.id),
                    fromToken: swap.fromToken,
                    toToken: swap.toToken,
                    fromAmount: swap.fromAmount,
                    toAmount: swap.toAmount || '--',
                    fromChain: swap.fromChain,
                    toChain: swap.toChain,
                    status: swap.status,
                    date: swap.createdAt,
                  },
                })
              }
            >
              <View>
                <Text style={styles.swapTokens}>
                  {swap.fromToken} → {swap.toToken}
                </Text>
                <Text style={styles.swapChain}>
                  {swap.fromChain}{swap.fromChain !== swap.toChain ? ` → ${swap.toChain}` : ''}
                </Text>
              </View>
              <View style={styles.swapRight}>
                <Text style={styles.swapAmount}>{swap.fromAmount}</Text>
                <Text style={[
                  styles.swapStatus,
                  swap.status === 'completed' && styles.statusComplete,
                  swap.status === 'failed' && styles.statusFailed,
                ]}>
                  {swap.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyText}>No recent swaps</Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 24, paddingTop: 60 },
  header: { marginBottom: 24 },
  greeting: { fontSize: 28, fontWeight: '700', color: '#fff' },
  address: { fontSize: 14, color: '#666', marginTop: 4, fontFamily: 'SpaceMono' },
  valueCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
  },
  valueLabel: { fontSize: 14, color: '#888', marginBottom: 8 },
  valueAmount: { fontSize: 36, fontWeight: '700', color: '#fff' },
  quickActions: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  actionButton: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  actionEmoji: { fontSize: 24 },
  actionLabel: { fontSize: 13, color: '#fff', fontWeight: '500' },
  section: {},
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 16 },
  swapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  swapTokens: { fontSize: 15, fontWeight: '500', color: '#fff' },
  swapChain: { fontSize: 12, color: '#666', marginTop: 4 },
  swapRight: { alignItems: 'flex-end' },
  swapAmount: { fontSize: 15, color: '#fff' },
  swapStatus: { fontSize: 12, color: '#888', marginTop: 4, textTransform: 'capitalize' },
  statusComplete: { color: '#4ade80' },
  statusFailed: { color: '#f87171' },
  emptyText: { fontSize: 14, color: '#666', textAlign: 'center', paddingVertical: 24 },
})
