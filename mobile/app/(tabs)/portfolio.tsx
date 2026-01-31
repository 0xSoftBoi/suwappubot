/**
 * Portfolio tab screen.
 *
 * Shows total balance, allocation bar, token list with values, and chain filter.
 * Tokens and swaps are tappable — navigate to token detail and transaction detail.
 */
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { api } from '../../lib/api'
import { useState, useCallback } from 'react'
import { AllocationBar } from '../../components/portfolio/AllocationBar'

export default function PortfolioScreen() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [chainFilter, setChainFilter] = useState<string | null>(null)

  const { data: portfolio, refetch } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
    refetchInterval: 30_000,
  })

  const { data: swaps } = useQuery({
    queryKey: ['swaps'],
    queryFn: () => api.getSwaps(10, 0),
  })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const tokens = portfolio?.tokens || []
  const filteredTokens = chainFilter
    ? tokens.filter(t => t.chain === chainFilter)
    : tokens

  const chains = [...new Set(tokens.map(t => t.chain))]
  const totalValue = portfolio?.totalUsdValue ?? 0

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      {/* Total Value */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Portfolio Value</Text>
        <Text style={styles.totalAmount}>
          ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        {/* Allocation Bar */}
        <AllocationBar tokens={tokens} totalValue={totalValue} />
      </View>

      {/* Chain Filter */}
      {chains.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
          <TouchableOpacity
            style={[styles.filterChip, !chainFilter && styles.filterChipActive]}
            onPress={() => setChainFilter(null)}
          >
            <Text style={[styles.filterText, !chainFilter && styles.filterTextActive]}>All</Text>
          </TouchableOpacity>
          {chains.map(chain => (
            <TouchableOpacity
              key={chain}
              style={[styles.filterChip, chainFilter === chain && styles.filterChipActive]}
              onPress={() => setChainFilter(chain === chainFilter ? null : chain)}
            >
              <Text style={[styles.filterText, chainFilter === chain && styles.filterTextActive]}>
                {chain}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Token List */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Assets</Text>
        {filteredTokens.length > 0 ? (
          filteredTokens.map((token, index) => (
            <TouchableOpacity
              key={`${token.address}-${token.chain}-${index}`}
              style={styles.tokenRow}
              onPress={() =>
                router.push({
                  pathname: '/(features)/token/[address]' as any,
                  params: { address: token.address, chain: token.chain, symbol: token.symbol },
                })
              }
            >
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                <Text style={styles.tokenChain}>{token.chain}</Text>
              </View>
              <View style={styles.tokenValues}>
                <Text style={styles.tokenBalance}>{token.balance}</Text>
                <Text style={styles.tokenUsd}>
                  ${token.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyText}>No tokens found</Text>
        )}
      </View>

      {/* Swap History */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Swaps</Text>
        {swaps && swaps.length > 0 ? (
          swaps.map(swap => (
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
                <Text style={styles.swapTokens}>{swap.fromToken} → {swap.toToken}</Text>
                <Text style={styles.swapDate}>
                  {new Date(swap.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.swapRight}>
                <Text style={styles.swapAmount}>{swap.fromAmount}</Text>
                <Text style={[
                  styles.swapStatus,
                  swap.status === 'completed' && styles.statusOk,
                  swap.status === 'failed' && styles.statusErr,
                ]}>
                  {swap.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyText}>No swap history</Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 24 },
  totalCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  totalLabel: { fontSize: 14, color: '#888', marginBottom: 8 },
  totalAmount: { fontSize: 36, fontWeight: '700', color: '#fff' },
  filters: { marginBottom: 16, flexGrow: 0 },
  filterChip: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: '#fff' },
  filterText: { color: '#888', fontSize: 13, fontWeight: '500', textTransform: 'capitalize' },
  filterTextActive: { color: '#000' },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 16 },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  tokenInfo: {},
  tokenSymbol: { fontSize: 16, fontWeight: '600', color: '#fff' },
  tokenChain: { fontSize: 12, color: '#666', marginTop: 2, textTransform: 'capitalize' },
  tokenValues: { alignItems: 'flex-end' },
  tokenBalance: { fontSize: 15, color: '#fff' },
  tokenUsd: { fontSize: 13, color: '#888', marginTop: 2 },
  swapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  swapTokens: { fontSize: 15, fontWeight: '500', color: '#fff' },
  swapDate: { fontSize: 12, color: '#666', marginTop: 4 },
  swapRight: { alignItems: 'flex-end' },
  swapAmount: { fontSize: 15, color: '#fff' },
  swapStatus: { fontSize: 12, color: '#888', marginTop: 4, textTransform: 'capitalize' },
  statusOk: { color: '#4ade80' },
  statusErr: { color: '#f87171' },
  emptyText: { fontSize: 14, color: '#666', textAlign: 'center', paddingVertical: 24 },
})
