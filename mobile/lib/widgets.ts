/**
 * iOS Widget data provider.
 *
 * Expo doesn't natively support iOS widgets yet, but this module provides
 * the data layer that a native Swift widget extension would read via App Groups.
 *
 * For now, this writes portfolio summary data to shared UserDefaults
 * (via expo-secure-store) that a future Swift widget can read.
 *
 * Flow:
 *   1. App fetches portfolio → calls updateWidgetData()
 *   2. Data written to shared container (App Group)
 *   3. Native widget extension reads from same container
 *   4. WidgetKit reloads on data change
 */
import * as SecureStore from 'expo-secure-store'

const WIDGET_PORTFOLIO_KEY = 'widget_portfolio_data'
const WIDGET_PRICES_KEY = 'widget_token_prices'

export interface WidgetPortfolioData {
  totalUsdValue: number
  change24h: number
  topTokens: { symbol: string; value: number; change: number }[]
  updatedAt: string
}

export interface WidgetPriceData {
  symbol: string
  price: number
  change24h: number
}

/**
 * Write portfolio summary for the widget to read.
 * Called after each portfolio fetch.
 */
export async function updateWidgetPortfolio(data: WidgetPortfolioData): Promise<void> {
  await SecureStore.setItemAsync(WIDGET_PORTFOLIO_KEY, JSON.stringify(data))
}

/**
 * Write top token prices for the price widget.
 */
export async function updateWidgetPrices(prices: WidgetPriceData[]): Promise<void> {
  await SecureStore.setItemAsync(WIDGET_PRICES_KEY, JSON.stringify(prices))
}

/**
 * Read cached widget data (for debugging / preview).
 */
export async function getWidgetPortfolio(): Promise<WidgetPortfolioData | null> {
  const raw = await SecureStore.getItemAsync(WIDGET_PORTFOLIO_KEY)
  return raw ? JSON.parse(raw) : null
}
