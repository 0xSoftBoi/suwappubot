/**
 * Spotlight search indexing for owned tokens.
 *
 * Uses expo-linking to create deep links that open token detail screens.
 * When CoreSpotlight API is available (via native module), this indexes
 * the user's token holdings so they can be found via iOS Spotlight search.
 *
 * For now, provides the data layer. A native Swift bridge can consume
 * these items via CoreSpotlight's CSSearchableIndex.
 */
import * as SecureStore from 'expo-secure-store'

const SPOTLIGHT_INDEX_KEY = 'spotlight_indexed_tokens'

export interface SpotlightItem {
  uniqueId: string
  title: string
  description: string
  /** Deep link into the app */
  url: string
  /** Optional keywords for search matching */
  keywords: string[]
}

/**
 * Build spotlight items from the user's portfolio tokens.
 */
export function buildSpotlightItems(
  tokens: { symbol: string; name: string; address: string; chain: string; balance: string; usdValue: number }[],
): SpotlightItem[] {
  return tokens.map((t) => ({
    uniqueId: `token-${t.chain}-${t.address}`,
    title: `${t.symbol} — $${t.usdValue.toFixed(2)}`,
    description: `${t.balance} ${t.symbol} on ${t.chain}`,
    url: `suwappu://token/${t.address}?chain=${t.chain}&symbol=${t.symbol}`,
    keywords: [t.symbol, t.name, t.chain, 'crypto', 'token', 'balance'],
  }))
}

/**
 * Persist indexed items so the native layer knows what's been indexed.
 */
export async function saveSpotlightIndex(items: SpotlightItem[]): Promise<void> {
  await SecureStore.setItemAsync(SPOTLIGHT_INDEX_KEY, JSON.stringify(items))
}

/**
 * Get currently indexed items.
 */
export async function getSpotlightIndex(): Promise<SpotlightItem[]> {
  const raw = await SecureStore.getItemAsync(SPOTLIGHT_INDEX_KEY)
  return raw ? JSON.parse(raw) : []
}

/**
 * Index user's portfolio tokens for Spotlight.
 * Call this after portfolio data loads.
 */
export async function indexPortfolioForSpotlight(
  tokens: { symbol: string; name: string; address: string; chain: string; balance: string; usdValue: number }[],
): Promise<void> {
  const items = buildSpotlightItems(tokens)
  await saveSpotlightIndex(items)

  // TODO: When a native CoreSpotlight bridge is added:
  // CSSearchableIndex.default().indexSearchableItems(items.map(toCSSearchableItem))
}
