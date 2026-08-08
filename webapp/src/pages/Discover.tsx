import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { MiniChart } from '../components/charts/MiniChart'
import { SkeletonCard, AnimatedListItem } from '../components/ui'
import { useTrendingTokens } from '../hooks/useChart'
import type { LineData, Time } from 'lightweight-charts'
import { api, type JellyCard, type JellyClaim, type JellyClaimChallenge } from '../lib/api'

const CHAIN_FILTERS = [
  { id: undefined, label: 'All' },
  { id: 'ethereum', label: 'ETH' },
  { id: 'solana', label: 'SOL' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'ARB' },
  { id: 'tempo', label: 'Tempo' },
  { id: 'bsc', label: 'BSC' },
  { id: 'sui', label: 'SUI' },
  { id: 'monad', label: 'MON' },
  { id: 'berachain', label: 'BERA' },
]

// Format price with appropriate decimals
function formatPrice(price: number): string {
  if (price < 0.0001) return `$${price.toExponential(2)}`
  if (price < 1) return `$${price.toFixed(6)}`
  if (price < 100) return `$${price.toFixed(4)}`
  return `$${price.toFixed(2)}`
}

// Generate sparkline data from a token's price history
function generateSparkline(token: { sparkline?: Array<{ time: number; value: number }>; price?: number; priceChange24h?: number }): LineData<Time>[] {
  if (token.sparkline && token.sparkline.length > 0) {
    return token.sparkline.map((p) => ({
      time: p.time as Time,
      value: p.value,
    }))
  }
  // Fallback: generate simple two-point line from price change
  const now = Math.floor(Date.now() / 1000)
  const dayAgo = now - 86400
  const currentPrice = token.price || 1
  const change = token.priceChange24h || 0
  const prevPrice = currentPrice / (1 + change / 100)
  return [
    { time: dayAgo as Time, value: prevPrice },
    { time: now as Time, value: currentPrice },
  ]
}

