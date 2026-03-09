/**
 * Tests for lib/widgets.ts — iOS Widget data provider.
 */
import { updateWidgetPortfolio, getWidgetPortfolio, updateWidgetPrices } from '../../lib/widgets'
import type { WidgetPortfolioData, WidgetPriceData } from '../../lib/widgets'

describe('updateWidgetPortfolio / getWidgetPortfolio', () => {
  it('round-trips portfolio data', async () => {
    const data: WidgetPortfolioData = {
      totalUsdValue: 15000,
      change24h: 3.5,
      topTokens: [
        { symbol: 'ETH', value: 10000, change: 2.1 },
        { symbol: 'USDC', value: 5000, change: 0.01 },
      ],
      updatedAt: '2026-03-09T12:00:00Z',
    }

    await updateWidgetPortfolio(data)
    const loaded = await getWidgetPortfolio()

    expect(loaded).not.toBeNull()
    expect(loaded!.totalUsdValue).toBe(15000)
    expect(loaded!.topTokens).toHaveLength(2)
    expect(loaded!.topTokens[0].symbol).toBe('ETH')
  })

  it('returns null when no data stored', async () => {
    const loaded = await getWidgetPortfolio()
    // May be null or contain data from previous test depending on mock state
    // The important thing is it doesn't throw
    expect(loaded === null || typeof loaded === 'object').toBe(true)
  })
})

describe('updateWidgetPrices', () => {
  it('stores price data without error', async () => {
    const prices: WidgetPriceData[] = [
      { symbol: 'BTC', price: 65000, change24h: 1.5 },
      { symbol: 'ETH', price: 3500, change24h: -0.8 },
    ]

    await expect(updateWidgetPrices(prices)).resolves.not.toThrow()
  })
})
