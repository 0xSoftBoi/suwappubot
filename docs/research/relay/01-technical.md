# Relay — technical deep dive (lifecycle, protocol, solvers, vaults, features, SDK)

Sources: docs.relay.link, read 2026-09-07. Cross-reference: `04-live-api-probe.md` (measured behaviour), `07-changelog-timeline.md` (shipping cadence), `05-integration-spec.md` (what we built).

## 1. Transaction lifecycle
Four stages: **Quote → Execution → Fill → Settlement**.
- Quote: the app asks for expected result, cost, and steps.
- Execution: the user signs the steps. Cross-chain, funds and the order are deposited into the **Relay Depository** contract.
- Fill: a solver completes the action on the destination chain while the user's funds sit escrowed in the Depository.
- Settlement: "After the solver proves the fill onchain, the protocol releases the deposited funds to the solver."

This is non-custodial via escrow, not trustless: funds are locked in a Relay-controlled contract until proof of fill. It matches the depository (`0x4cd0…`) and orderId/solver fields observed live.
https://docs.relay.link/how-relay-works

## 2. Relay Settlement (protocol overview)
Settlement is hub-based, not point-to-point: "instead of settlement happening point-to-point between the origin and destination, it all happens on the Relay Chain." An **Oracle** attests fills; "the solver's Hub balance updates as soon as the Oracle attests the fill". That is what lets solvers fill in 1–6 seconds. Components: Depository (non-upgradable, per chain), Oracle (authorized signers), Hub (deterministic contract on Relay Chain), Allocator (MPC-signed withdrawals matching Hub balances), Security Council (multisig that can pause withdrawers). Audits: Spearbit (Feb 2025, Depository), Certora (Jun 2025, Depository), Zellic (Nov 2025, Settlement), Zellic (Apr 2026, Oracle).
https://docs.relay.link/references/protocol/overview · https://docs.relay.link/references/protocol/security

## 3. Solvers: permissioned or not?
Docs call solvers "relayers", the liquidity providers filling orders; fills "can be as gas-efficient as a standard transfer". **The onboarding model (permissionless vs curated, bonding) is not disclosed.** Empirically (`06-firehose-intel.md`) one solver address filled 97.7% of a 3,000-request sample and only two addresses appeared at all. Treat the solver set as effectively centralized today; do not claim otherwise in messaging either way.
https://docs.relay.link/references/protocol/guides/for-solvers

## 4. Relay Vaults / RelayPool
Permissionless ERC-4626 yield pools that solvers draw on for rebalancing capital, layered on lending markets (Aave). Dual yield: base (lending) plus boost (when solvers use the capital). UI at relay.link/vaults, indexer at vaults-api.relay.link. Live only on Ethereum mainnet and Arbitrum. Risk disclosures and withdrawal mechanics not surfaced: UNVERIFIED.
https://docs.relay.link/references/protocol/vaults/overview

## 5. Cross-chain contract calls
Relay executes **arbitrary destination calldata**, not just token delivery: "perform any action (tx) on any chain." Pass a `txs` array of `{to, value, data}` to `POST /quote/v2`; include an approval tx for ERC-20 spends. For amount-dependent calls, Relay recommends a destination proxy that reads the delivered balance at execution. Use cases: mints, DeFi, game purchases. Status via `/intents/status/v3`.
https://docs.relay.link/references/api/api_guides/calling-integration-guide

## 6. Gasless execution
The user signs a payload (Permit2 / EIP-3009 / ERC-2771 / ERC-4337 / EIP-7702 style); a relayer submits and pays gas. The fee is **not skimmed from output**; it is charged to a pre-funded **app balance** tied to the integrator's API key, via `/execute`. If the balance cannot cover fees the tx is not sponsored.
https://docs.relay.link/features/gasless-execution

## 7. Fee sponsorship
Integrator covers destination-chain fees. Needs an API key and a funded sponsorship wallet (fund via UI or on-chain deposit on Base). Quote params: `subsidizeFees: true`, `maxSubsidizationAmount` (USDC units, e.g. `"5000000"` = $5), `subsidizationBps` (0–10000 partial co-funding across `sponsoredFeeComponents`). Does not cover origin gas or app fees (Solana deposit fees excepted via `depositFeePayer`).
https://docs.relay.link/features/fee-sponsorship

## 8. Deposit addresses
Send-to-address bridging with **no wallet connect or signature**: set `useDepositAddress: true`, receive `depositAddress` and `requestId`; Relay watches the address, sweeps to the Depository, fills. Two modes: open (variable amount) and strict (bound to one order). Use cases: CEX-withdrawal UX, fiat onramps, headless senders, Bitcoin/Solana where wallet-connect is not native. Automatic refunds on failure.
https://docs.relay.link/features/deposit-addresses

## 9. HyperLiquid
Deposits (any chain → HL perps USDC, sentinel address `0x0…0`) and withdrawals (HL → any chain). Mechanism is **nonce mapping**: the user signs an EIP-712 authorization on any EVM chain binding a nonce to the `requestId`, then submits the HL transfer with that exact nonce. Chain id 1337, `protocolVersion: v2` required for withdrawals. Note the live probe showed HL token ids are 16-byte hex, and the native sentinel is rejected on the spot-token path.
https://docs.relay.link/references/api/api_guides/hyperliquid-support

## 10. Solana
Bidirectional Solana ↔ EVM. Addresses and mints must be native Solana format, case-sensitive. Liquidity via Jupiter. **Hard constraint: 1232-byte transaction limit** → `400 SOLANA_TX_TOO_LARGE`; mitigate with `includedOriginSwapSources: ["jupiter"]` and `maxRouteLength ≤ 4`. Wallet adapter: `@relayprotocol/relay-svm-wallet-adapter`. Wallet-injected compute-budget instructions can push a tx over the limit.
https://docs.relay.link/references/api/api_guides/solana

