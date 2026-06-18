# Changelog

Notable changes to the Suwappu agent API, SDK, and docs. Dates are in UTC. Breaking changes are called out explicitly; the API is versioned under `/v1/agent`.

## 2026-06-18

- **Docs rebuilt for agents.** Every documentation page is now available as clean Markdown (append `.md` to any URL, or send `Accept: text/markdown`), with `llms.txt` and `llms-full.txt` indexes advertised via response headers.
- **OpenAPI 3.1 spec enriched.** Every operation now documents request/response examples, error responses (`401`/`402`/`422`/`429`/`500`), and reusable component schemas. Fetch it at `GET /v1/agent/openapi`.
- **Language examples** added across the API reference — cURL, TypeScript, and Python for every request.

## 2026-06-10

- **Tempo gasless swaps.** New users get their first swaps sponsored via Tempo fee-payer (type `0x76`) transactions — effectively gasless onboarding on TIP-20 stablecoins. Falls back to a normal user-paid swap when sponsorship is unavailable.
- **Machine Payments Protocol (MPP)** endpoints for browsing and paying micropayment services on Tempo.

## 2026-05-22

- **HyperLiquid, first-class.** Added perpetuals (`/perps`, up to 20x), one-click cross-chain funding to HyperCore (`/fund`), HYPE staking (`/stake`), vaults (`/vault`), TWAP orders (`/twap`), and spot trading (`/spot`).
- **HyperUnit** native BTC/ETH/SOL deposit routing for funding (region-gated).

## 2026-04-30

- **40+ chains.** Expanded best-price routing to 40+ networks, including Starknet, TRON, Tempo, and Bitcoin L2s, raced across LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, and CCTP.
- **MCP server + A2A agent card** published for agent discovery (`/.well-known/agent-card.json`).

## 2026-03-15

- **Agent API v1.** Public launch of the REST agent API: register, quote, swap, swap status, portfolio, and managed wallets with KMS-backed server-side signing.
