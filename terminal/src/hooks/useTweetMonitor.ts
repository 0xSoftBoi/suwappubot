import { useState, useEffect, useCallback, useRef } from 'react'
import type { TrackedTwitterAccount, TweetData } from '../types/api'

const STORAGE_KEY = 'suwappu_tweet_accounts'

const AVATAR_COLORS = [
  '#FF839B', '#627EEA', '#9945FF', '#22C55E', '#F0B90B',
  '#28A0F0', '#E84142', '#6FBCF0', '#EF49A0', '#6CF9D8',
]

const MOCK_TWEET_TEMPLATES = [
  { content: '$SOL looking incredibly strong here. Higher lows forming on the 4H. Breakout imminent.', sentiment: 'bullish' as const },
  { content: 'Just aped into $ETH at these levels. The merge narrative is back and stronger than ever.', sentiment: 'bullish' as const },
  { content: '$BTC dominance is rising. Alts about to get rekt. Be careful out there.', sentiment: 'bearish' as const },
  { content: 'Interesting on-chain data for $ARB today. Whale accumulation spotted on Arbitrum.', sentiment: 'neutral' as const },
  { content: '$DOGE and $SHIB pumping again. Classic retail fomo cycle. Taking profits here.', sentiment: 'bearish' as const },
  { content: 'The $SOL ecosystem is producing some incredible dApps. Long-term bullish on the Solana thesis.', sentiment: 'bullish' as const },
  { content: '$ETH gas fees are insane right now. L2s like $OP and $ARB are the play.', sentiment: 'neutral' as const },
  { content: '$AVAX subnet activity is quietly exploding. Nobody is talking about this yet.', sentiment: 'bullish' as const },
  { content: 'Markets looking choppy. $BTC stuck in a range. Not the time to be leveraged.', sentiment: 'bearish' as const },
  { content: 'New ATH for $SOL staking TVL. Validators are eating. This chain is not going anywhere.', sentiment: 'bullish' as const },
  { content: '$LINK oracle expansion continues. Every new chain integration = more demand. Simple as.', sentiment: 'bullish' as const },
  { content: 'Sold my $MATIC bag. Polygon zkEVM adoption is slower than expected.', sentiment: 'bearish' as const },
  { content: 'Watching $SUI closely. The Move ecosystem could surprise everyone this cycle.', sentiment: 'neutral' as const },
  { content: '$BTC weekly close above 100k would be extremely bullish. Bears running out of time.', sentiment: 'bullish' as const },
  { content: 'Funding rates are off the charts for $ETH perps. Expect a flush before continuation.', sentiment: 'bearish' as const },
  { content: 'Just bridged to $BASE. The ecosystem growth is real. Coinbase effect in full swing.', sentiment: 'bullish' as const },
  { content: 'DeFi TVL on $SOL just passed $15B. Jito, Marinade, and Jupiter leading the charge.', sentiment: 'bullish' as const },
  { content: 'Unpopular opinion: $ETH is overvalued relative to $SOL at current prices. Fight me.', sentiment: 'bearish' as const },
]

const TOKEN_REGEX = /\$[A-Z]{2,10}/g

function extractTokenMentions(text: string): string[] {
  const matches = text.match(TOKEN_REGEX)
  if (!matches) return []
  return [...new Set(matches.map(m => m.replace('$', '')))]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

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
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tweetIdCounter = useRef(0)

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

  const generateTweet = useCallback((): TweetData | null => {
    if (accounts.length === 0) return null

    const account = accounts[randomInt(0, accounts.length - 1)]
    const template = MOCK_TWEET_TEMPLATES[randomInt(0, MOCK_TWEET_TEMPLATES.length - 1)]
    tweetIdCounter.current += 1

    return {
      id: `tweet-${Date.now()}-${tweetIdCounter.current}`,
      authorHandle: account.handle,
      authorName: account.displayName,
      authorAvatarColor: account.avatarColor,
      content: template.content,
      tokenMentions: extractTokenMentions(template.content),
      sentiment: template.sentiment,
      likes: randomInt(50, 15000),
      retweets: randomInt(10, 5000),
      timestamp: new Date().toISOString(),
    }
  }, [accounts])

  // Generate mock tweets periodically
  useEffect(() => {
    if (accounts.length === 0) return

    // Generate an initial batch
    const initialBatch: TweetData[] = []
    for (let i = 0; i < 5; i++) {
      const tweet = generateTweet()
      if (tweet) {
        tweet.timestamp = new Date(Date.now() - (i * 60000 * randomInt(1, 10))).toISOString()
        tweet.id = `tweet-init-${i}`
        initialBatch.push(tweet)
      }
    }
    setTweets(prev => {
      if (prev.length > 0) return prev
      return initialBatch
    })

    const scheduleNext = () => {
      const delay = randomInt(10000, 20000)
      intervalRef.current = setTimeout(() => {
        const tweet = generateTweet()
        if (tweet) {
          setTweets(prev => [tweet, ...prev].slice(0, 50))
        }
        scheduleNext()
      }, delay)
    }

    scheduleNext()

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current)
    }
  }, [accounts.length, generateTweet])

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
