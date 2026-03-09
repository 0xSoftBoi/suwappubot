/**
 * Siri Shortcuts donation for common actions.
 *
 * "Donates" user activities to Siri so they appear as suggested shortcuts.
 * Uses expo-linking deep links as the action URLs.
 *
 * Supported shortcuts:
 *   - "Swap ETH to USDC" → opens swap pre-filled
 *   - "Check my portfolio" → opens portfolio tab
 *   - "Show Bitcoin price" → opens BTC token detail
 *
 * The actual NSUserActivity donation requires a native bridge.
 * This module defines the shortcut registry and deep link mapping.
 */

export interface SiriShortcut {
  /** Unique activity type identifier */
  activityType: string
  /** What Siri says / displays */
  title: string
  /** Suggested invocation phrase */
  suggestedPhrase: string
  /** Deep link into the app */
  url: string
  /** Whether this shortcut is eligible for Siri suggestions */
  isEligibleForSearch: boolean
  isEligibleForPrediction: boolean
}

/**
 * Pre-defined shortcuts that get donated based on user behavior.
 */
export const SHORTCUTS: SiriShortcut[] = [
  {
    activityType: 'xyz.suwappu.app.swap',
    title: 'Swap Tokens',
    suggestedPhrase: 'Swap crypto on Suwappu',
    url: 'suwappu://swap',
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  },
  {
    activityType: 'xyz.suwappu.app.portfolio',
    title: 'Check Portfolio',
    suggestedPhrase: 'Check my crypto portfolio',
    url: 'suwappu://portfolio',
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  },
  {
    activityType: 'xyz.suwappu.app.price.btc',
    title: 'Bitcoin Price',
    suggestedPhrase: 'Show Bitcoin price',
    url: 'suwappu://token/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599?chain=ethereum&symbol=BTC',
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  },
  {
    activityType: 'xyz.suwappu.app.price.eth',
    title: 'Ethereum Price',
    suggestedPhrase: 'Show Ethereum price',
    url: 'suwappu://token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2?chain=ethereum&symbol=ETH',
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  },
  {
    activityType: 'xyz.suwappu.app.alerts',
    title: 'Price Alerts',
    suggestedPhrase: 'Check my price alerts',
    url: 'suwappu://alerts',
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  },
]

/**
 * Build a custom swap shortcut from user behavior.
 * Called after a successful swap to donate the specific pair to Siri.
 */
export function buildSwapShortcut(
  fromSymbol: string,
  toSymbol: string,
  chain: string,
): SiriShortcut {
  return {
    activityType: `xyz.suwappu.app.swap.${fromSymbol.toLowerCase()}.${toSymbol.toLowerCase()}`,
    title: `Swap ${fromSymbol} to ${toSymbol}`,
    suggestedPhrase: `Swap ${fromSymbol} to ${toSymbol}`,
    url: `suwappu://swap?from=${fromSymbol}&to=${toSymbol}&chain=${chain}`,
    isEligibleForSearch: true,
    isEligibleForPrediction: true,
  }
}

/**
 * Donate a shortcut to Siri.
 * TODO: Implement with native NSUserActivity bridge.
 */
export function donateShortcut(_shortcut: SiriShortcut): void {
  // TODO: Native bridge call
  // NativeModules.SiriShortcutsBridge.donateActivity(shortcut)
}

/**
 * Donate all default shortcuts on app launch.
 */
export function donateDefaultShortcuts(): void {
  SHORTCUTS.forEach(donateShortcut)
}
