# Relay SDK internals (read from the published npm packages, 2026-09-08)

Installed and inspected in a scratch project: `@relayprotocol/relay-sdk@7.0.3`, `@relayprotocol/relay-kit-ui@11.0.6`, `@relayprotocol/relay-kit-hooks@4.0.4` (plus `viem`). Source shipped as `_esm/src/*.js` with sourcemaps, so this is their actual code, not a guess.

## Adoption (npm registry API)
| Package | Weekly downloads (2026-08-31 → 09-06) | Notes |
|---|---|---|
| `@relayprotocol/relay-sdk` | 51,545 | 42 versions since 2025-08-16 (the rebrand); latest 7.0.3 on 2026-09-03; daily 3K–13K with weekend dips |
| `@reservoir0x/relay-sdk` (old name) | 6,239 | still installed by legacy integrators |
| `@relayprotocol/relay-kit-ui` | 2,843 | the widget; ~5% of SDK volume, so most integrators build their own UI on the SDK |

For scale: ~58K weekly SDK installs is CI-inflated, but it says the SDK is the product and the widget is a demo.

## What `getQuote` actually sends
`actions/getQuote.js` posts to `${baseApiUrl}/quote/v2` with body `{user, destinationCurrency, destinationChainId, originCurrency, originChainId, amount, recipient, tradeType, referrer: client.source, txs, ...options}` and headers `x-api-key` (only if configured, and only to known Relay hosts) plus `relay-sdk-version`.

Consequence verified live: **`createClient({ source: "anything" })` without `apiKey` makes every quote fail with `UNAUTHORIZED_QUOTE`**, because `source` becomes `referrer` and the API rejects referrer without a key. Omit `source` and the same call returns 200 (output 24.97464 USDC on a 25 USDC Base→Arbitrum quote, fees gas $0.0011, relayer $0.0254). Their quickstart tells developers to set `source`, so in practice every SDK integrator is pushed to get a key. Our Python client deliberately sends `referrer` only when a key is configured.

## Client options and defaults (`client.js`)
`baseApiUrl`, `source`, `apiKey`, `logLevel`, `pollingInterval`, `confirmationPollingInterval`, `maxPollingAttemptsBeforeTimeout`, `useGasFeeEstimations`, `chains`, `websocketEnabled` (default false), `websocketUrl`. Endpoints baked in: `https://api.relay.link`, `https://api.testnets.relay.link`, `wss://ws.relay.link`, `wss://ws.testnets.relay.link`, `wss://ws.dev.relay.link`, assets at `https://assets.relay.link`. Tenderly public-contract API is called for revert decoding (`getTenderlyDetails.js`). No analytics or telemetry endpoints in the SDK itself; the UI kit ships Tailwind only.

## Execution flow (`actions/execute.js`, `utils/executeSteps/*`)
1. Refuses if sender or recipient is a dead/placeholder address.
2. Clones the quote, then runs `executeSteps` over `steps[]`: `transactionStep.js` signs and sends transactions, `signatureStep.js` handles `kind: "signature"` steps (EIP-712 typed data or raw messages, posted back to `/execute/permits` style endpoints), `websocketHandlers.js` streams status when enabled, else `pollApi.js` polls the step's `check.endpoint`.
3. `onProgress` callbacks expose `currentStep`, `currentStepItem`, `txHashes`, `refunded`, `error`.
4. `depositGasLimit` override exists because deposit gas estimates are known to be tight (we buffer 25% in our executor for the same reason).

## Smart-account and gasless machinery
- `caliburExecutor.js` integrates **Uniswap Calibur** (EIP-7702 delegated account): constants `CALIBUR_ADDRESS`, EIP-712 types, `ROOT_KEY_HASH`. This is how "gasless execution" and batched approve+deposit work for EOAs that delegate.
- `prepareBatchTransaction.js` uses EIP-5792 `wallet_sendCalls` when the wallet advertises capabilities (`disableCapabilitiesCheck` opt-out).
- `gaslessBatch.js` action posts batches to `/execute` for solver-submitted execution.
- `hyperliquid.js` implements the nonce-mapping EIP-712 flow documented in 01-technical.md.
- `fastFill.js` and `claimAppFees.js` / `getAppFees.js` wrap the fee-claim endpoints.

## Adapters shipped
`@relayprotocol/relay-svm-wallet-adapter` (Solana), Bitcoin, Tron, TON, Lighter adapters referenced from the UI kit; the SDK's `adaptViemWallet` is the EVM path. The UI kit's wallet list swapped Backpack for Nightly and OKX on Eclipse in Aug 2026 (changelog).

## What this means for us
1. **Their SDK is a thin client over three endpoints.** Our `bot/services/relay_api.py` reproduces the useful half (quote, status) in ~400 lines and avoids the `source`-without-key trap.
2. **Signature steps exist and we reject them.** For gasless and permit flows we would need to implement `signatureStep` semantics (sign typed data, POST to their execute endpoint). Not needed for EVM deposits today.
3. **EIP-7702 via Calibur is their gasless story.** If we want gasless for zero-balance users, the cheapest path is to reuse this: delegate the user's EOA once, then Relay's solver submits. That touches key handling (MONEY-PATH, KMS) and needs its own review.
4. **WebSockets are off by default** even in their SDK; polling `check.endpoint` is the normal path, which is what we do.