## 11. Webhooks
States pushed to an HTTPS endpoint: `waiting, depositing, pending, submitted, success, failure, refund`. Configured per API key in the dashboard, custom headers supported. Payload includes chain info, deposit details, fail/refund reasons, and the quote's `referrer`. Verification: `X-Signature-Timestamp` and `X-Signature-SHA256`, HMAC-SHA256 of `${timestamp}.${body}` keyed by the API key, constant-time compare. Up to 10 retries with exponential backoff; docs suggest a gateway like Hookdeck for critical paths.
https://docs.relay.link/references/api/api_guides/webhooks

## 12. Relay Kit (SDK / Hooks / UI)
- SDK `@relayprotocol/relay-sdk` (older name `@reservoir0x/relay-sdk`): fetch and execute quotes.
- Hooks: React wrappers (`useQuote`, `useExecutionStatus`, `useRelayChains`, `useRequests`, `useTokenList`, `useTokenPrice`).
- UI: embeddable swap widget (`@relayprotocol/relay-kit-ui`).

`createClient({...})` sets a global singleton (`getClient()`). Options: `baseApiUrl` (`MAINNET_RELAY_API` / `TESTNET_RELAY_API` / your proxy, which is now required since the 2026-07-21 change), `apiKey` (server-side only), `chains` via `convertViemChainToRelayChain`, `source` (attribution), `pollingInterval`, `maxPollingAttemptsBeforeTimeout`.
```ts
import { createClient, convertViemChainToRelayChain, MAINNET_RELAY_API } from "@relayprotocol/relay-sdk";
import { mainnet } from "viem/chains";
createClient({ baseApiUrl: MAINNET_RELAY_API, source: "YOUR.SOURCE", chains: [convertViemChainToRelayChain(mainnet)] });
```
https://docs.relay.link/references/relay-kit/overview · https://docs.relay.link/references/relay-kit/sdk/createClient

## 13. Contract addresses
Solver addresses per VM family: Bitcoin `bc1qq2mvrp4g3ugd424dw4xv53rgsf8szkrv853jrc`, EVM `0xf70da97812cb96acdf810712aa562db8dfa3dbef` (the address seen live), SVM `F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe`, Tron `TYVWGh8XkmU49Hi9PkGAZXiiJPB3J5zJZy`. Per-chain contracts (`RelayReceiver`, `ERC20Router`, `ApprovalProxy`) vary by chain and are served from their API, not the static docs. Fetch live rather than hardcoding.
https://docs.relay.link/references/api/api_resources/contract-addresses

## 14. Builder codes
Pure attribution, not revenue: an ERC-8021 `dataSuffix` appended to the deposit calldata on Base; indexers credit the app, the contract ignores it. Requires `explicitDeposit: true` and `protocolVersion: "v2"`, suffix only on the `deposit` step. Distinct from app fees.
https://docs.relay.link/references/api/api_guides/builder-codes

## 15. API surface (consolidated from the sitemap)
Quote/price: `POST /quote/v2` (`/quote` deprecated), `GET /price`, `GET /currencies/v2`, `POST /currencies/v1`, `GET /chains`, `GET /chains/liquidity`, `GET /swap-sources`, `GET /token-price`, `GET /config`. Execution: `POST /execute`, `POST /execute/permits`, `POST /fast-fill`, `POST /attest-deposit`. Status: `GET /intents/status/v3`, `GET /requests/v3` (v2 retires 2026-11-24), `GET /transactions/*`, `GET /withdrawal/status`, `POST /request-withdrawal`. Money: `GET /app-fees/{address}/balances`, `POST /app-fees/{address}/claim`, `GET /usage`. Transport: REST, WebSockets (`wss://ws.relay.link`, testnet `wss://ws.testnets.relay.link`), webhooks. Rate limits keyed: `/quote` 50 rpm, most others 200 rpm, `/requests/v3` 20 rps; elevated up to 10–20 rps on request.

## Gaps and openings for Suwappu
1. **No gasless or fee-sponsorship equivalent on our side.** Telegram users often land on a new chain with zero gas; Relay's app-balance model solves it without skimming output. Scope for `bot-dev`.
2. **Deposit-address UX fits a chat-first product exactly.** "Send to this address, we do the rest" is closer to how Telegram users already move money than a signing flow.
3. **Solver centralization is a messaging opening.** We race Across, Li.Fi, Socket, and now Relay; multi-provider fill is a real story against a single-solver dependency.
4. **Arbitrary cross-chain calls** could become a "cross-chain agent action" primitive on the agents API, not only swaps.
5. **HyperLiquid nonce-mapping deposits** are deeper than our Across-based HyperCore route; `chain-support` should compare.
6. **Relay Vaults** is a yield primitive we lack; not urgent for a swap bot.
7. **Webhook signing pattern** (HMAC of timestamp.body, 10 retries) is a clean reference for any outbound webhooks on api-ts.
8. **Builder codes** are a free attribution primitive if we ever want on-chain credit without a fee cut.
9. **Solana 1232-byte ceiling**: regression-test our Solana leg for oversized multi-hop routes.
10. **Three-tier SDK/Hooks/UI split** is the shape to benchmark `packages/sdk` against if we ship an embeddable widget.
11. Allocator/solver economics are undocumented: UNVERIFIED, do not assume permissionless solving.
12. Contract addresses are dynamic per chain: fetch from their API for any Blockscout-based monitoring.
