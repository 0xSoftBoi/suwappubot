// Pure helpers for classifying a non-custodial wallet provider. Kept separate from
// AuthContext so the logic is unit-testable without a React tree or a live wallet.
//
// "external" = a software wallet (MetaMask / WalletConnect / Coinbase …); "ledger" =
// a Ledger hardware wallet. Both are keyless/client-signing — see EXTERNAL_PROVIDERS
// — so they share the build/record swap path; the tag only drives labelling/UX.

export type WalletProviderTag = 'external' | 'ledger'

// Providers whose swaps are signed client-side (the wallet/device signs, never the
// server). Anything in this set routes through the non-custodial build/record path.
export const EXTERNAL_PROVIDERS: readonly string[] = ['external', 'ledger']

// True when a connector belongs to a Ledger hardware device. The Connect Kit
// connector id is "ledgerConnectKit"; RainbowKit may expose "ledger" — match loosely.
export function isLedgerConnectorId(connectorId?: string | null): boolean {
  return !!connectorId && connectorId.toLowerCase().includes('ledger')
}

// Tag to record for a freshly connected external wallet, from its connector id.
export function resolveWalletProviderTag(connectorId?: string | null): WalletProviderTag {
  return isLedgerConnectorId(connectorId) ? 'ledger' : 'external'
}

// True for any keyless/client-signing provider (drives the non-custodial swap path).
export function isExternalProvider(provider?: string | null): boolean {
  return !!provider && EXTERNAL_PROVIDERS.includes(provider)
}