export default function Discover() {
  const navigate = useNavigate()
  const [chainFilter, setChainFilter] = useState<string | undefined>(undefined)
  const [socialQuery, setSocialQuery] = useState('')
  const [jellies, setJellies] = useState<JellyCard[]>([])
  const [socialLoading, setSocialLoading] = useState(false)
  const [socialError, setSocialError] = useState<string | null>(null)
  const [claimChallenge, setClaimChallenge] = useState<JellyClaimChallenge | null>(null)
  const [claimJellyUrl, setClaimJellyUrl] = useState('')
  const [claim, setClaim] = useState<JellyClaim | null>(null)
  const [claimLoading, setClaimLoading] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const { data: trendingData, isLoading } = useTrendingTokens(chainFilter)

  const tokens = trendingData || []

  const header = <AppHeader title="Discover" />

  useEffect(() => {
    let current = true
    api.getMyJellyClaim()
      .then(({ claim: existingClaim }) => {
        if (current) setClaim(existingClaim)
      })
      // Browsing is public; a Telegram-only or signed-out session simply has
      // no profile claim to show yet.
      .catch(() => undefined)
    return () => { current = false }
  }, [])

  const searchSocial = async (event: FormEvent) => {
    event.preventDefault()
    if (!socialQuery.trim()) return
    setSocialLoading(true)
    setSocialError(null)
    try {
      const result = await api.searchJellies(socialQuery.trim())
      setJellies(result.items)
    } catch {
      setSocialError('Social feed is unavailable right now. Try again shortly.')
    } finally {
      setSocialLoading(false)
    }
  }

  const startJellyClaim = async () => {
    setClaimLoading(true)
    setClaimError(null)
    try {
      setClaimChallenge(await api.createJellyClaimChallenge())
      setClaimJellyUrl('')
    } catch {
      setClaimError('Connect and sign in with a wallet before claiming a Jelly account.')
    } finally {
      setClaimLoading(false)
    }
  }

  const verifyJellyClaim = async (event: FormEvent) => {
    event.preventDefault()
    if (!claimChallenge || !claimJellyUrl.trim()) return
    setClaimLoading(true)
    setClaimError(null)
    try {
      const result = await api.verifyJellyClaim(claimChallenge.challengeId, claimJellyUrl.trim())
      setClaim(result.claim)
      setClaimChallenge(null)
      setClaimJellyUrl('')
    } catch {
      setClaimError('We could not verify that public Jelly. Check the phrase, URL, and account, then start a fresh claim.')
    } finally {
      setClaimLoading(false)
    }
  }

  const removeJellyClaim = async () => {
    setClaimLoading(true)
    setClaimError(null)
    try {
      await api.removeMyJellyClaim()
      setClaim(null)
    } catch {
      setClaimError('We could not remove this claim right now. Try again shortly.')
    } finally {
      setClaimLoading(false)
    }
  }

  return (
    <AppLayout header={header} activeNav="discover">
      <div className="p-3 space-y-3 pb-20">
        {/* JellyJelly is a public social-content integration, not a login provider. */}
        <section className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-3 border-b border-suwappu-sakura-mid/10">
            <p className="font-heading font-semibold text-sm text-suwappu-purple-deep">Social pulse</p>
            <p className="text-xs text-suwappu-text-secondary mt-0.5">Real public JellyJelly moments—always linked back to their source. No video uploads.</p>
            <form className="flex gap-2 mt-3" onSubmit={searchSocial}>
              <input value={socialQuery} onChange={(e) => setSocialQuery(e.target.value)} placeholder="Search creators or conversations" className="min-w-0 flex-1 px-3 py-2 text-sm rounded-suwappu-lg border border-suwappu-sakura-mid/30 focus:outline-none focus:border-suwappu-magenta-mid" />
              <button type="submit" disabled={socialLoading || !socialQuery.trim()} className="px-3 py-2 text-sm font-semibold rounded-suwappu-lg bg-suwappu-gradient text-white disabled:opacity-50">{socialLoading ? 'Searching' : 'Search'}</button>
            </form>
          </div>
          {socialError && <p className="px-3 py-3 text-sm text-red-500">{socialError}</p>}
          {jellies.length > 0 && <div className="divide-y divide-suwappu-sakura-mid/10">{jellies.map((jelly) => (
            <a key={jelly.id} href={jelly.watchUrl || 'https://jellyjelly.com'} target="_blank" rel="noreferrer" className="block px-3 py-3 hover:bg-suwappu-sakura-light/30">
              <div className="flex items-center gap-2">
                <p className="font-heading font-semibold text-sm text-suwappu-text">{jelly.title}</p>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-suwappu-magenta-mid">Jelly-native</span>
              </div>
              {jelly.username && <p className="text-xs text-suwappu-magenta-mid mt-0.5">@{jelly.username}</p>}
              {jelly.summary && <p className="text-xs text-suwappu-text-secondary mt-1 line-clamp-2">{jelly.summary}</p>}
            </a>
          ))}</div>}
          <div className="px-3 py-3 border-t border-suwappu-sakura-mid/10 bg-suwappu-sakura-light/20">
            <p className="font-heading font-semibold text-sm text-suwappu-purple-deep">Claim your Jelly account</p>
            <p className="text-xs text-suwappu-text-secondary mt-0.5">Prove the public account is yours with a wallet-backed Suwappu session and a real Jelly you record on JellyJelly.</p>
            {claim && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-suwappu-lg bg-white px-3 py-2 border border-suwappu-sakura-mid/20">
                <a href={claim.watchUrl} target="_blank" rel="noreferrer" className="min-w-0 text-sm font-semibold text-suwappu-magenta-mid truncate">@{claim.username} · linked</a>
                <button type="button" onClick={removeJellyClaim} disabled={claimLoading} className="shrink-0 text-xs font-semibold text-suwappu-text-secondary hover:text-red-500 disabled:opacity-50">Unlink</button>
              </div>
            )}
            {!claim && !claimChallenge && (
              <button type="button" onClick={startJellyClaim} disabled={claimLoading} className="mt-3 px-3 py-2 text-sm font-semibold rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/30 text-suwappu-purple-deep hover:border-suwappu-magenta-mid disabled:opacity-50">{claimLoading ? 'Preparing proof' : 'Claim my Jelly account'}</button>
            )}
            {!claim && claimChallenge && (
              <form className="mt-3 space-y-2" onSubmit={verifyJellyClaim}>
                <p className="text-xs text-suwappu-text">Say this exact phrase in a new public Jelly:</p>
                <code className="block rounded-suwappu-lg bg-suwappu-purple-deep px-3 py-2 text-xs text-white break-all">{claimChallenge.phrase}</code>
                <a href="https://jellyjelly.com" target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-suwappu-magenta-mid">Record on JellyJelly ↗</a>
                <input value={claimJellyUrl} onChange={(e) => setClaimJellyUrl(e.target.value)} placeholder="https://jellyjelly.com/watch/..." className="w-full px-3 py-2 text-sm rounded-suwappu-lg border border-suwappu-sakura-mid/30 focus:outline-none focus:border-suwappu-magenta-mid" />
                <button type="submit" disabled={claimLoading || !claimJellyUrl.trim()} className="px-3 py-2 text-sm font-semibold rounded-suwappu-lg bg-suwappu-gradient text-white disabled:opacity-50">{claimLoading ? 'Verifying' : 'Verify public Jelly'}</button>
              </form>
            )}
            {claimError && <p className="mt-2 text-xs text-red-500">{claimError}</p>}
          </div>
        </section>
        {/* Chain filter tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {CHAIN_FILTERS.map(chain => (
            <button
              key={chain.label}
              onClick={() => setChainFilter(chain.id)}
              className={`px-3 py-1.5 text-xs font-heading font-semibold rounded-suwappu-pill whitespace-nowrap transition-colors ${
                chainFilter === chain.id
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                  : 'bg-white text-suwappu-text-secondary border border-suwappu-sakura-mid/20 hover:border-suwappu-magenta-mid'
              }`}
            >
              {chain.label}
            </button>
          ))}
        </div>

        {/* Trending tokens */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Trending Tokens</span>
          </div>

          {isLoading ? (
            <SkeletonCard rows={5} variant="token" />
          ) : tokens.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-suwappu-text-secondary">No trending tokens found</p>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token, index) => (
                <AnimatedListItem key={`${token.chainId}-${token.tokenAddress}`} index={index}>
                  <button
                    onClick={() => navigate(`/token/${token.chainId}/${token.tokenAddress}`)}
                    className="w-full flex items-center gap-3 px-3 py-3 hover:bg-suwappu-sakura-light/30 transition-colors text-left"
                  >
                    {/* Token icon */}
                    <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-sm font-bold text-suwappu-magenta-mid shrink-0 overflow-hidden">
                      {token.icon ? (
                        <img src={token.icon} alt={token.symbol || ''} className="w-full h-full object-cover" />
                      ) : (
                        (token.symbol || '??').slice(0, 2)
                      )}
                    </div>

                    {/* Token info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-semibold text-sm text-suwappu-text truncate">{token.name || 'Unknown'}</p>
                      <p className="text-xs text-suwappu-text-secondary">{token.symbol || ''}</p>
                    </div>

                    {/* Mini chart */}
                    <div className="shrink-0">
                      <MiniChart data={generateSparkline(token)} />
                    </div>

                    {/* Price info */}
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-heading font-semibold text-sm text-suwappu-text">
                        {formatPrice(token.price || 0)}
                      </p>
                      <p className={`text-xs font-semibold ${
                        (token.priceChange24h || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                      }`}>
                        {(token.priceChange24h || 0) >= 0 ? '+' : ''}{(token.priceChange24h || 0).toFixed(2)}%
                      </p>
                    </div>
                  </button>
                </AnimatedListItem>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
