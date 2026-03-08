/**
 * Token discovery screen — Trending / Gainers / New tabs with search.
 */
import { useState, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { Stack } from 'expo-router'
import { TokenSearchBar } from '../../../components/discovery/TokenSearchBar'
import { TrendingTokenRow } from '../../../components/discovery/TrendingTokenRow'
import { useTrendingTokens, useGainerTokens, useNewTokens, useTokenSearch } from '../../../hooks/useTokenDiscovery'
import { colors, spacing, radius } from '../../../lib/theme'

type Tab = 'trending' | 'gainers' | 'new'

export default function DiscoverScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('trending')
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const trending = useTrendingTokens()
  const gainers = useGainerTokens()
  const newTokens = useNewTokens()
  const searchResults = useTokenSearch(searchQuery)

  const isSearching = searchQuery.length >= 2

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([trending.refetch(), gainers.refetch(), newTokens.refetch()])
    setRefreshing(false)
  }, [trending, gainers, newTokens])

  const activeData = isSearching
    ? searchResults.data
    : activeTab === 'trending'
      ? trending.data
      : activeTab === 'gainers'
        ? gainers.data
        : newTokens.data

  const isLoading = isSearching
    ? searchResults.isLoading
    : activeTab === 'trending'
      ? trending.isLoading
      : activeTab === 'gainers'
        ? gainers.isLoading
        : newTokens.isLoading

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Discover' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Search */}
        <TokenSearchBar onSearch={setSearchQuery} />

        {/* Tab pills */}
        {!isSearching && (
          <View style={styles.tabs}>
            {(['trending', 'gainers', 'new'] as Tab[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === 'trending' ? 'Trending' : tab === 'gainers' ? 'Gainers' : 'New'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isSearching && searchQuery.length >= 2 && (
          <Text style={styles.sectionLabel}>Search results for "{searchQuery}"</Text>
        )}

        {/* List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.text} size="large" />
          </View>
        ) : activeData && activeData.length > 0 ? (
          activeData.map((token, i) => (
            <TrendingTokenRow
              key={`${token.address}-${token.chain}`}
              token={token}
              rank={!isSearching ? i + 1 : undefined}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>
            {isSearching ? 'No tokens found' : 'No data available'}
          </Text>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: spacing.lg, paddingBottom: 40 },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  sectionLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  loadingContainer: { paddingTop: 60, alignItems: 'center' },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingTop: 60,
  },
})
