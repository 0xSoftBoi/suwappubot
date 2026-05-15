import { useState, useCallback } from 'react'
import type { TrackedTwitterAccount, TweetData } from '../types/api'

const STORAGE_KEY = 'suwappu_tweet_accounts'

const AVATAR_COLORS = [
  '#FF839B', '#627EEA', '#9945FF', '#22C55E', '#F0B90B',
  '#28A0F0', '#E84142', '#6FBCF0', '#EF49A0', '#6CF9D8',
]

function loadAccounts(): TrackedTwitterAccount[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore
  }
  return []
}

function saveAccounts(accounts: TrackedTwitterAccount[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
}

export type SentimentFilter = 'all' | 'bullish' | 'bearish' | 'neutral'

export function useTweetMonitor() {
  const [accounts, setAccounts] = useState<TrackedTwitterAccount[]>(loadAccounts)
  const [tweets, setTweets] = useState<TweetData[]>([])
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')

  const addAccount = useCallback((handle: string) => {
    const clean = handle.replace(/^@/, '').trim()
    if (!clean) return

    setAccounts(prev => {
      if (prev.some(a => a.handle.toLowerCase() === clean.toLowerCase())) return prev
      const next = [
        ...prev,
        {
          handle: clean,
          displayName: clean.charAt(0).toUpperCase() + clean.slice(1),
          avatarColor: AVATAR_COLORS[prev.length % AVATAR_COLORS.length],
          addedAt: new Date().toISOString(),
        },
      ]
      saveAccounts(next)
      return next
    })
  }, [])

  const removeAccount = useCallback((handle: string) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.handle !== handle)
      saveAccounts(next)
      return next
    })
    setTweets(prev => prev.filter(t => t.authorHandle !== handle))
  }, [])

  const filteredTweets = sentimentFilter === 'all'
    ? tweets
    : tweets.filter(t => t.sentiment === sentimentFilter)

  return {
    accounts,
    tweets: filteredTweets,
    allTweets: tweets,
    sentimentFilter,
    setSentimentFilter,
    addAccount,
    removeAccount,
  }
}
