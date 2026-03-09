/**
 * Tests for lib/spotlight.ts — Spotlight search indexing.
 */
import { buildSpotlightItems, saveSpotlightIndex, getSpotlightIndex } from '../../lib/spotlight'

describe('buildSpotlightItems', () => {
  it('builds items from portfolio tokens', () => {
    const tokens = [
      { symbol: 'ETH', name: 'Ethereum', address: '0xabc', chain: 'ethereum', balance: '1.5', usdValue: 3000 },
      { symbol: 'USDC', name: 'USD Coin', address: '0xdef', chain: 'base', balance: '500', usdValue: 500 },
    ]

    const items = buildSpotlightItems(tokens)

    expect(items).toHaveLength(2)
    expect(items[0].uniqueId).toBe('token-ethereum-0xabc')
    expect(items[0].title).toBe('ETH — $3000.00')
    expect(items[0].url).toContain('suwappu://token/0xabc')
    expect(items[0].keywords).toContain('ETH')
    expect(items[0].keywords).toContain('ethereum')
    expect(items[1].uniqueId).toBe('token-base-0xdef')
  })

  it('returns empty array for empty portfolio', () => {
    expect(buildSpotlightItems([])).toEqual([])
  })
})

describe('saveSpotlightIndex / getSpotlightIndex', () => {
  it('round-trips items through SecureStore', async () => {
    const items = buildSpotlightItems([
      { symbol: 'SOL', name: 'Solana', address: 'So1abc', chain: 'solana', balance: '10', usdValue: 1500 },
    ])

    await saveSpotlightIndex(items)
    const loaded = await getSpotlightIndex()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].uniqueId).toBe('token-solana-So1abc')
  })

  it('returns empty array when nothing indexed', async () => {
    const loaded = await getSpotlightIndex()
    expect(loaded).toEqual([])
  })
})
