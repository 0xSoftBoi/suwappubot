import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type SentimentFilter = 'all' | 'bullish' | 'bearish' | 'neutral'

const ACCOUNTS_KEY = ['tweet-monitor', 'accounts'] as const
const FEED_KEY = ['tweet-monitor', 'feed'] as const

export function useTweetMonitor() {
  const queryClient = useQueryClient()
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')

  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: api.getTrackedTwitterAccounts,
    staleTime: 15_000,
  })

  const tweetsQuery = useQuery({
    queryKey: FEED_KEY,
    queryFn: api.getTweetFeed,
    staleTime: 15_000,
  })

  const addAccountMutation = useMutation({
    mutationFn: api.addTrackedTwitterAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })

  const removeAccountMutation = useMutation({
    mutationFn: api.removeTrackedTwitterAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      queryClient.invalidateQueries({ queryKey: FEED_KEY })
    },
  })

  const accounts = accountsQuery.data ?? []
  const allTweets = tweetsQuery.data ?? []
  const tweets = useMemo(() => (
    sentimentFilter === 'all'
      ? allTweets
      : allTweets.filter(tweet => tweet.sentiment === sentimentFilter)
  ), [allTweets, sentimentFilter])

  const addAccount = useCallback((handle: string) => {
    addAccountMutation.mutate(handle)
  }, [addAccountMutation])

  const removeAccount = useCallback((handle: string) => {
    removeAccountMutation.mutate(handle)
  }, [removeAccountMutation])

  return {
    accounts,
    tweets,
    allTweets,
    sentimentFilter,
    setSentimentFilter,
    addAccount,
    removeAccount,
    isLoading: accountsQuery.isLoading || tweetsQuery.isLoading,
    isSaving: addAccountMutation.isPending || removeAccountMutation.isPending,
    error: accountsQuery.error || tweetsQuery.error || addAccountMutation.error || removeAccountMutation.error,
  }
}
