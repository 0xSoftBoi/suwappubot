/**
 * Coinbase Onramp — the "add money with a card" entry point for a cold-start
 * user with no crypto.
 *
 * Deliberately the hosted redirect flow, not the native SDK: this app must
 * keep building without a native rebuild (see CLAUDE.md), so this module
 * only ever produces a URL. The caller opens it with `Linking.openURL`
 * (already a dependency — `expo-web-browser` is not in package.json, so we
 * don't add it) and the OS hands the user to Safari/Chrome for the actual
 * card entry and KYC, which Coinbase owns entirely. Gecko never sees card
 * details, never touches KYC, and never custodies the fiat leg.
 *
 * Hard rule: if the app id isn't configured, `buildOnrampUrl` returns null
 * and every call site must hide the entry point. Never fall back to a
 * hardcoded or guessed app id — that would either silently misattribute
 * transactions or send users into a broken widget.
 */
import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>

/** Coinbase Developer Platform "Project ID" for Onramp, following the same
 * env-then-app.json-extra pattern as API_BASE_URL in ./config.ts. */
export const ONRAMP_APP_ID =
  process.env.EXPO_PUBLIC_ONRAMP_APP_ID ?? (extra.onrampAppId as string | undefined) ?? undefined

/** Asset and network are fixed, not user-chosen: USDC on Base is the only
 * balance the rest of this app (Send, Earn, Receive) understands. */
const ONRAMP_ASSET = 'USDC'
const ONRAMP_NETWORK = 'base'
const ONRAMP_HOST = 'https://pay.coinbase.com/buy/select-asset'

export function isOnrampConfigured(): boolean {
  return Boolean(ONRAMP_APP_ID && ONRAMP_APP_ID.trim().length > 0)
}

/**
 * Builds the hosted Coinbase Onramp URL for a one-time card purchase that
 * lands directly in the user's own wallet. Returns null — never a partially
 * built or placeholder URL — if the app isn't configured or no destination
 * address is available yet, so a caller can only ever render a real, working
 * link or nothing at all.
 */
export function buildOnrampUrl(destinationAddress: string): string | null {
  if (!isOnrampConfigured()) return null
  if (!destinationAddress) return null

  const params = new URLSearchParams({
    appId: ONRAMP_APP_ID as string,
    addresses: JSON.stringify({ [destinationAddress]: [ONRAMP_NETWORK] }),
    assets: JSON.stringify([ONRAMP_ASSET]),
    defaultAsset: ONRAMP_ASSET,
    defaultNetwork: ONRAMP_NETWORK,
    // No preset amount — this app never promises a rate or return, and
    // never nudges toward a specific spend.
  })

  return `${ONRAMP_HOST}?${params.toString()}`
}
