# Changelog - Relay

Source: https://docs.relay.link/changelog

Changelog
Copy page

Record of new endpoints, breaking changes, deprecations, and default-behavior changes across Relay products

All
API
SDK
UI Kit
Hooks
Adapters
​
2026-09-01
API
UI Kit
​
API
Deprecated
GET /requests/:requestId/signature and GET /requests/:requestId/signature/v2 are deprecated. They keep working for now, but they should not be used in new integrations and will be retired. Both returned a solver signature over a small subset of intent fields, which never covered the minimum output amount, required a second call after the quote, returned only partial data until the request reached a terminal state, and behaved inconsistently across chains.
Replacement
verify a quote deterministically and offline instead: pass includeProtocolData: true to POST /quote/v2, inspect the returned protocol.v2.orderData, recompute the order id with getOrderId from the public @relay-protocol/settlement-sdk package, and confirm the deposit transaction commits to that order id. See Input Validation. Deposit address deposits are not yet covered by this flow.
​
RelayKit
UI Kit 11.0.5 — Patch
Align swap widget fee display with the Dashboard and transaction page: (e6ca48c) “Swap Impact” is now “Swap Cost”, “Relay Fee” is “Platform Fee” (with a green “(Reward)” note when Relay pays the user), “Execution Fee” is “Execution Cost”, and “Network cost” is “Deposit gas”. Credits render green with a leading ”+”, zero fees display as “
0.00
"
𝑖
𝑛
𝑠
𝑡
𝑒
𝑎
𝑑
𝑜
𝑓
"
−
"
,
𝑎
𝑛
𝑑
𝑠
𝑢
𝑏
−
𝑐
𝑒
𝑛
𝑡
𝑣
𝑎
𝑙
𝑢
𝑒
𝑠
𝑎
𝑠
𝑠
𝑖
𝑔
𝑛
𝑒
𝑑
"
+
\<
0.00"insteadof"−",andsub−centvaluesassigned"+\<0.01” / ”-< $0.01”.
​
2026-08-26
API
​
API
Behavior change
POST /authorize (elevated API keys): rate limiting is now scoped per (API key, wallet) at 5 requests per 60 seconds, with a separate 30 requests per 60 seconds aggregate ceiling per API key. Previously all /authorize calls under one elevated API key shared a single 5-per-60-second bucket, so concurrent authorizations from different end-users could reject each other even when no individual wallet exceeded the intended threshold. Self-serve /authorize limits are unchanged. See Elevated Rate Limits.
​
2026-08-25
UI Kit
Adapters
​
RelayKit
UI Kit 11.0.4 — Patch
Replace Backpack with Nightly and OKX as the Eclipse wallet connectors, since Backpack dropped Eclipse support (8fb110e)
UI Kit 11.0.4 — Patch
Fix the swap completion view showing a provisional token and amount as (d097a11) received. Destination actual values from GET /requests/v3 are now only displayed once the request status is success — before that, the quoted output token and amount are shown instead of intermediate route values (e.g. an origin swap’s USDC output on a route that delivers a different token). The transaction modal also keeps polling the request until it reaches a terminal status (success, failure, or refund) so the final received amount replaces the quoted one.
SVM adapter 21.0.3 — Patch
Skip address lookup tables that can’t be resolved on the connected chain instead of crashing before signing (8fb110e)
​
2026-08-20
API
​
API
Behavior change
POST /execute: executionOptions.referrer is now optional. Gasless execution requests that omit it are accepted; requests that still supply it are handled the same as before. The x-api-key check already scopes the endpoint to the caller’s integrator, so referrer no longer needs to be part of the required set. Field shape and semantics are unchanged.
​
2026-08-19
API
​
API
Added
GET /requests/v3: referrer is again supported as a filter — both as a top-level query parameter and as a referrer / not:referrer key inside any filters group — with exact-match semantics. Because referrer values are guessable, a referrer filter must be paired with the top-level apiKey parameter, and every supplied key must belong to the authenticating integrator. Requests without the apiKey pairing return 400; requests whose supplied keys are not owned by the caller (or which cannot resolve to an integrator identity) return 403. Empty referrer values are rejected. See the migration guide.
​
2026-08-14
SDK
UI Kit
​
RelayKit
Added
Pricing an XRP route before a wallet connects now works, and isDeadAddress recognises the Tron, Zero, and XRP placeholder addresses alongside the existing ones. — SDK 7.0.2, UI Kit 11.0.3 (e9dbac1)
​
2026-08-13
API
​
API
Behavior change
POST /quote, POST /quote/v2, and POST /price: same-chain Solana quotes now reject at quote time when the compiled deposit transaction would exceed 1232 bytes, matching the existing behavior for Solana-origin cross-chain quotes (see the 2026-05-29 entry). Previously same-chain oversized quotes returned 200 with steps the wallet could not serialize.
POST /quote, POST /quote/v2, and POST /price: the Solana deposit-transaction size gate now enforces the raw 1232-byte wire limit. Quotes between 1173 and 1232 bytes — valid on the wire as returned — are now accepted, and the previously reserved 60-byte compute-budget headroom is advisory. Clients that prepend compute-budget instructions at send time are responsible for checking their remaining room against the returned steps. This reverses the 2026-07-09 change that had cut the effective quote-time limit to 1172 bytes.
Added
POST /quote and POST /quote/v2: the new optional subsidizationBps request field lets sponsors cover a fixed share of each selected sponsorable fee bucket instead of covering it in full. Values are integer basis points in the range 0–10000 (10000 = 100%). Requires subsidizeFees: true. Applied per bucket before maxSubsidizationAmount, which continues to cap the sponsor’s total contribution. Currently supported only on swap execution flows — bridge and deposit-address flows return 400 when set. Omitting the field preserves the previous full-coverage behavior. See Fee Sponsorship.
GET /requests/v2, GET /requests/v3, and GET /integrators/quote-data: the feeSponsorship object now includes subsidizationBps on both the quoted and actual phases, reflecting the share configured at quote time when one was set. Absent when the field was not configured on the request.
POST /quote, POST /quote/v2, and POST /price: the response errorCode enum gains SOLANA_TX_TOO_LARGE, returned with 400 when the compiled Solana deposit transaction would exceed Solana’s 1232-byte wire limit and cannot be signed or broadcast. The response message reports the measured transaction size and how many bytes it lands over, so clients can see how far over the quote is without recompiling the message themselves. See Handling Quote Errors and Solana Support.
​
2026-08-07
API
​
API
Added
GET /intents/status/v3: the response now includes failReason and refundFailReason, matching the fields already returned on GET /requests/v3 and the request.status.updated webhook / websocket event. failReason returns "N/A" on non-failure statuses and the recorded reason (or "UNKNOWN") on failure, fallback, and refund statuses. refundFailReason defaults to "N/A" when no refund-leg failure is recorded. Integrators polling status can now read these values directly without a follow-up call to GET /requests/v3. See Handling Execution Errors for the full enum.
GET /intents/status/v3, GET /requests/v3, and the request.status.updated webhook: the refundFailReason enum gains MANUAL_REFUND_REQUIRED, returned when the refund leg could not be automatically executed and requires manual intervention (for example, when the origin funds cannot be programmatically returned to the depositor).
​
2026-08-06
API
​
API
Added
GET /requests/v3: the response data object now includes apiKeyName, the display name of the API key that created the request. It is returned only when the caller authenticates with an API key belonging to the request’s owning integrator and passes includeAuthenticatedData=true — the same gate as data.referrer and data.platformFee. null when the owning API key has no name set. See the migration guide.
​
2026-08-04
API
SDK
UI Kit
​
API
Behavior change
GET /requests/v2: 429 responses now return a route-specific body — message, successor, migrationGuide — distinct from the generic rate-limit body used by every other endpoint. No Retry-After header or field is emitted. Migrate to GET /requests/v3 — see the sunset timeline.
Added
GET /requests/v3: the filters AND/OR parameter now accepts null as a null-check operator on any recognised key. {"depositAddress": null} matches requests where the field is empty (does not exist); {"not:depositAddress": null} matches requests where the field is present. Null-checks work across identity, address, chain, currency, and status-style fields, including the composite user filter and the case-insensitive currencyInSymbol / currencyOutSymbol fields. Arrays that mix null with real values for the same key return 400. See the migration guide.
GET /requests/v2: every response now carries Deprecation, Sunset, and Link headers pointing to GET /requests/v3 and the migration guide, on 2xx, 4xx, and 5xx alike. The Deprecation header is a structured-field Date (@<unix-seconds>), Sunset is an RFC 7231 HTTP-date, and Link includes three relations — deprecation, sunset, and successor-version. The three headers are also listed in the API’s Access-Control-Expose-Headers, so browser clients using fetch or XMLHttpRequest can read them cross-origin.
GET /requests/v2: the 200 response body gains a top-level deprecation object with message, deprecatedAt, throttledFrom, sunsetAt, successor, and migrationGuide, mirroring the header timeline for clients that read the body rather than headers.
​
RelayKit
Changed
The SDK’s generated API types were regenerated to match the API schema. No runtime behavior changed. — SDK 7.0.1 (fb843c4, a443358, ef54ef1)
UI Kit 11.0.2 — Patch
Add Robinhood Chain, Linea, Monad, Soneium, MegaETH, and Tempo to Uniswap Wallet’s supported chains (78bf766)
​
2026-08-03
API
UI Kit
​
API
Added
GET /requests/v3: the new opt-in includeTotal boolean query parameter (defaults to false) returns an exact total field on the response with the count of requests matching the current filters, independent of limit and continuation. The count reflects all matches across the full data window, not just the returned page. Because computing the exact count adds meaningful query latency, keep includeTotal off on the hot list-fetch path and enable it only when the total is needed (e.g. rendering a “X of Y results” header). Pagination behavior is unchanged.
​
RelayKit
UI Kit 11.0.1 — Patch
Normalize Uniswap Wallet connector name so its chain restrictions apply (4ed6905)
​
2026-07-30
API
​
API
Behavior change
GET /requests/v3: for requests where an origin deposit was observed on-chain but no fill was ever attempted (for example, a double-spent Bitcoin deposit that fails before solve), data.route.actual.origin.inputCurrency now reflects the actual deposited amount and currency instead of mirroring data.route.quoted.origin.inputCurrency. data.route.actual.origin.outputCurrency is null in this case — no fill occurred, so no output currency was observed — and data.route.actual.destination continues to fall back to data.route.quoted.destination. Previously the entire data.route.actual object silently mirrored data.route.quoted on these rows, hiding the real deposit amount from integrators reading the actual-side fields. Requests that reached a fill attempt are unaffected.
GET /requests/v3: for TON-origin requests, data.inTxs[].txHash is now the bare 64-character hex transaction hash, suitable for opening on Tonviewer at /transaction/{TX_HASH}. Previously this field returned an internal composite identifier that had to be parsed before it could be linked to an explorer. Non-TON origins and data.outTxs[] are unaffected. This mirrors the fix previously shipped for GET /requests/v2 on 2026-06-19.
​
2026-07-28
API
UI Kit
​
API
Behavior change
POST /quote, POST /quote/v2, and POST /price: transient failures that previously collapsed into a generic 500 with errorCode: "UNKNOWN_ERROR" are now classified. Transient infrastructure failures (including raw transport timeouts) return 503 with errorCode: "SERVICE_UNAVAILABLE", transient price-feed failures return 503 with errorCode: "PRICE_FETCH_FAILED", and quote requests for token pairs that cannot be priced return 400 with errorCode: "UNSUPPORTED_CURRENCY". Only genuinely unclassified failures still return 500 UNKNOWN_ERROR. Both 503 codes are retryable — see Handling Quote Errors.
Added
POST /quote, POST /quote/v2, and POST /price: the response errorCode enum gains SERVICE_UNAVAILABLE and PRICE_FETCH_FAILED for transient upstream failures where the request should be retried.
GET /requests/v3: the elevated per-key rate limit is now 20 requests per second, up from the previously shared 10 rps bucket. GET /requests and GET /requests/v2 continue at 10 rps. Default (non-elevated) limits are unchanged. See Elevated Rate Limits.
​
RelayKit
UI Kit 11.0.0 — Major
Migrate wallet balance fetching from Dune (sunset) to Codex (e426f05)
Breaking changes:
duneConfig provider option removed — use codexConfig ({ apiBaseUrl?, apiKey? }). The default api base url is https://graph.codex.io; override it to proxy requests and protect your api key.
useDuneBalances hook removed — use useCodexBalances(address, queryOptions). The mainnet/testnet parameter is gone; balances are fetched from Codex-supported networks and filtered by your configured chains.
isDuneBalance removed from useCurrencyBalance’s return value.
useMultiWalletBalances no longer takes the mainnet/testnet parameter.
Other changes:
New useSolanaBalance hook: selected SVM tokens (Solana and Eclipse) now fetch balances directly from the chain’s RPC (native via getBalance, SPL via getTokenAccountsByOwner) instead of an indexer, so post-swap balances are fresh and the aggressive periodic refetch workaround is gone. The internal eclipse-only balance hook is gone; Eclipse flows through the same path.
Native SVM balances (SOL, Eclipse ETH) in the consolidated token selector list are fetched from their RPCs and merged with Codex results, since Codex does not index native SVM balances (nor Eclipse at all). Their USD values come from Codex prices for wrapped SOL / mainnet WETH.
Spam filtering: Codex’s removeScams plus an isScam drop, and a liquidity heuristic replacing Dune’s spam scoring — tokens whose pool liquidity is under $1k or below the balance’s usd value have their usd value stripped so they can’t crowd out real holdings in the token selector (balances still display).
Known loss: Soon balances are gone from the token selector list; Soon is no longer a supported chain.
UI Kit 11.0.0 — Patch
Restrict Robinhood Wallet to its supported chains (d8c713c)
​
2026-07-27
API
​
API
Behavior change
GET /requests/v3, GET /intents/status/v3, and the request.status.updated webhook: gasless /execute failure rows that previously returned failReason: "UNKNOWN" when a broadcast succeeded but the transaction was never included, or when the transaction was never accepted for broadcast, now return one of the two new reasons.
Added
GET /requests/v3, GET /intents/status/v3, and the request.status.updated webhook: the response failReason enum gains TRANSACTION_SUBMISSION_FAILED, returned when the fill transaction could not be broadcast to the network (RPC unavailable, signer unavailable, or pre-broadcast rejection — no transaction hash exists), and TRANSACTION_NOT_INCLUDED, returned when the fill transaction was broadcast but never included onchain before Relay’s retry and gas-bump window elapsed. See Handling Execution Errors for the full enum.
​
2026-07-24
UI Kit
Hooks
​
RelayKit
UI Kit 10.0.1 — Patch
Complete the RefundReason error mapping. Every failReason code in the API schema now resolves to a specific user-facing explanation instead of falling back to the generic unknown-issue message, matching the copy used on relay.link and the developer dashboard. (f1a9fd8)
UI Kit 10.0.1 — Patch
Gracefully handle broken token/chain logo images. ChainTokenIcon now falls back to the token symbol avatar and ChainIcon hides itself when the logo fails to load, instead of rendering a broken-image placeholder. (628ad74)
UI Kit 10.0.1, Hooks 4.0.1 — Patch
block token contract addresses in recipient field (23e4ecf)
​
2026-07-22
API
​
API
Deprecated
GET /requests/v2 is deprecated as of today. It keeps working for now, but its rate limit will be progressively reduced each month until it is fully retired on November 24, 2026. Migrate to v3 before then — see the sunset timeline.
Behavior change
POST /quote and POST /quote/v2: when a blocklisted wallet recipient reaches destination simulation and the token contract rejects the transfer, the response errorCode is still DESTINATION_TX_FAILED but the message is now Recipient cannot receive this token (blocked by the token contract). Try a different recipient address. instead of the generic Destination transaction failed. Error classification is unchanged.
Added
POST /quote and POST /quote/v2: an explicitly provided recipient is now validated before quoting. Recipients that fail address validation for the destination chain return 400 with errorCode: "INVALID_ADDRESS". Recipients that resolve to a supported token contract (which cannot receive tokens — e.g. passing the destination-chain USDC contract as recipient) return 400 with the new errorCode: "INVALID_RECIPIENT". Requests that omit recipient are unaffected — the implicit recipient = user path is not revalidated. Previously these requests surfaced as DESTINATION_TX_FAILED after simulation. See Handling Quote Errors.
GET /requests/v3: the recommended Requests API. It requires x-api-key, adds a broad filter/search/sort surface, and returns a cleaner, consolidated response. See the migration guide.
​
2026-07-21
SDK
UI Kit
Hooks
​
RelayKit
SDK 7.0.0, UI Kit 10.0.0, Hooks 4.0.0 — Major
Migrate the Requests API from v2 to v3 (breaking). (07dda45)
useRequests / queryRequests and useDepositAddressStatus now call GET /requests/v3 and return the v3 response shape.
GET /requests/v3 requires a Relay API key (x-api-key). Since these hooks run client-side, the key is not sent from Relay Kit — you must point baseApiUrl at a proxy that injects x-api-key server-side. This is now required to use the UI kit. See the package README.
Response shape changes handled across the SDK/hooks/UI: inTxs[].hash/outTxs[].hash → txHash; data.metadata.currencyIn/currencyOut/currencyGasTopup removed — currencies for display are now derived from data.route (origin inputCurrency / destination outputCurrency, with actual → quoted and same-chain fallbacks); failReason/refundFailReason are null instead of "N/A"; new submitted status.
hash request filter removed; lookups by transaction hash now use the unified term search.
RelayKitProvider now warns (client-side) when baseApiUrl points directly at the Relay API instead of a proxy: a console.error if an apiKey is also set (it would be exposed in the browser), otherwise a console.warn that /requests/v3 will fail without a proxy. Suppress with acknowledgeApiKeyExposure: true.
Removed the secureBaseUrl option from RelayKitProvider and the useSecureBaseUrl prop from SwapWidget. All Relay API traffic now flows through the single baseApiUrl, which must be a proxy — the proxy is responsible for any gas-sponsorship logic (and injecting x-api-key) server-side.
UI Kit 10.0.0 — Patch
update wallet rejection errors in swap widget (b4a3f7c)
​
2026-07-10
UI Kit
​
RelayKit
Changed
The Base wallet can no longer send to or receive on Robinhood Chain, which it does not support. — UI Kit 9.1.4 (a29e409)
​
2026-07-09
API
​
API
Behavior change
POST /quote/v2: the Solana deposit-transaction size check on cross-chain Solana-origin quotes now reserves 60 bytes of headroom for the compute-budget instructions wallets and SDKs prepend at send time, so quotes are rejected when the compiled deposit transaction would exceed 1172 bytes (1232 minus 60). Previously the check ran at the raw 1232-byte limit and could return 200 with calldata that no longer fit once the client added its compute-budget instructions. The 400 response body now names the effective limit and the reserved-bytes reason. Continue to use maxRouteLength or includedOriginSwapSources to keep transactions under the limit — see Solana Support.
​
2026-07-08
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 6.1.3, UI Kit 9.1.3, Hooks 3.0.24, Bitcoin adapter 19.0.3, Ethers adapter 31.0.3, Lighter adapter 2.0.3, SVM adapter 20.0.3, TON adapter 2.0.3, Tron adapter 8.0.3 — Patch
Embed sourcesContent in published sourcemaps so they resolve without the unpublished src directory (0020895)
UI Kit 9.1.3 — Patch
Hide non-deposit-address chains (incl. TON) from origin selector unless VM has wallet support (4ac9782)
​
2026-07-02
API
​
API
Breaking
POST /quote and POST /quote/v2: the opt-in request flag includeProtocolSignature is renamed to includeProtocolData. The previous name is no longer honored. Integrators that were passing includeProtocolSignature: true to receive protocol.v2.orderSignature must switch to includeProtocolData: true. Setting this opt-in may increase quote response latency.
Added
POST /quote and POST /quote/v2: when the quote is settled through the Relay settlement protocol, the response’s protocol.v2 block now includes hubType (currently always "onchain") alongside orderId. With includeProtocolData: true, protocol.v2.orderSignature — the solver’s ECDSA signature over orderId — is also returned, so integrators can validate an onchain orderId against the quoted intent using ecrecover without a follow-up API call.
​
2026-06-30
SDK
UI Kit
Adapters
​
RelayKit
Fixed
The placeholder address the SDK uses to price a Bitcoin route before a wallet connects has been replaced. Previewing a Bitcoin route no longer returns an error. — SDK 6.1.2 (88a63b6, ce4d192)
SDK 6.1.0, UI Kit 9.1.0, TON adapter 2.0.0 — Minor
Add TON support: new @relayprotocol/relay-ton-wallet-adapter package exporting adaptTonWallet, plus tonvm support across the SDK (vmType, TON receipt, transaction step messages, dead address) and UI kit (native TON balance, token selector). (4711f4b)
TON adapter 1.0.0 — Minor
Add TON wallet adapter (adaptTonWallet, vmType: 'tonvm')
​
2026-06-29
SDK
​
RelayKit
SDK 6.0.1 — Patch
Convert convertViemChainToRelayChain from an arrow function to a function declaration (no behavior change). (bb7b1bb)
​
2026-06-26
SDK
UI Kit
Adapters
​
RelayKit
Removed
The SDK and UI kit no longer support Sui. Remove it from any chain configuration you pass in. — SDK 6.0.0, UI Kit 9.0.0 (4149ded)
SDK 6.0.0, UI Kit 9.0.0, Tron adapter 7.0.0 — Patch
Fix native TRX handling on Tron: forward call_value on the deposit transaction (was sending 0 TRX) and fix the native-TRX sentinel address (the wrong sentinel made native TRX fall through to a failing balanceOf call). (b61e540)
​
2026-06-23
API
​
API
Breaking
POST /quote, POST /quote/v2, and POST /price: slippageTolerance and latePaymentSlippageTolerance are now validated as integer strings in the range 0–10000 basis points. Values outside that range — including negative integers and values greater than 10000 — return 400 with errorCode: "INVALID_SLIPPAGE_TOLERANCE". Previously, negative values were accepted at quote time and produced refund outcomes downstream, and values above 10000 were accepted, effectively removing the minimum-output floor. Non-integer strings on POST /price previously returned 500; they now return 400 with the same INVALID_SLIPPAGE_TOLERANCE code as the other endpoints. See Handling Quote Errors.
​
2026-06-19
API
​
API
Behavior change
GET /requests/v2: for TON-origin requests, data.inTxs[].hash is now the bare 64-character hex transaction hash, suitable for opening on Tonviewer at /transaction/{TX_HASH}. Previously this field returned an internal composite identifier that had to be parsed before it could be linked to an explorer. Non-TON origins and data.outTxs[] are unaffected.
Added
GET /chains: the TON entry now exposes explorerPaths.transaction as /transaction/{TX_HASH}, so clients building explorer URLs can read the canonical Tonviewer path from the API rather than hardcoding /tx/{TX_HASH}.
​
2026-06-17
SDK
UI Kit
​
RelayKit
Added
Pricing a TON route before a wallet connects now works, and isDeadAddress recognises the TON placeholder address. — SDK 5.2.8 (1fc8190)
UI Kit 8.0.11 — Patch
Support TON destination bridging (d3eda06)
​
2026-06-10
API
​
API
Behavior change
GET /requests/v2: when a deposit is detected as reorged out or canonically failed on Base, the matching entry in data.inTxs[] now reports status: "failure". Previously the top-level request status could flip to "failure" while the corresponding data.inTxs[].status remained "success", leaving integrators that key their deposit UI off data.inTxs[0].status showing a succeeded deposit. Historical rows are not backfilled; the new behavior applies to detections going forward.
Added
GET /requests/v2: failed data.inTxs[] entries can now include a metadata.reorg object with detection context. Fields: detectedAt (unix millis), source (detector component), reason (short code), and optional details, failReason, action ("fill" or "refund"), blockNumber, blockHash, receiptStatus. The object is only populated when the failure was caught by the reorg/finality path; deposits that fail through other paths are unaffected.
​
2026-06-05
API
​
API
Behavior change
POST /quote/v2: quote attempts that fail because of a transient upstream RPC error now return errorCode: "REQUEST_TIMED_OUT" on timeout or errorCode: "RPC_HTTP_ERROR" for other transient RPC failures. Previously these were misclassified as errorCode: "DESTINATION_TX_FAILED", which suggested an on-chain revert and was treated as non-retryable. DESTINATION_TX_FAILED is now returned only for genuine destination reverts. Both new codes are retryable — see Handling Quote Errors.
​
2026-05-29
API
​
API
Breaking
POST /quote/v2: Solana-origin quotes routed through a third-party aggregator now return 400 when the generated deposit transaction would exceed Solana’s 1232-byte limit. Previously these requests returned 200 with calldata that could not be serialized or executed client-side. Use maxRouteLength or includedOriginSwapSources to keep transactions under the limit — see Solana Support.
​
2026-05-28
API
​
API
Behavior change
GET /intents/status/v3 and the request.status.updated webhook/websocket event: requests with a Bitcoin origin deposit now transition to pending as soon as the deposit is observed in the Bitcoin mempool, instead of waiting for the first block confirmation. The pending status no longer implies block inclusion for Bitcoin origins; block-confirmation policy continues to govern when the request progresses to submitted, success, failure, or refund. EVM and other non-Bitcoin origins are unchanged.
​
2026-05-27
API
​
API
Added
GET /requests/v2 and the request.status.updated webhook/websocket event: the depositAddress object now includes depositTxHash, the origin-chain transaction hash of the depositor’s transfer into the deposit address. This is distinct from inTxHashes, which tracks the sweep from the deposit address to the Relay depository. The field is null until the depositor’s transfer is observed, and is omitted on non-deposit-address requests (where depositAddress itself is null).
​
2026-05-26
API
UI Kit
​
API
Added
request.status.updated webhook: the data object now includes details, failReason, and refundFailReason, matching the corresponding fields on GET /intents/status/v3. failReason returns "N/A" on non-failure statuses and the recorded reason (or "UNKNOWN") on failure/fallback/refund statuses. refundFailReason defaults to "N/A" when no refund-leg failure is recorded. details is null when no additional context is available.
​
RelayKit
Changed
The UI kit fetches its centralized-exchange address list from https://assets.relay.link/app/cexAddresses.json instead of a GitHub raw URL. Update any host allowlist that covered the old address. — UI Kit 8.0.10 (4d73aeb)
​
2026-05-21
API
​
API
Breaking
POST /authorize (Hyperliquid nonce-mapping flow): the EIP-712 RelayNonceMapping domain version is bumped from "1" to "2", and the NonceMapping typed-data struct gains a new depositor (address) field. The /authorize request body must include a matching depositor field.
Integrators that pass the API-returned sign payload straight to their wallet (and POST post.body verbatim) require no code change. Integrators that hand-roll the authorize step must sign the new typed-data shape and forward depositor from steps[0].items[0].data.sign.value.depositor. See Hyperliquid Support for the updated payload shapes.
​
2026-05-20
API
​
API
Behavior change
POST /execute: raw-call simulation failures now return a decoded error label, message, requestId, and optional details object when Relay can decode the revert trace. The details object includes the top-level frame, innermost reverting frame, full reverting path, and decoded revert data for both subsidized and non-subsidized gasless execution flows.
​
2026-05-15
API
​
API
Behavior change
GET /intents/status/v3: failure rows that previously returned failReason: "UNKNOWN" now return a specific reason where one is available. Failed same-chain swap attempts return TRANSACTION_REVERTED, and refund rows triggered by duplicate deposits against the same request return DOUBLE_SPEND. No new enum members were introduced for these two cases.
Added
GET /intents/status/v3: the response failReason enum gains TRANSACTION_TOO_LARGE, returned when the serialized fill transaction exceeded the origin chain or RPC payload size limit. The enum also gains SOLVER_BALANCE_TOO_LOW, returned when the solver could not construct or send the fill because its source-side balance (or available UTXOs) was insufficient.
​
2026-05-11
SDK
UI Kit
​
RelayKit
Added
The SDK exports a testnet websocket endpoint, wss://ws.testnets.relay.link, alongside the mainnet one. — SDK 5.2.7 (eab4c8f)
UI Kit 8.0.9 — Patch
Add link to withdraw page on fill failure and isWithdrawable (eac2776)
​
2026-05-07
API
UI Kit
​
API
Behavior change
POST /quote/v2 with useDepositAddress: true, strict: true, and tradeType: EXACT_OUTPUT: a deposit larger than the quoted amount now fills the quoted amount and refunds the excess to refundTo in a separate refund leg, instead of scaling the fill up to the deposited amount. Exact payments still fill normally and underpayments still fail and refund. EXACT_INPUT strict deposit addresses are unaffected — an overpayment fills the full deposited amount and the excess is not refunded. refundTo remains required for strict deposit addresses.
​
RelayKit
Fixed
Hyperliquid’s spot and perps USDC both display as USDC, so the suggested-token pills were indistinguishable. They now show the token name on Hyperliquid. — UI Kit 8.0.8 (22aa1f9)
​
2026-04-28
API
UI Kit
​
API
Breaking
POST /quote/v2: same-chain swap requests whose quoted USD value is greater than 0 and less than $0.05 now return 400 with errorCode: "AMOUNT_TOO_LOW". Previously these requests returned 200 with calldata that reverted on-chain. Wrap and unwrap quotes (e.g. same-chain ETH ↔ WETH) and quotes that include attached calls continue to be accepted at any size.
​
RelayKit
UI Kit 8.0.7 — Patch
Fix gap in token selector’s suggested tokens (31cd7b4)
​
2026-04-24
SDK
Adapters
​
RelayKit
Added
New @relayprotocol/relay-lighter-wallet-adapter package, with the SDK wallet types and transaction steps needed to execute a route through a Lighter wallet. — SDK 5.2.4, Lighter adapter 0.1.1 (670737f)
SDK 5.2.4 — Patch
add disableCapabilitiesCheck option to skip wallet.getCapabilities (0eedcc1)
​
2026-04-21
SDK
​
RelayKit
SDK 5.2.3 — Patch
Support atomic batching for zero-reset approval swap flows (e.g. USDT on Ethereum). canBatchTransactions and prepareBatchTransaction now accept any number of leading approve steps before the terminal swap/deposit, so wallets that support EIP-5792 collapse the approve(0) → approve(amount) → swap sequence into a single wallet_sendCalls instead of three separate prompts. (eeb4695)
​
2026-04-16
SDK
UI Kit
Hooks
​
RelayKit
Added
GET deposit-address status now reports a depositing step, so a client can show that state while a deposit is in progress. — SDK 5.2.2, UI Kit 8.0.4, Hooks 3.0.12 (8d8aa50)
UI Kit 8.0.4 — Patch
Use spotClearinghouseState for Spot USDC and unified Hyperliquid accounts. Adds a new useHyperliquidAccountMode hook to detect the user’s account abstraction mode, and routes balance queries through spotClearinghouseState for unified/portfolio-margin accounts where the Perps USDC balance is reported under spot. (38dabc0)
​
2026-03-09
UI Kit
​
RelayKit
UI Kit 8.0.3 — Patch
Namespace keyframes with relay- prefix to prevent collisions with host apps (d5bea75)
UI Kit 8.0.3 — Patch
Add onHapticEvent callback to RelayKitProvider (08ecc49)
​
2026-03-05
UI Kit
​
RelayKit
UI Kit 8.0.2 — Patch
Fix CSS layer scoping and priority for host app compatibility (26b2fc7)
UI Kit 8.0.1 — Patch
Fix CSS being tree-shaken in production builds by declaring styles.css as (887f0e0)
UI Kit 8.0.0 — Major
Migrate styling system from Panda CSS to Tailwind CSS (4c6d8d2)
UI Kit 8.0.0 — Patch
Optimize Font Awesome imports to use individual icon paths (0e44e49)
​
2026-02-26
Hooks
Adapters
​
RelayKit
Changed
The Bitcoin wallet adapter moved to a newer bitcoinjs-lib. — Bitcoin adapter 17.0.2 (daaae5b)
Hooks 3.0.11 — Patch
Add default stale time to useTokenPrice hook (ad4f08c)
​
2026-02-25
SDK
UI Kit
Hooks
​
RelayKit
Changed
useQuote and the swap and token widgets threw bare strings such as 'Missing a quote'. They now throw Error objects, so a catch block can read error.message and error reporters record a stack. Reading a status code from a failed request no longer throws when the error carries no response. — UI Kit 7.1.5, Hooks 3.0.10 (2f0d6de)
Fixed
useExecutionStatus and the SDK’s transaction helpers could leave a promise rejection unhandled, which terminates a Node process. Server-side rendering and scripted use were affected. Both now handle the rejection. — SDK 5.2.1, Hooks 3.0.10 (7b351ab)
​
2026-02-23
SDK
UI Kit
​
RelayKit
SDK 5.2.0 — Minor
Add executeGaslessBatch action to support 7702 gasless flow (144f7a4)
UI Kit 7.1.4 — Patch
Make progress modal error scrollable (1ae288f)
UI Kit 7.1.4 — Patch
Clearer error for locked wallet (3c9e0a1)
​
2026-02-19
UI Kit
Adapters
​
RelayKit
Changed
The Solana wallet adapter checks that the signature a wallet returns is base58 and throws Invalid Solana signature: expected base58. when it is not, instead of passing a malformed signature on. — SVM adapter 17.0.2 (20db8bc)
UI Kit 7.1.3 — Patch
Enable multi wallet dropdown for hyperliquid (5b4830b)
​
2026-02-17
SDK
UI Kit
​
RelayKit
Added
The chain selector accepts a sameChainOption, letting a user pick the origin chain as the destination for a same-chain swap. — UI Kit 7.1.2 (8aa2bca)
Changed
Selecting the maximum amount now holds back a small execution buffer on every origin chain, where previously only native-token routes reserved one for fees. The native gas buffer applies to EVM and SVM origins. — UI Kit 7.1.2 (c7da389)
Hyperliquid operates like a centralized exchange, so wallet compatibility checks are skipped for it. Abstract Global Wallet recipients are the exception — they cannot receive a Hyperliquid deposit and are now rejected. — UI Kit 7.1.2 (00cad1c)
The token selector takes its suggested-token metadata from the API’s trending currencies and each chain’s solverCurrencies, rather than from local storage. — SDK 5.1.1, UI Kit 7.1.2 (f851b3c)
​
2026-02-10
UI Kit
Hooks
​
RelayKit
Changed
Deposit-address transaction tracking reads from the Requests API. — UI Kit 7.1.1, Hooks 3.0.7 (448ec7c)
​
2026-02-02
SDK
UI Kit
​
RelayKit
Breaking
The UI kit no longer exports useEOADetection. useExplicitDeposit replaces it — update your imports if you called the hook directly. — SDK 5.1.0, UI Kit 7.1.0 (56123ee)
​
2026-01-30
SDK
UI Kit
​
RelayKit
Added
New fastFill action on the SDK, with FastFillParameters, FastFillBody, and FastFillResponse types. A failed fast fill throws an APIError carrying the failure message and status, including transport failures that never returned a response. — SDK 5.0.3 (0f0ad9f, 7acfaed)
Changed
The widget’s fee breakdown reads details.expandedPriceImpact from the quote instead of deriving figures from fees.relayerService and details.swapImpact, and links to the fee documentation. — UI Kit 7.0.11 (6ff1ba6)
​
2026-01-21
SDK
UI Kit
​
RelayKit
Added
Every request the SDK makes now sends a relay-sdk-version header, reporting the client version or unknown. — SDK 5.0.2 (b86a59d)
SDK 5.0.2 — Patch
Add support for custom logger function in createClient initializer (efa0aae)
UI Kit 7.0.10 — Patch
Better handling of max input for low balances (da08649)
​
2026-01-14
SDK
​
RelayKit
SDK 5.0.1 — Patch
Improve SolverStatusTimeout error log (9d7aab2)
​
2026-01-13
UI Kit
​
RelayKit
UI Kit 7.0.8 — Patch
Add support for lighter evm address lookup (492e417)
​
2026-01-12
UI Kit
​
RelayKit
Changed
EOA detection now allows 2.5 seconds instead of 1 second, so a slow wallet or RPC is less likely to be misread. The timeout was then reimplemented without any further change in behavior. — UI Kit 7.0.7 (6c804bc, 9cc3fac)
​
2026-01-08
SDK
UI Kit
Hooks
​
RelayKit
SDK 5.0.0 — Major
Move configureViemChain, configureDynamicChains, and fetchChainConfigs to new /chain-utils subpath to reduce bundle size (7d8cfef)
UI Kit 7.0.5 — Patch
Remove twitter share button (cb3b9e9)
Hooks 3.0.2 — Patch
Move configureViemChain, configureDynamicChains, and fetchChainConfigs to new /chain-utils subpath to reduce bundle size (7d8cfef)
​
2026-01-06
SDK
UI Kit
​
RelayKit
SDK 4.0.1 — Patch
Add amount param to claimAppFees action (dd3f0c2)
UI Kit 7.0.4 — Patch
Allow setting 0 slippage tolerance (4323f0e)
​
2025-12-19
UI Kit
​
RelayKit
UI Kit 7.0.2 — Patch
Clearer eoa logs (e2a4b65)
​
2025-12-18
UI Kit
​
RelayKit
UI Kit 7.0.1 — Patch
Add tracking for eoa detection (34167fa)
​
2025-12-17
SDK
UI Kit
Hooks
​
RelayKit
SDK 4.0.0, UI Kit 7.0.0, Hooks 3.0.0 — Major
Upgrade to quote/v2 api (f544c1d)
​
2025-12-15
UI Kit
Adapters
​
RelayKit
UI Kit 6.1.1 — Patch
Support hyperliquid balance fetching for spot coins (e27e88a)
SVM adapter 14.0.1 — Patch
Update solana adapter docs (8854ced)
​
2025-12-10
SDK
UI Kit
​
RelayKit
SDK 3.2.0, UI Kit 6.1.0 — Minor
Integrate hyperliquid direct deposits (2519846)
SDK 3.2.0 — Patch
Support API key parameter in createClient SDK method (b1dbfb7)
UI Kit 6.1.0 — Patch
Update porto wallet compatibility (3910284)
UI Kit 6.1.0 — Patch
Phantom support – add monad and hyperevm (84e79a8)
​
2025-12-02
UI Kit
​
RelayKit
UI Kit 6.0.10 — Patch
Fix some deps that were incorrectly marked as peerDeps (d45f6be)
UI Kit 6.0.10 — Patch
Stabilised ens resolution & wallet selection (65d0b3d)
​
2025-11-25
UI Kit
​
RelayKit
UI Kit 6.0.9 — Patch
Post-launch fixes for TokenWidget (7a9777a)
​
2025-11-24
UI Kit
​
RelayKit
UI Kit 6.0.8 — Patch
Fix no routes error handling (e65cb19)
​
2025-11-21
SDK
UI Kit
​
RelayKit
SDK 3.1.1, UI Kit 6.0.6 — Patch
Add lighter vm and enable destination txs (1ed92a5)
UI Kit 6.0.7 — Patch
Stabilised tab switches (a33c5b0)
UI Kit 6.0.6 — Patch
Remove extra border on fee breakdown ui (a95b32d)
UI Kit 6.0.6 — Patch
Remove canonical logic and ui (69fcdb7)
​
2025-11-20
UI Kit
​
RelayKit
UI Kit 6.0.5 — Patch
Mobile payment selector improvments (b59d911)
​
2025-11-19
UI Kit
​
RelayKit
UI Kit 6.0.4 — Patch
Fix mobile ux (09031d5)
​
2025-11-17
UI Kit
​
RelayKit
UI Kit 6.0.3 — Patch
Improved mobile actions (68788cf)
​
2025-11-12
UI Kit
​
RelayKit
UI Kit 6.0.2 — Patch
Improve token widget (9e1f80a)
​
2025-11-11
UI Kit
​
RelayKit
UI Kit 6.0.1 — Patch
Enable broader support for gas top up (6fc5b9b)
​
2025-11-07
UI Kit
​
RelayKit
UI Kit 6.0.0 — Major
Add TokenWidget (dbb99e3)
​
2025-11-06
UI Kit
​
RelayKit
UI Kit 5.1.2 — Patch
New mobile token selector (9a0dc7c)
​
2025-10-29
SDK
UI Kit
Adapters
​
RelayKit
SDK 3.1.0, UI Kit 5.1.0, Tron adapter 1.0.0 — Minor
Add Tron adapter and balance logic (5108307)
UI Kit 5.1.1 — Patch
Update mobile percentage buttons (70badbb)
UI Kit 5.1.1 — Patch
Improve mobile ui for slippage configuration (5c80c9a)
UI Kit 5.1.1 — Patch
Add clear input button to custom address modal (38ea2b6)
​
2025-10-17
SDK
​
RelayKit
SDK 3.0.1 — Patch
Allow getQuote to pass in headers (028701b)
​
2025-10-16
UI Kit
​
RelayKit
UI Kit 5.0.5 — Patch
Improve sponsored tokens logic by switching to more flexible useSecureApi method (8ca6ff5)
​
2025-10-13
UI Kit
​
RelayKit
UI Kit 5.0.4 — Patch
Improved fill time display on success screen (2fcce34)
UI Kit 5.0.4 — Patch
Display lowercase ‘s’ for seconds on success screen (d830300)
UI Kit 5.0.4 — Patch
Improved token amount formatting on success screen (ae3e3bb)
​
2025-10-06
UI Kit
​
RelayKit
UI Kit 5.0.3 — Patch
Fix starred chains feature bugs (d49b6e5)
UI Kit 5.0.2 — Patch
Add starred chains feature to token selector (7784329)
​
2025-10-02
SDK
UI Kit
​
RelayKit
SDK 3.0.0, UI Kit 5.0.0 — Major
Revamped transaction steps (d38abdf)
UI Kit 5.0.1 — Patch
Improved copy for tx steps (e43a756)
UI Kit 5.0.0 — Patch
Fix duplicate deposit success event (3bd044c)
​
2025-10-01
SDK
UI Kit
​
RelayKit
SDK 2.4.6 — Patch
Fix tenderly error api (5135cd1)
UI Kit 4.0.19 — Patch
Save recent custom addresses to local storage (f54d1f3)
UI Kit 4.0.19 — Patch
Use fill time on success screen (cda3f6d)
​
2025-09-22
SDK
UI Kit
Adapters
​
RelayKit
SDK 2.4.5, UI Kit 4.0.18, Bitcoin adapter 10.0.6 — Patch
Add bitcoin public key to quote params (e3a9e1d)
SDK 2.4.5, UI Kit 4.0.18 — Patch
Refactor max slippage ui to be more pronounced (967e95b)
UI Kit 4.0.17 — Patch
Add transaction count check for explicit deposits (eb3a8fb)
UI Kit 4.0.17 — Patch
Update swap event data (1ad6ac3)
​
2025-09-19
UI Kit
​
RelayKit
UI Kit 4.0.16 — Patch
Remove protocol v2 threshold (686070b)
​
2025-09-18
UI Kit
​
RelayKit
UI Kit 4.0.15 — Patch
Update gas top up copy (99516bb)
UI Kit 4.0.14 — Patch
Update gas top up logic and ui (2108fb8)
UI Kit 4.0.14 — Patch
Tweak logic and ui for gas top up (ffd4dd2)
​
2025-09-17
UI Kit
​
RelayKit
UI Kit 4.0.13 — Patch
Increase protocol v2 threshold to $10k (42ef53d)
​
2025-09-15
UI Kit
​
RelayKit
UI Kit 4.0.12 — Patch
Fix explicit deposit for zero native balance wallets (b3a83ee)
UI Kit 4.0.11 — Patch
Increase protocolv2 threshold (99a32eb)
UI Kit 4.0.10 — Patch
Reimplement explicitDeposit logic (bbee152)
​
2025-09-12
UI Kit
​
RelayKit
UI Kit 4.0.9 — Patch
Remove explicitDeposit parameter (4749b3e)
UI Kit 4.0.9 — Patch
Remove gas top up re-enabling on swap success (0ec9be8)
​
2025-09-11
SDK
UI Kit
​
RelayKit
SDK 2.4.4 — Patch
Add EOA detection (7b8f325)
UI Kit 4.0.8 — Patch
Fix issue detecting EOA when disconnected (2467b30)
UI Kit 4.0.7 — Patch
Fix bug where logged out scenario not fetching quotes (1bd5324)
UI Kit 4.0.6 — Patch
Add character minimum for conversion rate tooltip (7e99ce4)
​
2025-09-10
Hooks
​
RelayKit
Hooks 2.0.2 — Patch
Fix base url for query quote function (622c094)
​
2025-09-09
UI Kit
​
RelayKit
UI Kit 4.0.4 — Patch
Fix fee subsidization normalization (d502596)
​
2025-09-05
UI Kit
​
RelayKit
UI Kit 4.0.3 — Patch
Add button cta font styling to theme (4142310)
​
2025-09-04
SDK
UI Kit
​
RelayKit
SDK 2.4.3 — Patch
Update capabilities check for batching to support MM (dd8a006)
UI Kit 4.0.2 — Patch
Porto wallet compatibility (e7d50bb)
UI Kit 4.0.1 — Patch
Remove custom fonts from ui kit base theme (41d48e1)
​
2025-09-02
UI Kit
Hooks
​
RelayKit
UI Kit 4.0.0, Hooks 2.0.0 — Major
Upgrade to React 19 (581937b)
UI Kit 3.0.3 — Patch
Switch to using queryQuote instead of useQuote hook (8dc4d4b)
UI Kit 3.0.3 — Patch
Add test ids for automation (dc26d7b)
​
2025-08-28
UI Kit
Adapters
​
RelayKit
UI Kit 3.0.2 — Patch
Enable protocolv2 only if destination chain supports settlement (34fa345)
UI Kit 3.0.2 — Patch
Fix share icon color (de102bb)
Bitcoin adapter 10.0.3 — Patch
Allow default sighash when sending tx (7615501)
​
2025-08-27
UI Kit
​
RelayKit
UI Kit 3.0.1 — Patch
Add data tracking for gas subsidization (0dae775)
​
2025-08-25
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 2.4.2, Bitcoin adapter 10.0.2, Ethers adapter 22.0.2, SVM adapter 11.0.2 — Patch
Update relay branding (2ad3c52)
UI Kit 3.0.0 — Major
Update relay branding (2ad3c52)
Hooks 1.13.0 — Minor
Update relay branding (2ad3c52)
​
2025-08-21
UI Kit
​
RelayKit
UI Kit 2.17.5 — Patch
Fix modal gap on mobile (5c97c8d)
​
2025-08-20
SDK
UI Kit
Hooks
​
RelayKit
SDK 2.4.1, UI Kit 2.17.4, Hooks 1.12.1 — Patch
Add gas sponsorship functionality (fd0b328)
​
2025-08-19
UI Kit
​
RelayKit
UI Kit 2.17.3 — Patch
Always show price impact regardless of input mode (b2d6c8c)
​
2025-08-15
UI Kit
​
RelayKit
UI Kit 2.17.2 — Patch
Reenable solana for protocolv2 (8a8d560)
​
2025-08-14
UI Kit
​
RelayKit
UI Kit 2.17.1 — Patch
Disable protocol v2 on solana (a50bea6)
​
2025-08-12
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 2.4.0, UI Kit 2.17.0, Hooks 1.12.0, Bitcoin adapter 10.0.0, Ethers adapter 22.0.0, SVM adapter 11.0.0 — Minor
Add websocket support and refactor executeSteps (6400542)
​
2025-08-08
UI Kit
​
RelayKit
UI Kit 2.16.2 — Patch
Increase prefers v2 threshold to $100 (c309276)
​
2025-08-07
UI Kit
​
RelayKit
UI Kit 2.16.1 — Patch
revert overflow fix (a284af5)
​
2025-08-06
UI Kit
​
RelayKit
UI Kit 2.16.0 — Minor
Fix token amount overflow on success screen (bb08004)
UI Kit 2.16.0 — Patch
Fix Hyperliquid wallet compatability (09ccc5c)
UI Kit 2.16.0 — Patch
Bump USD threshold for protocolv2 logic (2669722)
UI Kit 2.16.0 — Patch
Improve ui when no route are available (a437ede)
​
2025-08-05
UI Kit
​
RelayKit
UI Kit 2.15.11 — Patch
Add refundTo for HL withdrawals (762dc3c)
​
2025-08-01
SDK
UI Kit
​
RelayKit
SDK 2.3.2, UI Kit 2.15.10 — Patch
Add hyperliquid usd send functionality (1a88de0)
UI Kit 2.15.10 — Patch
Prevent onAnalyticEvent from throwing errors internally (dce6e56)
​
2025-07-29
SDK
UI Kit
​
RelayKit
SDK 2.3.1, UI Kit 2.15.9 — Patch
Enable protocol v2 for chains programatically (d1aeceb)
UI Kit 2.15.9 — Patch
Fix bug with selecting token from trending tokens list (cfad35b)
UI Kit 2.15.9 — Patch
Add context to CURRENCY_STEP_CHAIN_FILTER event (2bc1938)
​
2025-07-28
UI Kit
Hooks
​
RelayKit
UI Kit 2.15.8 — Patch
Add log to AGW check error (fbb50ac)
UI Kit 2.15.8 — Patch
Add usd values to swap events (1627058)
UI Kit 2.15.8 — Patch
Use max slippage between user input and quote for display (54e4628)
UI Kit 2.15.8, Hooks 1.11.1 — Patch
Add relay trending tokens to token selector (7985e6b)
UI Kit 2.15.8 — Patch
Enable more v2 protocol chains (a95050e)
​
2025-07-25
UI Kit
​
RelayKit
UI Kit 2.15.7 — Patch
Add more protocol v2 chains (96351f0)
​
2025-07-24
UI Kit
​
RelayKit
UI Kit 2.15.6 — Patch
Address accessibility issues (506f105)
UI Kit 2.15.6 — Patch
Add protocol v2 enabled chains (ff38840)
​
2025-07-22
UI Kit
​
RelayKit
UI Kit 2.15.5 — Patch
Enable preferv2 protocol for more chains (Ethereum, Polygon, BNB, OP, Zksync) (7e4273d)
​
2025-07-17
UI Kit
​
RelayKit
UI Kit 2.15.4 — Patch
Reenable prefers protocolv2 for a subset of chains (1aae32c)
​
2025-07-14
Adapters
​
RelayKit
SVM adapter 10.0.1 — Patch
Add an optional payerKey to customize gas payer (e251ccd)
​
2025-07-11
UI Kit
​
RelayKit
UI Kit 2.15.3 — Patch
Disable protocolv2 usage (4334b2f)
​
2025-07-10
UI Kit
​
RelayKit
UI Kit 2.15.2 — Patch
Enable prefersV2 for Avalanche, unichain and Gnosis (be1ec2c)
UI Kit 2.15.1 — Patch
Disable gas top up by default (c8ef9b5)
​
2025-07-09
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 2.3.0, UI Kit 2.15.0, Hooks 1.11.0, Bitcoin adapter 9.0.0, Ethers adapter 21.0.0, SVM adapter 10.0.0 — Minor
Upgrade viem to >=2.26.0 (aee47ea)
SDK 2.2.0, UI Kit 2.14.0 — Minor
Upgrade sdk types and add custom logic for blast protocol v2 configuration (3dbf1be)
UI Kit 2.14.0 — Patch
Check custom address against CEX address list (dad85e2)
​
2025-06-27
UI Kit
​
RelayKit
UI Kit 2.13.3 — Patch
Add warning for missing token price detection + add stroke to all alerts (1b67ee5)
​
2025-06-24
UI Kit
​
RelayKit
UI Kit 2.13.2 — Patch
Hide gas token badge for hyperliquid usdc (ac027bb)
​
2025-06-20
SDK
UI Kit
​
RelayKit
SDK 2.1.3 — Patch
Add getAppFees and claimAppFees sdk actions (9e35bcd)
UI Kit 2.13.0 — Minor
Fix destination wallet alert showing without wallet selection (57c625b)
UI Kit 2.13.0 — Patch
Add themeScheme to the provider to improve SSR hydration (862ee79)
​
2025-06-18
UI Kit
Hooks
​
RelayKit
UI Kit 2.12.0 — Minor
Switch to Dune’s Sim api for token balances (e3e114e)
UI Kit 2.12.0 — Patch
Hide display of batch txs on success step (9c81150)
UI Kit 2.12.0 — Patch
Improve usd fee display (b6e92a9)
UI Kit 2.12.0 — Patch
Adds toggle to switch between token amount and usd input (37479c3)
UI Kit 2.12.0, Hooks 1.10.4 — Patch
Remove referrer from requests api calls (3471571)
​
2025-06-13
SDK
UI Kit
Hooks
​
RelayKit
SDK 2.1.2, UI Kit 2.11.3, Hooks 1.10.2 — Patch
Update endpoints (1d8da8a)
SDK 2.1.2, UI Kit 2.11.3 — Patch
Add hypevm to vmtypes for destination (6049aa6)
UI Kit 2.11.3 — Patch
Ellipsify conversion rate + add tooltip to prevent overflow (8d5e07c)
UI Kit 2.11.3 — Patch
Fix cropped token selector text (c3a562f)
UI Kit 2.11.3 — Patch
Decrease high fee warning threshold to 1.5% (3aabf44)
Hooks 1.10.3 — Patch
Allow headers to be configured from query functions (1da754c)
​
2025-06-05
SDK
UI Kit
​
RelayKit
SDK 2.1.1, UI Kit 2.11.2 — Patch
Allow changing the polling interval for confirmation and improve RPC configuration (8b4754a)
​
2025-06-04
SDK
UI Kit
Hooks
​
RelayKit
SDK 2.1.0, UI Kit 2.11.0, Hooks 1.10.0 — Minor
Deduplicate request IDs (bb63fc9)
SDK 2.1.0 — Patch
Optimize same chain swapping to skip intent status if slower than receipt (758f8a7)
UI Kit 2.11.1 — Patch
Fix solana address regex (f073269)
UI Kit 2.11.0 — Patch
Add copy for new refund reason (73334f9)
UI Kit 2.11.0 — Patch
Add better handling for eclipse rpc balance errors (d0971ec)
UI Kit 2.11.0 — Patch
Allow selecting wallet before selecting chain (b30f584)
UI Kit 2.11.0 — Patch
Add context to wallet_selector events (42aa03d)
UI Kit 2.11.0 — Patch
Fix distorted token images (dc9da43)
UI Kit 2.11.0 — Patch
Capture quote to be used in TransactionModal (4d75f3a)
​
2025-05-31
UI Kit
​
RelayKit
UI Kit 2.10.12 — Patch
Fix tx confirmation issue preventing the error screen from showing (c40a8ea)
​
2025-05-29
UI Kit
​
RelayKit
UI Kit 2.10.11 — Patch
Allow slippage to be set to 0.01 in the slippage configuration component (df9ec72)
UI Kit 2.10.11 — Patch
Hide amount usd if returned value is 0 (6fa5e73)
UI Kit 2.10.11 — Patch
Use eclipse RPC for widget balances (eaeab61)
​
2025-05-27
UI Kit
​
RelayKit
UI Kit 2.10.10 — Patch
Remove max width from suggested token pills (260725c)
UI Kit 2.10.10 — Patch
Fix token selector scroll bug and improve dialog animation (665cc92)
​
2025-05-22
SDK
UI Kit
​
RelayKit
SDK 2.0.3, UI Kit 2.10.9 — Patch
Improve DEPOSIT_SUCCESS logic by checking pending status (dd0f93c)
​
2025-05-21
SDK
UI Kit
​
RelayKit
SDK 2.0.2 — Patch
Sync api types (e169c87)
UI Kit 2.10.8 — Patch
Fix broken suggested token logoUrl (dc09164)
UI Kit 2.10.8 — Patch
add AVAX to ME wallet compatibility (43bee2a)
UI Kit 2.10.7 — Patch
Fix status code data point for quote_error (a4f7deb)
​
2025-05-16
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 2.0.1, UI Kit 2.10.6, Hooks 1.9.11, Bitcoin adapter 6.0.1, Ethers adapter 18.0.1, SVM adapter 7.0.1 — Patch
Lock viem version to patch only to avoid breaking changes (dab775f)
UI Kit 2.10.6 — Patch
Add status to quote error (1df049b)
UI Kit 2.10.6 — Patch
Adjust gas top up copy (e572905)
​
2025-05-13
SDK
UI Kit
Adapters
​
RelayKit
SDK 2.0.0 — Major
[BREAKING] Update sdk getQuote method to optionally include defaults (5759fd0)
SDK 1.8.1 — Patch
Sync api types (e5d8e39)
UI Kit 2.10.5 — Patch
Fix receipt validation (2ee2f44)
UI Kit 2.10.4 — Patch
Fix gas top up bigint error (eed08f3)
Ethers adapter 18.0.0 — Patch
[BREAKING] Update sdk getQuote method to optionally include defaults (5759fd0)
​
2025-05-09
UI Kit
​
RelayKit
UI Kit 2.10.3 — Patch
Fix race condition with events (b74d695)
​
2025-05-08
UI Kit
​
RelayKit
UI Kit 2.10.2 — Patch
Add quote_request_id to all swap events (09be9a1)
UI Kit 2.10.1 — Patch
Fix issues with quote_id (1c1c05c)
​
2025-05-07
SDK
UI Kit
​
RelayKit
SDK 1.8.0, UI Kit 2.10.0 — Minor
Overhaul analytics events (d430ab3)
UI Kit 2.10.0 — Patch
Add interval to regenerate hash every 15m (47a0157)
UI Kit 2.10.0 — Patch
Refresh quote data when tx modal closes (16beb2e)
​
2025-05-01
SDK
UI Kit
Adapters
​
RelayKit
SDK 1.7.4, UI Kit 2.9.14, SVM adapter 5.0.4 — Patch
Add sui wallet adapter (ee3693a)
UI Kit 2.9.14 — Patch
Switch to sha256 from murmur3 to fix esm compatibility issue (83769eb)
UI Kit 2.9.14 — Patch
Fix address comparison logic in MultiWalletDropdown (3ae300a)
​
2025-04-30
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.7.3 — Patch
Add ability to override default logger (bc85ead)
UI Kit 2.9.13, Hooks 1.9.6 — Patch
Add a quoteRequestId when requests and receiving a quote (052745e)
UI Kit 2.9.13, Hooks 1.9.6 — Patch
Improve quote and swap analytics (fe54a20)
UI Kit 2.9.13 — Patch
Rename quote events (c3c4a53)
​
2025-04-28
SDK
UI Kit
​
RelayKit
SDK 1.7.2 — Patch
Fix add ethereum chain errors (4fb4ac3)
UI Kit 2.9.12 — Patch
Display estimated USD value for input token before swap quote is available (fe2398d)
​
2025-04-24
SDK
UI Kit
​
RelayKit
SDK 1.7.1, UI Kit 2.9.11 — Patch
Add fallback mechanism when InternalJSONRPC occurrs (effd487)
SDK 1.7.1, UI Kit 2.9.11 — Patch
Sync sdk types and update sugested tokens to use logoURI from featured tokens (af85e2a)
UI Kit 2.9.11 — Patch
Render fallback token placeholder using symbol initial (afdb901)
UI Kit 2.9.11 — Patch
Add sei to ME wallet compatibility (b2af4e9)
UI Kit 2.9.11 — Patch
Max Button gas estimation improvements for evm (6416987)
​
2025-04-22
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.7.0 — Minor
Gas top up functionality (6940a55)
UI Kit 2.9.10, Hooks 1.9.3 — Patch
Gas top up functionality (6940a55)
​
2025-04-18
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.6.15, UI Kit 2.9.9, Hooks 1.9.2 — Patch
Add additional refund reason messaging (293486b)
UI Kit 2.9.9 — Patch
Add ronin wallet compatibility (9868461)
UI Kit 2.9.9 — Patch
Upgrade to new dune svm balance api (b2187e1)
​
2025-04-14
UI Kit
​
RelayKit
UI Kit 2.9.8 — Patch
Reset swap widget inputs after a successful swap (a8ecc87)
UI Kit 2.9.8 — Patch
Fix slice error on confirmation screens (d243416)
UI Kit 2.9.8 — Patch
Handle rejecting tx in AGW (0e55b40)
​
2025-04-10
SDK
UI Kit
​
RelayKit
SDK 1.6.14, UI Kit 2.9.6 — Patch
Add endpoint to APIError for debugging (b2782e9)
UI Kit 2.9.7 — Patch
Fix chain scroll bug (ed9cddb)
UI Kit 2.9.6 — Patch
Fix chain filter scroll into view (74929ec)
UI Kit 2.9.6 — Patch
Add additional data to token select exit event (975b6d1)
​
2025-04-09
UI Kit
​
RelayKit
UI Kit 2.9.5 — Patch
Prevent AGW from receiving incompatible funds (f0ed8bc)
​
2025-04-07
UI Kit
​
RelayKit
UI Kit 2.9.4 — Patch
Fix token symbol overflow within token selector (9eef113)
UI Kit 2.9.4 — Patch
Add privateChainIds to RelayKitProvider options (e5d2bb9)
UI Kit 2.9.4 — Patch
Add dropdown-border theme element (be993e3)
​
2025-04-04
UI Kit
​
RelayKit
UI Kit 2.9.3 — Patch
Fix useCurrencyBalnce hook bug (f7a90ba)
​
2025-04-03
UI Kit
​
RelayKit
UI Kit 2.9.2 — Patch
Update analytic events for token selector (e0f74be)
UI Kit 2.9.2 — Patch
Fix undefined token setting in swap widget (ca56384)
​
2025-04-02
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.6.13 — Patch
Breaking Changes: (bf8dbdb)
relay-kit-hooks: Updated useTokenLists hook to use /currencies/v2 API with new response structure
relay-kit-ui: Redesigned token selector component with improved architecture
Removed chain selector in favor of unified token selector component
Removed defaultToToken and defaultFromToken props
Added toToken, setToToken, fromToken, setFromToken props
Added disableInputAutoFocus and popularChainIds configuration options
These changes improve token selection UX, provide better state management, and enable more flexible chain configuration.
UI Kit 2.9.1 — Patch
Fix token setters (40c1910)
UI Kit 2.9.0, Hooks 1.9.0 — Minor
Breaking Changes: (bf8dbdb)
relay-kit-hooks: Updated useTokenLists hook to use /currencies/v2 API with new response structure
relay-kit-ui: Redesigned token selector component with improved architecture
Removed chain selector in favor of unified token selector component
Removed defaultToToken and defaultFromToken props
Added toToken, setToToken, fromToken, setFromToken props
Added disableInputAutoFocus and popularChainIds configuration options
These changes improve token selection UX, provide better state management, and enable more flexible chain configuration.
UI Kit 2.9.0 — Patch
Allow dune base api to fallback to default (12c8e59)
​
2025-03-31
UI Kit
​
RelayKit
UI Kit 2.8.0 — Minor
Refactor dune api config (ccff74e)
UI Kit 2.8.0 — Patch
OnrampModal: reset recipient if vm changes and recipient is now invalid (7e7df25)
UI Kit 2.8.0 — Patch
Add a prop to disable paste address wallet option (36bad1d)
UI Kit 2.8.0 — Patch
Fix conversion rate display bug (cff46c3)
UI Kit 2.8.0 — Patch
Add a short cache for balance queries to optimize dune usage (5b70dc4)
​
2025-03-25
SDK
​
RelayKit
SDK 1.6.12 — Patch
Fix hyperevm chain configuration (66b8de8)
​
2025-03-21
SDK
UI Kit
​
RelayKit
SDK 1.6.11, UI Kit 2.7.18 — Patch
Update API SDK types, fix react 19 component type issues (0af5808)
​
2025-03-20
SDK
UI Kit
​
RelayKit
SDK 1.6.10, UI Kit 2.7.16 — Patch
Add Sui VM support (769d648)
UI Kit 2.7.17 — Patch
Improve OnrampModal robustness (dfbca22)
UI Kit 2.7.17 — Patch
Always return QR code for deposit address flow (16c07ed)
​
2025-03-18
UI Kit
​
RelayKit
UI Kit 2.7.15 — Patch
Uniswap wallet compatability configurations (05733be)
UI Kit 2.7.15 — Patch
Fix max capacity error message not shown (93331ae)
​
2025-03-17
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.6.9, UI Kit 2.7.14, Hooks 1.8.5 — Patch
Add scripts for statically bundling versions (bc77582)
SDK 1.6.9, UI Kit 2.7.14 — Patch
Handle custom block explorer transaction page (cdc8d92)
UI Kit 2.7.14 — Patch
Detect changes to destination chain and select supporting wallet (7f6c958)
UI Kit 2.7.14 — Patch
Improve Deposit address logic in TokenSelector (842b547)
UI Kit 2.7.14 — Patch
Fix a bug where changing the chain to a different vm would not find the supported linked wallet (72f7f75)
​
2025-03-13
SDK
UI Kit
​
RelayKit
SDK 1.6.8 — Patch
Update Tron dead address (3993eb3)
UI Kit 2.7.13 — Patch
Add analytic events for chain select (3b733af)
UI Kit 2.7.13 — Patch
Rename connect CTA to “Connect Wallet” (38bfb4c)
UI Kit 2.7.13 — Patch
Fix approval tx display on swap confirmation screen (2b603a3)
UI Kit 2.7.12 — Patch
Remove duplicate price impact warning (8376d7f)
UI Kit 2.7.12 — Patch
Fix bug where deposit address origin prevented connecting a destination wallet (63be014)
​
2025-03-12
UI Kit
​
RelayKit
UI Kit 2.7.11 — Patch
Fix default unverified tokens not prompting approval (00d34dd)
​
2025-03-10
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.6.7, UI Kit 2.7.9 — Patch
Tron support (f1f6d42)
SDK 1.6.6 — Patch
Fix sender sometimes being set to dead address (b0d1c88)
UI Kit 2.7.10 — Patch
Fix tvm filter (0cad99d)
Hooks 1.8.2 — Patch
Swallow useQuote error if onError handler is passed (7a675e3)
​
2025-03-07
SDK
UI Kit
​
RelayKit
SDK 1.6.5 — Patch
Check tx confirmation error with tenderly api to enhance error data (e0133b1)
UI Kit 2.7.7 — Patch
Ensure quote is always fresh when TransactionModal closes (62952a9)
UI Kit 2.7.6 — Patch
Fix transaction validating event getting triggered multiple times (4f5f328)
​
2025-03-05
UI Kit
​
RelayKit
UI Kit 2.7.5 — Patch
Dune token api chain_ids update (5107aee)
UI Kit 2.7.5 — Patch
Remove ‘Review Quote’ step and consolidate tx flow into one ui state (a173c5a)
​
2025-03-04
UI Kit
​
RelayKit
UI Kit 2.7.4 — Patch
Fixes for suggested tokens and default token (99c4dbd)
UI Kit 2.7.3 — Patch
Fix default selected token (5eefe1f)
UI Kit 2.7.3 — Patch
Wallet compatibility for major wallets and abstract address detection (a662444)
​
2025-02-26
UI Kit
​
RelayKit
UI Kit 2.7.2 — Patch
Update slippage tolerance logic to handle remote swaps (3a6fdd7)
​
2025-02-25
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.6.4 — Patch
SDK config option to omit gas fee estimates (0ccd0d7)
UI Kit 2.7.1 — Patch
Fix dialog and dropdown menu incompatibility (5af363f)
UI Kit 2.7.0, Hooks 1.8.0 — Minor
Remove usePrice hook, queryPrice action, and PriceResponse type (df2820a)
UI Kit 2.7.0 — Patch
Remap max liquidity error (2aaf42a)
​
2025-02-24
SDK
UI Kit
​
RelayKit
SDK 1.6.3, UI Kit 2.6.11 — Patch
Handle confirmation error appropriately (a601dfa)
​
2025-02-21
UI Kit
​
RelayKit
UI Kit 2.6.10 — Patch
Fix slippage displayed for same-chain-swaps (5be1e1d)
UI Kit 2.6.9 — Patch
Fix slippage config bug on rerender (6772e0f)
UI Kit 2.6.8 — Patch
Add slippage configuration component (c876fdf)
UI Kit 2.6.8 — Patch
Fix ChainTokenIcon fallback dimensions (914af94)
UI Kit 2.6.8 — Patch
Fix onramping dollar formatting (46e6c73)
UI Kit 2.6.8 — Patch
Increase width of onramp widget (1cabbd1)
​
2025-02-20
UI Kit
​
RelayKit
UI Kit 2.6.7 — Patch
Hide fiat currency selector (a5e77cc)
UI Kit 2.6.6 — Patch
Add onTokenChange callback handler to OnrampWidget (a90dc24)
​
2025-02-19
SDK
UI Kit
​
RelayKit
SDK 1.6.2, UI Kit 2.6.3 — Patch
Sync api types, append moonpay id to relay request (1bf4aa7)
SDK 1.6.2, UI Kit 2.6.3 — Patch
Fix solver status timeout ui bug and split error into sub error (4215d2e)
UI Kit 2.6.5 — Patch
Fix onramping bugs (a89bedd)
UI Kit 2.6.4 — Patch
Fix onramp modal parseUnits error with eth amount (7c7d3ce)
UI Kit 2.6.3 — Patch
Fix onramping bugs: hide suggested tokens, avoid same chain swaps (869d750)
UI Kit 2.6.3 — Patch
OnrampModal bugs (620e41d)
UI Kit 2.6.3 — Patch
Fix useEnsResolver hook undefined address (773f61e)
​
2025-02-12
UI Kit
​
RelayKit
UI Kit 2.6.2 — Patch
Fix default chain icons (9ae33f8)
​
2025-02-11
UI Kit
​
RelayKit
UI Kit 2.6.1 — Patch
Fix bugs with onramping input (5a8bcfc)
​
2025-02-10
UI Kit
Hooks
​
RelayKit
UI Kit 2.6.0, Hooks 1.7.0 — Minor
OnrampWidget and useTokenPrice hook (dc81aac)
UI Kit 2.5.6 — Patch
Fix token lock issues in SwapWidget (af6c612)
UI Kit 2.5.5 — Patch
Update logs to include steps (c205df0)
​
2025-01-24
UI Kit
​
RelayKit
UI Kit 2.5.4 — Patch
Update radix dialog version (72cdfad)
UI Kit 2.5.3 — Patch
Add slippageTolerance prop to swap widget (f0c558e)
UI Kit 2.5.2 — Patch
Fix theme token usage for inputs (27b298c)
UI Kit 2.5.2 — Patch
Fix recipient bug when multi wallet support is not enabled (2abfa1a)
​
2025-01-22
SDK
​
RelayKit
SDK 1.6.1 — Patch
Post same chain tx to solver to fix status timeout errors (5a9208f)
​
2025-01-21
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.6.0, UI Kit 2.5.0, Hooks 1.6.0, Bitcoin adapter 3.0.0, Ethers adapter 15.0.0, SVM adapter 4.0.0 — Minor
Add support for batch transactions (3ae98ed)
SDK 1.6.0, UI Kit 2.5.0, Hooks 1.6.0, Bitcoin adapter 3.0.0, Ethers adapter 15.0.0, SVM adapter 4.0.0 — Patch
Add support for EIP-5792 batch transactions (80aba91)
UI Kit 2.5.0 — Patch
Remove usePrice hook usage from widget (e7f0acc)
​
2025-01-15
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.5.0, UI Kit 2.4.0, Hooks 1.5.0, Bitcoin adapter 2.0.0, Ethers adapter 14.0.0, SVM adapter 3.0.0 — Minor
Upgrade viem peer dependency (1effc86)
UI Kit 2.4.0 — Patch
Add usdc to ink chain’s suggested tokens (bbc62bc)
​
2025-01-10
UI Kit
​
RelayKit
UI Kit 2.3.10 — Patch
Add approve + swap ux flow and update cta copy in widget and modal (cbbe9b7)
​
2025-01-09
UI Kit
​
RelayKit
UI Kit 2.3.9 — Patch
Extract more data out of error message when sending to analytics handler (93d9556)
UI Kit 2.3.8 — Patch
Fix quote_error data (a273799)
UI Kit 2.3.8 — Patch
Adjust how we handle approval denied and plugin closed errors (52ceb0c)
​
2025-01-08
UI Kit
Hooks
​
RelayKit
UI Kit 2.3.7, Hooks 1.4.16 — Patch
Add quote_error analytics event (9928dbc)
UI Kit 2.3.7 — Patch
Fix token selector height bug (bf0e5ef)
​
2025-01-07
SDK
UI Kit
​
RelayKit
SDK 1.4.10 — Patch
Improve robustness of pre tx chain id check (7d6f035)
SDK 1.4.10, UI Kit 2.3.6 — Patch
Fix dead address being allowed as burn address (f81fbfa)
UI Kit 2.3.6 — Patch
Upgrade dune api version to v1 (0f3e5f5)
​
2025-01-03
SDK
UI Kit
Adapters
​
RelayKit
SDK 1.4.9, SVM adapter 2.0.9 — Patch
Expose instructions in signature function (2b257cd)
UI Kit 2.3.5 — Patch
Optimize token list merging and sorting logic in TokenSelector (9d16628)
UI Kit 2.3.5 — Patch
Fix token overflow ui bug on token selector (5193c1a)
​
2024-12-20
Hooks
​
RelayKit
Hooks 1.4.13 — Patch
Fix useRequests base url (91e7d85)
​
2024-12-19
UI Kit
​
RelayKit
UI Kit 2.3.3 — Patch
Update token selector dimensions and breakpoints (73f94b2)
UI Kit 2.3.3 — Patch
Fix slippage ui bugs (cd44e80)
​
2024-12-18
UI Kit
​
RelayKit
UI Kit 2.3.2 — Patch
Fix token selection bugs with lockChainId and restrictedTokens (e2e93c7)
UI Kit 2.3.2 — Patch
Add additional data points to switch wallet event (869d7f8)
UI Kit 2.3.2 — Patch
Update copy for link new wallet dropdown item (46c7bdd)
​
2024-12-16
UI Kit
Hooks
​
RelayKit
UI Kit 2.3.1 — Patch
Optimize usePrice hook by moving baseChainId validation to SwapWidgetRenderer and removing checkExternalLiquiditySupport prop. This improves performance by skipping invalid canonical routes based on baseChainId relationships. (d5b3c66)
UI Kit 2.3.1 — Patch
Spacing for DepositAddressModal (cb7ded3)
Hooks 1.4.12 — Patch
optimize usePrice hook to skip invalid canonical routes (1a593b5)
​
2024-12-12
UI Kit
Hooks
​
RelayKit
UI Kit 2.3.0 — Minor
Deposit Address fallback functionality (561b396)
UI Kit 2.3.0 — Patch
Remove trailing zeros from formatted amount (aa034bd)
UI Kit 2.3.0 — Patch
Include additional parameters when generating tx urls (dc6b34c)
Hooks 1.4.11 — Patch
Deposit Address fallback functionality (561b396)
​
2024-12-10
SDK
UI Kit
​
RelayKit
SDK 1.4.8 — Patch
Fix typescript error in RelayChain (bb5a8d0)
UI Kit 2.2.28 — Patch
Restore slippage UI component in transaction review step (c7167e6)
UI Kit 2.2.27 — Patch
Allow selecting same chain from chain selector (9e50085)
​
2024-12-04
UI Kit
​
RelayKit
UI Kit 2.2.26 — Patch
Hide slippage ui temporarily (9255bd1)
UI Kit 2.2.25 — Patch
Fix slippage ui bugs (3a71c56)
UI Kit 2.2.24 — Patch
Add slippage details to review quote screen (90c9ef9)
​
2024-12-03
UI Kit
​
RelayKit
UI Kit 2.2.23 — Patch
Add onSwapValidating callback (8d62614)
UI Kit 2.2.23 — Patch
Use transaction data rather than quote data on success screen (25d17fa)
UI Kit 2.2.23 — Patch
Update SwapConfirmationStep ui to fix overflow (9a34e7e)
​
2024-11-22
UI Kit
​
RelayKit
UI Kit 2.2.22 — Patch
Add new theme tokens and section ids (68ad52a)
UI Kit 2.2.22 — Patch
Fix undefined placeholder in custom address model when toChain is undefined (372fcd4)
​
2024-11-12
SDK
UI Kit
​
RelayKit
SDK 1.4.7 — Patch
Update zero address for zero chain (a52745f)
UI Kit 2.2.21 — Patch
Ensure dead address is properly generated (dce3b7b)
UI Kit 2.2.20 — Patch
Fix zero quote api error message (04ba9cf)
UI Kit 2.2.20 — Patch
Fix high price impact warning (31b754f)
​
2024-11-11
UI Kit
​
RelayKit
UI Kit 2.2.19 — Patch
Hide route selector in fee breakdown in single chain mode (fa63f61)
UI Kit 2.2.18 — Patch
Allow overriding chain to connector list (4fffded)
UI Kit 2.2.17 — Patch
Remove route selector from single chain mode (d1fd8ae)
UI Kit 2.2.17 — Patch
Add chain icon to token selector in single chain mode (604b9f6)
UI Kit 2.2.17 — Patch
Fix switch tokens button border theme (ce675ba)
​
2024-11-07
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.4.6, UI Kit 2.2.15, SVM adapter 2.0.6 — Patch
Support for eclipse svm (69df434)
UI Kit 2.2.16 — Patch
Add single chain mode to swap widget (0c92f0e)
Hooks 1.4.8 — Patch
Fix usePrice error handling (1c68705)
​
2024-11-04
SDK
UI Kit
​
RelayKit
SDK 1.4.5, UI Kit 2.2.14 — Patch
Add suggested tokens to token selector (0292590)
UI Kit 2.2.14 — Patch
Fix capacity exceeded error to find max capacity (bbad717)
​
2024-11-01
Adapters
​
RelayKit
SVM adapter 1.0.0 — Minor
Abstract txs in Adapted Wallet + new Solana Adapter (a8215cf)
​
2024-10-31
SDK
UI Kit
​
RelayKit
SDK 1.4.4, UI Kit 2.2.13 — Patch
Impprove wallet switch error handling (2ea4fde)
UI Kit 2.2.13 — Patch
Handle max capacity error when maximum not returned in error message (ab5bc9b)
​
2024-10-30
SDK
UI Kit
​
RelayKit
SDK 1.4.3, UI Kit 2.2.12 — Patch
Update solana dead address (3dd7177)
UI Kit 2.2.11 — Patch
Remove support for setting unverified tokens from the chain selector (f9b6975)
UI Kit 2.2.11 — Patch
Update token uri fallback styling (5745538)
UI Kit 2.2.10 — Patch
Update unverified token modal to link out to block explorer’s token page (6c52029)
UI Kit 2.2.10 — Patch
Fix token selector trigger overflow (40aece0)
UI Kit 2.2.10 — Patch
Fix pending balance bug breaking ui (aceb483)
​
2024-10-29
SDK
UI Kit
​
RelayKit
SDK 1.4.2, UI Kit 2.2.9 — Patch
Add support for unverified tokens (631f997)
UI Kit 2.2.9 — Patch
Display pending balance when bitcoin tx is inflight (e8681aa)
UI Kit 2.2.9 — Patch
Remove logic to prefill address with connected address in custom address modal (73525f1)
​
2024-10-28
UI Kit
​
RelayKit
UI Kit 2.2.8 — Patch
Double time estimate for bitcoin (742a49a)
UI Kit 2.2.7 — Patch
Make selector theme optional (87b0bca)
UI Kit 2.2.6 — Patch
Add disclaimer messaging in confirmation modal with long canonical relays (a1e9418)
UI Kit 2.2.6 — Patch
Add widget selector theme variable (bd1ec82)
UI Kit 2.2.6 — Patch
Fix 0 price impact (b68e6c1)
​
2024-10-24
UI Kit
Hooks
​
RelayKit
UI Kit 2.2.5 — Patch
Fix parallel quoting when quote returns errror but price does not (47c6c04)
UI Kit 2.2.5 — Patch
Remove stroke from route selector when focused (fc902d3)
UI Kit 2.2.4 — Patch
Fix double route ui issue where price error shows up alongside valid quote data (321a64e)
UI Kit 2.2.3 — Patch
Expand bitcoin address validation to taproot and base58 (104fe18)
UI Kit 2.2.2, Hooks 1.4.2 — Patch
Fetch price and quote in parallel to improve price accuracy in SwapWidget (f18951c)
​
2024-10-23
SDK
UI Kit
​
RelayKit
SDK 1.4.1, UI Kit 2.2.1 — Patch
Fix bugs with bitcoin implementation (6237949)
​
2024-10-22
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.4.0, UI Kit 2.2.0, Bitcoin adapter 1.0.0 — Minor
Bitcoin support (07917f6)
Hooks 1.4.0 — Minor
Remove automatic refresh of quote data after execution in useQuote hook (d3f975d)
​
2024-10-21
UI Kit
​
RelayKit
UI Kit 2.1.9 — Patch
Added keyboard navigation to token selector (29bb388)
​
2024-10-18
UI Kit
​
RelayKit
UI Kit 2.1.8 — Patch
Add input and output amount to max capacity event (ac81750)
​
2024-10-17
SDK
UI Kit
​
RelayKit
SDK 1.3.4, UI Kit 2.1.7 — Patch
Replace exact_output with expected_output tradeType (2134530)
UI Kit 2.1.6 — Patch
Fix ux issues with canonical route selector (cea3f43)
​
2024-10-14
UI Kit
​
RelayKit
UI Kit 2.1.5 — Patch
Improve price impact, handle no instant liquidity ux (af05332)
​
2024-10-10
UI Kit
​
RelayKit
UI Kit 2.1.4 — Patch
Improvements on the canonical fallback ux (fbe5a41)
​
2024-10-04
UI Kit
​
RelayKit
UI Kit 2.1.3 — Patch
Fix disabled token selector background and issue with resetting canonical route (25d9c9a)
UI Kit 2.1.2 — Patch
Remove hardcoded canonical currencies (9b0319e)
​
2024-10-03
UI Kit
​
RelayKit
UI Kit 2.1.1 — Patch
Fix canonical check amount, disable token selector when one option available (d7a2ced)
UI Kit 2.1.0 — Minor
Implement canonical+ support into SwapWidget, remove ChainWidget (466cf46)
​
2024-09-24
SDK
UI Kit
​
RelayKit
SDK 1.3.3 — Patch
Fix switchChain logic to take into account missing chain in wallet (3f88d12)
UI Kit 2.0.8 — Patch
Fix token selector balance display (e3044ff)
UI Kit 2.0.7 — Patch
Fix swap modal closing when dynamic embedded wallet tx modal is prompted and clicked on (49cd085)
​
2024-09-20
UI Kit
​
RelayKit
UI Kit 2.0.5 — Patch
Patches fixes for Solana + multi wallet dropdown ui (e0b311d)
UI Kit 2.0.4 — Patch
Fix minor CustomAddressModal bugs (e763551)
​
2024-09-19
SDK
UI Kit
​
RelayKit
SDK 1.3.2, UI Kit 2.0.3 — Patch
Fix wallet switching in ChainWidget, fix sdk convert viem chain to RelayChain helper (277bfc5)
UI Kit 2.0.3 — Patch
Removed max button when Solana balance is less than minimum buffer. (1edca7c)
UI Kit 2.0.2 — Patch
Added a buffer of 0.02 minimum when selecting max for a Solana balance (78e5d13)
UI Kit 2.0.2 — Patch
Fix solana custom address prompt (b1526cb)
UI Kit 2.0.1 — Patch
Fix solana balance cached after swapping (dc387e3)
​
2024-09-18
SDK
UI Kit
​
RelayKit
SDK 1.3.1 — Patch
Add solana ui support in SwapWidget (2c38afe)
UI Kit 2.0.0 — Major
Add solana ui support in SwapWidget (2c38afe)
​
2024-09-16
UI Kit
​
RelayKit
UI Kit 1.4.1 — Patch
Improve high price impact copy (c5ed1d8)
​
2024-09-12
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.3.0, UI Kit 1.4.0, Hooks 1.3.0, Ethers adapter 12.0.0 — Minor
Abstract txs in Adapted Wallet + new Solana Adapter (a8215cf)
​
2024-09-10
SDK
UI Kit
​
RelayKit
SDK 1.2.2, UI Kit 1.3.20 — Patch
Expand support for svm chains when setting addresses (41feac9)
UI Kit 1.3.20 — Patch
Remove resetting of chain filter when token selector is closed (ae0dd9b)
UI Kit 1.3.20 — Patch
Fix modal’s “x” button size and alignment (10a4d30)
​
2024-09-06
UI Kit
​
RelayKit
UI Kit 1.3.19 — Patch
Chain selector ux tweaks (a93ae37)
​
2024-09-05
UI Kit
​
RelayKit
UI Kit 1.3.18 — Patch
Update high price impact warning logic (2d33c4a)
UI Kit 1.3.18 — Patch
Update swap widget padding and box shadow (128127f)
​
2024-09-03
UI Kit
​
RelayKit
UI Kit 1.3.17 — Patch
Fix conversion rate formatting bug (9fe399d)
UI Kit 1.3.16 — Patch
Fix ui overflow on transaction modal (7079727)
UI Kit 1.3.16 — Patch
Allow fetching solana quotes with no custom address (32c533e)
​
2024-08-30
UI Kit
​
RelayKit
UI Kit 1.3.15 — Patch
Fix search by chain displayName (e6f3183)
UI Kit 1.3.15 — Patch
Update Swapping CTA (5caf19b)
UI Kit 1.3.14 — Patch
Small token selector bug fixes (2a11467)
​
2024-08-29
UI Kit
​
RelayKit
UI Kit 1.3.13 — Patch
Fix token selector chain filter bug (f409525)
UI Kit 1.3.12 — Patch
Use default token list when chain is filtered (6001f8d)
UI Kit 1.3.11 — Patch
Chain selector improvements (2c6ead0)
UI Kit 1.3.10 — Patch
Add styling support for undefined tokens in new swap widget (9b623c2)
​
2024-08-28
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.2.1, UI Kit 1.3.9, Hooks 1.2.4, Ethers adapter 11.0.1 — Patch
New swap widget ui (7a084fa)
​
2024-08-23
SDK
UI Kit
​
RelayKit
SDK 1.2.0 — Minor
Better handling of transaction in flight and post transaction ui, handle refund status when polling for transaction success (9e14a17)
UI Kit 1.3.8 — Patch
Better handling of transaction in flight and post transaction ui, handle refund status when polling for transaction success (9e14a17)
​
2024-08-21
SDK
​
RelayKit
SDK 1.1.2 — Patch
Add getPrice action (78c6ed0)
​
2024-08-20
UI Kit
​
RelayKit
UI Kit 1.3.6 — Patch
Fix analytics in TransactionModal (7a1a4c7)
UI Kit 1.3.5 — Patch
Update balance display for solana (7d3f84d)
UI Kit 1.3.4 — Patch
Update solana token selector logic (785b732)
UI Kit 1.3.3 — Patch
Prevent switch token button in swap widget when swapping to solana token (3ae5fee)
​
2024-08-14
SDK
UI Kit
​
RelayKit
SDK 1.1.1 — Patch
Update sdk api types (28ed450)
UI Kit 1.3.2 — Patch
Reduce swap conversion rate from 5 decimals to 2 decimals (98bf004)
UI Kit 1.3.2 — Patch
Link out to to chain block explorer in review quote ux (4473144)
UI Kit 1.3.2 — Patch
Handle 0s time estimate (6363308)
UI Kit 1.3.2 — Patch
Improve custom wallet address modal ux (35d5e43)
UI Kit 1.3.2 — Patch
Improve tx error messaging (2cd9327)
UI Kit 1.3.2 — Patch
Reset custom address when switching to token from solana to evm chain (b940e97)
UI Kit 1.3.2 — Patch
Price Impact ui tweaks (a42142d)
​
2024-08-09
UI Kit
​
RelayKit
UI Kit 1.3.1 — Patch
Support Solana deposits in Swap widget (df71a3b)
​
2024-08-07
UI Kit
Hooks
​
RelayKit
UI Kit 1.3.0, Hooks 1.2.0 — Minor
Upgrade /requests api to /requests/v2 (b9db008)
UI Kit 1.3.0 — Patch
ChainWidget: Fix copy in SwapRouteSelector (4cd7401)
​
2024-08-06
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.1.0, UI Kit 1.2.0, Hooks 1.1.0 — Minor
Switch from execute/swap to quote api (105d1b8)
SDK 1.1.0 — Patch
Drop lodash cloneDeep in favor of native cloning (c158099)
​
2024-08-02
SDK
UI Kit
​
RelayKit
SDK 1.0.13, UI Kit 1.1.18 — Patch
Add support for iconUrl chain icon override (b342c8d)
UI Kit 1.1.18 — Patch
Add price impact warning to review quote ux (efd44d6)
​
2024-07-31
UI Kit
​
RelayKit
UI Kit 1.1.17 — Patch
Fix safari modal animation flickering bug (f66e0f5)
UI Kit 1.1.17 — Patch
Add defaultExternalChainToken to Chain Widget (87239fa)
​
2024-07-29
SDK
​
RelayKit
SDK 1.0.12 — Patch
Add supportsBridging to Relay Chain (ec9b20f)
SDK 1.0.11 — Patch
Sync api types (92b9c71)
​
2024-07-25
UI Kit
Hooks
​
RelayKit
UI Kit 1.1.14, Hooks 1.0.16 — Patch
Fix chain widget testnet configuration (fac3415)
UI Kit 1.1.13 — Patch
Fix swap widget cta bug (5acf10e)
UI Kit 1.1.12 — Patch
Remove compact formatting from review quote (23b528c)
​
2024-07-23
UI Kit
​
RelayKit
UI Kit 1.1.11 — Patch
Decouple dune balance loading from token selector (00da309)
​
2024-07-22
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.0.10, UI Kit 1.1.10, Hooks 1.0.15, Ethers adapter 9.0.10 — Patch
Add review quote step, refactor modal renderers
SDK 1.0.10, Hooks 1.0.15 — Patch
Add usePrice hook (2d22eec)
UI Kit 1.1.10 — Patch
Fix dollar formatting sub 0 and price impact spacing (af694ab)
UI Kit 1.1.10 — Patch
Color coding price impact (e231382)
​
2024-07-18
UI Kit
​
RelayKit
UI Kit 1.1.9 — Patch
Fix dropdown item hover color (b3432f4)
​
2024-07-15
SDK
UI Kit
​
RelayKit
SDK 1.0.9, UI Kit 1.1.8 — Patch
Better contextualize actions based on operation (3648ec3)
SDK 1.0.9 — Patch
Add blockProductionLagging to RelayChain (be74a6a)
UI Kit 1.1.8 — Patch
Only show fill time on success page if sub 10s (ea3e6c5)
UI Kit 1.1.8 — Patch
Export TokenSelector component (d5b3f82)
​
2024-07-10
UI Kit
​
RelayKit
UI Kit 1.1.7 — Patch
Reset canonical selection on ChainWidget unless supported (7445bbf)
UI Kit 1.1.6 — Patch
Add txHashes to success and error events (433ca57)
UI Kit 1.1.6 — Patch
Add transaction validating event (7c8fb89)
UI Kit 1.1.5 — Patch
Update chain display in token select ui (4cf2285)
UI Kit 1.1.4 — Patch
Sort token selector by total value usd and balance (02c5ea0)
​
2024-07-09
SDK
UI Kit
​
RelayKit
SDK 1.0.8 — Patch
Fix json error spreading throwing error in executeSteps (1e83361)
UI Kit 1.1.3 — Patch
Add success screen for canonical (643c6a6)
​
2024-07-03
UI Kit
​
RelayKit
UI Kit 1.1.2 — Patch
ChainWidget Canonical functionality (eae9b4d)
​
2024-07-02
UI Kit
​
RelayKit
UI Kit 1.1.1 — Patch
Remove log (3f2bd68)
​
2024-07-01
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.0.7, UI Kit 1.1.0, Hooks 1.0.12 — Patch
Add tests and fix global axios instance (4335c35)
UI Kit 1.1.0 — Minor
Refactor SwapWidget and add new ChainWidget for deposit/withdraw ux (0384db0)
​
2024-06-26
Hooks
​
RelayKit
Hooks 1.0.11 — Patch
Fix source getting overriden in useQuote hook (5c1a210)
Hooks 1.0.10 — Patch
Fix useQuote hook source (ec5e68e)
​
2024-06-25
UI Kit
​
RelayKit
UI Kit 1.0.14 — Patch
Pass source in widget (f7f014b)
​
2024-06-20
SDK
UI Kit
​
RelayKit
SDK 1.0.6, UI Kit 1.0.13 — Patch
Improve post transaction polling to increase speed (5184197)
UI Kit 1.0.13 — Patch
Fix capabilities check when coinbase wallet connected (d264b99)
​
2024-06-19
UI Kit
​
RelayKit
UI Kit 1.0.12 — Patch
Update swap time icon color code (4758845)
UI Kit 1.0.12 — Patch
Hide balance column in TokenSelector when account is not connected (5a6f8ca)
UI Kit 1.0.12 — Patch
Disable useCapabilities except for on coinbase wallet (d2c94a3)
​
2024-06-18
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.0.5, UI Kit 1.0.11, Hooks 1.0.8 — Patch
Move wallet chain id check to further in the flow (1945809)
UI Kit 1.0.11 — Patch
Fix button color when token selector is locked (ffb9ebe)
UI Kit 1.0.10 — Patch
Add lock token params to swap widget” (b093883)
UI Kit 1.0.9 — Patch
Update powered by reservoir to use logo (577658a)
UI Kit 1.0.9 — Patch
Fix total price impact copy (525e523)
UI Kit 1.0.9, Hooks 1.0.7 — Patch
Add onSuccess and onError callbacks for SwapWidget (813be48)
​
2024-06-14
SDK
UI Kit
​
RelayKit
SDK 1.0.4 — Patch
Add request to quote to be passed into execute function (6b5015b)
UI Kit 1.0.8 — Patch
Allow same currency swapping when different recipient (f0ecb82)
UI Kit 1.0.8 — Patch
Fix RelayKitProvider initialization (7361f60)
​
2024-06-13
SDK
UI Kit
Hooks
​
RelayKit
SDK 1.0.3 — Patch
Optimize the way we import lodash (772b657)
UI Kit 1.0.7 — Patch
Add app fee to breakdown ui (5759936)
UI Kit 1.0.7 — Patch
Fix info icon alignment (0c7e56c)
UI Kit 1.0.7 — Patch
Fix input icon position (a3d4c06)
UI Kit 1.0.7 — Patch
Filter token search by configured tokens (0a8325b)
Hooks 1.0.5 — Patch
Add useRelayConfig hook (2922c29)
​
2024-06-12
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.0.2, UI Kit 1.0.5, Hooks 1.0.4, Ethers adapter 9.0.2 — Patch
Strip layers from generated ui kit stylesheet (ce46e72)
UI Kit 1.0.6 — Patch
Add app name and fees to RelayKitProvider options (7aa524c)
UI Kit 1.0.6 — Patch
Add token change callbacks (9ad0dda)
UI Kit 1.0.6 — Patch
Fix theme override selector (7a073f8)
UI Kit 1.0.4, Hooks 1.0.3 — Patch
Make tanstack query a peer dependency (592feb1)
UI Kit 1.0.3 — Patch
Make wagmi a peer dependency (ac60282)
UI Kit 1.0.2, Hooks 1.0.2 — Patch
Fix esm import errors (2c6d3da)
​
2024-06-11
SDK
UI Kit
Hooks
Adapters
​
RelayKit
SDK 1.0.1, UI Kit 1.0.1, Hooks 1.0.1, Ethers adapter 9.0.1 — Patch
Fix deploy script (4a55654)
SDK 1.0.0, UI Kit 1.0.0, Hooks 1.0.0 — Major
Refactor SDK to simplify, add ui packages (ba72406)
​
2024-05-28
SDK
​
RelayKit
SDK 0.7.0 — Minor
Migrate to v2 of call and bridge api (a77e30f)
​
2024-05-24
SDK
​
RelayKit
SDK 0.6.2 — Patch
Make txs a first class parameter in swap action (820021e)
SDK 0.6.1 — Patch
Support swap + extra call txs (6ae4f8d)
​
2024-05-23
SDK
​
RelayKit
SDK 0.6.0 — Minor
Upgrade getSolverCapacity method to use config v2 api (309af6e)
SDK 0.6.0 — Patch
Add square icons to Relay Chain (96db714)
SDK 0.6.0 — Patch
Move sdk methods to actions (47a8aed)
SDK 0.6.0 — Patch
Add progress state (31fecc5)
SDK 0.6.0 — Patch
Improve typescript fee execute types (bce691b)
​
2024-05-21
SDK
​
RelayKit
SDK 0.5.4 — Patch
Post deposit transactions to solver (8ef9ba6)
SDK 0.5.4 — Patch
Fix return types for get quote methods (9799870)
​
2024-05-15
SDK
​
RelayKit
SDK 0.5.3 — Patch
Fix internal txhash chain id (dd34345)
​
2024-05-14
SDK
Adapters
​
RelayKit
SDK 0.5.2 — Patch
Await tx receipt for transaction steps (e795842)
SDK 0.5.1, Ethers adapter 6.0.1 — Patch
Swaps action and getSwapQuote method (597371e)
SDK 0.5.0 — Minor
Swap SDK action (74e12e1)
SDK 0.5.0 — Patch
Sync types (e0f2219)
​
2024-04-22
SDK
​
RelayKit
SDK 0.4.0 — Minor
Improve onProgress action callback to be easier to use (fc2f8ce)
SDK 0.4.0 — Patch
Update sdk readme (84a2ea8)
​
2024-04-18
SDK
​
RelayKit
SDK 0.3.10 — Patch
Sync api types + add useExactInput parameter to demo (0dbeb4a)
​
2024-04-09
SDK
​
RelayKit
SDK 0.3.9 — Patch
Remove requestId from Execute type (4239703)
​
2024-04-04
SDK
​
RelayKit
SDK 0.3.8 — Patch
Skip check object if bridge is canonical (19019b4)
​
2024-04-03
SDK
​
RelayKit
SDK 0.3.7 — Patch
Sync api types (96d0990)
​
2024-04-02
SDK
​
RelayKit
SDK 0.3.6 — Patch
Sync API types (c9d17bb)
​
2024-04-01
SDK
​
RelayKit
SDK 0.3.5 — Patch
Add currency id to RelayChain type (952b5a6)
SDK 0.3.4 — Patch
Sync api types (8bd3d17)
​
2024-03-19
SDK
​
RelayKit
SDK 0.3.3 — Patch
Handle inTxHashes for signature step items (0f291dc)
​
2024-03-15
SDK
​
RelayKit
SDK 0.3.2 — Patch
Add isValidatingSignature to step item (a76f067)
​
2024-03-12
SDK
​
RelayKit
SDK 0.3.1 — Patch
Sync api types and add erc20Currencies to RelayChain (f9dff0c)
​
2024-03-08
SDK
​
RelayKit
SDK 0.3.0 — Minor
Update bridge action to use new bridge api + usdc support (e41c632)
SDK 0.3.0 — Patch
Handle rainbow wallet bug where txHash of “null” is returned when tx rejected (a572a48)
​
2024-03-04
SDK
​
RelayKit
SDK 0.2.5 — Patch
Omit duplicate types from call and bridge action options (180d1c7)
SDK 0.2.5 — Patch
Return route breakdown in onProgress callback (4910cbf)
SDK 0.2.5 — Patch
Remove tx intent trigger api call (f454345)
​
2024-02-29
SDK
​
RelayKit
SDK 0.2.4 — Patch
Sync sdk types with api (ade63ae)
SDK 0.2.4 — Patch
Added readme to sdk (2624964)
​
2024-02-27
SDK
​
RelayKit
SDK 0.2.3 — Patch
Make wallet parameter optional for get quote methods (10c3e03)
​
2024-02-26
SDK
​
RelayKit
SDK 0.2.2 — Patch
Add ability to pass in a gasLimit for deposit transactions (90e4d58)
SDK 0.2.2 — Patch
Add currentStep and currentStep item to onProgress callback (8a5fdda)
​
2024-02-22
SDK
​
RelayKit
SDK 0.2.1 — Patch
Add getSolverCapacity, getCallQuote, getBridgeQuote methods (b59c35a)
​
2024-02-14
SDK
Adapters
​
RelayKit
SDK 0.2.0, Ethers adapter 3.0.0 — Minor
Handle mismatched chain prior to execution (53f089b)
SDK 0.2.0 — Patch
Add simplified bridge action for convenience (0fbab53)
​
2024-02-13
SDK
Adapters
​
RelayKit
SDK 0.1.0, Ethers adapter 2.0.0 — Minor
Upgrade wagmi, viem and rainbowkit to v2 (547425d)
SDK 0.1.0 — Patch
Automatic source detection (bad65fe)
​
2024-02-09
SDK
​
RelayKit
SDK 0.0.13 — Patch
Add source attribution parameter to call action (3c6c3fc)
​
2024-02-05
SDK
Adapters
​
RelayKit
SDK 0.0.12 — Patch
Improve chain conversion by using viem chains if available or fallback to api chain data (60854a6)
Ethers adapter 1.0.0 — Major
Relay SDK ethers wallet adapter (8b3f605)

Was this page helpful?

Yes
No
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform