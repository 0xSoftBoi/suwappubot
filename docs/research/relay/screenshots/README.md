# Relay screenshots (captured 2026-09-07, 1440px desktop)

The marketing site (relay.link, /bridge, /blog, /developers) sits behind a Vercel Security Checkpoint that blocks headless capture from this environment; docs and status pages were captured. Each image has a sibling .txt with the page's extracted text.

- `docs-api-keys.jpg` — API keys and Rate Limits - Relay — https://docs.relay.link/references/api/api-keys
- `docs-app-fees.jpg` — App Fees - Relay — https://docs.relay.link/features/app-fees
- `docs-changelog.jpg` — Changelog - Relay — https://docs.relay.link/changelog
- `docs-fee-sponsorship.jpg` — Fee Sponsorship - Relay — https://docs.relay.link/features/fee-sponsorship
- `docs-quickstart.jpg` — Quickstart - Relay — https://docs.relay.link/references/api/quickstart
- `docs-quote-v2.jpg` — Get Quote - Relay — https://docs.relay.link/references/api/get-quote-v2
- `docs-solana.jpg` — Solana Support - Relay — https://docs.relay.link/references/api/api_guides/solana
- `docs-webhooks.jpg` — Webhooks - Relay — https://docs.relay.link/references/api/api_guides/webhooks
- `docs-fees.png` — 403: Forbidden — https://docs.relay.link/how-it-works/fees
- `docs-gasless.png` — 403: Forbidden — https://docs.relay.link/features/gasless-execution
- `docs-home.png` — Relay Docs - Relay — https://docs.relay.link/
- `docs-how-relay-works.png` — How Relay Works - Relay — https://docs.relay.link/how-relay-works
- `docs-hyperliquid.png` — 403: Forbidden — https://docs.relay.link/references/api/api_guides/hyperliquid-support
- `docs-protocol-overview.png` — Relay Settlement - Relay — https://docs.relay.link/references/protocol/overview
- `docs-protocol-security.png` — Security & Audits - Relay — https://docs.relay.link/references/protocol/security
- `docs-rate-limits.png` — Handling Rate Limits - Relay — https://docs.relay.link/references/api/api_core_concepts/handling-rate-limits
- `docs-refunds.png` — Refunds - Relay — https://docs.relay.link/references/api/api_core_concepts/refunds
- `docs-relaykit-overview.png` — Overview - Relay — https://docs.relay.link/references/relay-kit/overview
- `docs-supported-chains.png` — Supported Chains - Relay — https://docs.relay.link/references/api/api_resources/supported-chains
- `docs-vaults.png` — Overview - Relay — https://docs.relay.link/references/protocol/vaults/overview
- `status.png` — Relay Status — https://status.relay.link/

## Relay SwapWidget, rendered locally from the published npm package

`@relayprotocol/relay-kit-ui@11.0.6` mounted in a scratch React page and screenshotted against the live API (see `16-widget-render.md`). The widget itself requires an API key because it always sends `referrer`; for these renders the referrer was stripped so the unauthenticated quote path (the one our bot uses) shows real numbers.

- `widget-dark-quote-usdc-eth.png` — (?theme=dark&amount=25)
- `widget-dark-quote-usdc-sol.png` — (?theme=dark&amount=25&to=sol)
- `widget-fee-breakdown.png` — (?theme=dark&amount=25)
- `widget-light-quote.png` — (?theme=light&amount=250)
- `widget-mobile-quote.png` — (?theme=dark&amount=25)
- `widget-mobile-selector.png` — (?theme=dark&amount=25)
- `widget-token-selector.png` — (?theme=dark&amount=25)
