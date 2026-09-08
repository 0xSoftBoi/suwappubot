# Relay API reference (digested from the full docs crawl, 2026-09-08)

Source: every `references/api/*` page of docs.relay.link, crawled to `docs-crawl/references__api__*.md` (61 files). This is the engineer's reference; the shorter reading is `01-technical.md` and the measured behaviour is `04-live-api-probe.md`.


*Source: Full crawl of `docs.relay.link` (`references/api/*`, ~61 pages) at `/home/user/suwappubot/docs/research/relay/docs-crawl/references__api__*.md`. Base URLs: `https://api.relay.link` (mainnet), `https://api.testnets.relay.link` (testnet). OpenAPI spec: `api.relay.link/documentation/json`.*

---

## 1. Endpoint Table

| Method | Path | Auth | Rate limit (default / elevated) | Purpose | Key request params | Key response fields | Status |
|---|---|---|---|---|---|---|---|
| POST | `/quote/v2` | optional `x-api-key` | 50/min → 10/s | Get executable quote (bridge/swap/call), Protocol v2 | `user, originChainId, destinationChainId, originCurrency, destinationCurrency, amount, tradeType`, +40 optional flags (§2) | `requestId, steps[], fees(deprecated), feeSponsorship, details, protocol.v2` | **Current** |
| POST | `/quote` | optional | 50/min | Legacy quote endpoint (identical schema to v2, no protocol niceties) | same as v2 | same shape as v2 | **Deprecated** — use `/quote/v2` |
| POST | `/price` | optional | 200/min | Lightweight quote, no calldata/steps | subset of quote params | `fees, details` (no steps) | **Deprecated**, replaced by `/quote/v2` |
| POST | `/execute` | required | 200/min | Execute a gasless transaction (`executionKind: "rawCalls"`, supports EIP-7702 `authorizationList`) | `executionKind, data{chainId,to,data,value,authorizationList[]}, executionOptions{subsidizeFees,referrer}, requestId?` | `message, requestId` | Current |
| POST | `/execute/permits` | optional | 200/min | Submit a signed permit (`authorize1`/`authorize2` step follow-up) | query `signature`; body `kind, requestId, api?(bridge\|swap\|user-swap)` | `message, steps[]` | Current |
| GET | `/intents/status` | optional | 200/min | Legacy execution status | `requestId` | `status(failure\|fallback\|pending\|received\|success), details, inTxHashes, txHashes, time, originChainId, destinationChainId` | **Deprecated** — use `/intents/status/v3` |
| GET | `/intents/status/v3` | optional | 200/min → 10/s | Current execution status | `requestId` | `status(waiting\|depositing\|pending\|submitted\|success\|delayed\|refund\|failure), details, inTxHashes, txHashes, updatedAt, originChainId, destinationChainId, quoteCreatedAt, failReason(enum, ~70 values), refundFailReason(enum, 5 values)` | **Current** |
| GET | `/requests/v2` | optional | 200/min → 10/s (shared w/ v3) | List transactions (legacy shape) | `limit(≤50), continuation, user, hash, originChainId, destinationChainId, id, orderId, includeOrderData, startTimestamp, endTimestamp, startBlock, endBlock, chainId, referrer, depositAddress, includeChildRequests, includeAuthenticatedData, status, apiKey, sortBy, sortDirection` | `requests[], continuation, deprecation{...}` — every response carries `Deprecation`/`Sunset`/`Link` headers | **Deprecated** (deprecated Jul 22 2026, rate-limit throttled from Sep 1 2026, retired Nov 24 2026) — use `/requests/v3` |
| GET | `/requests/v3` | **required** `x-api-key` | 200/min → 20/s (own bucket) | List transactions, richer filters | `limit, continuation, includeTotal, user, term, id, orderId, depositTxHash, fillTxHash, refundTxHash, originChainId, destinationChainId, chainId, privateChainsToInclude, depositAddress, recipient, status, failReason, refundFailReason, apiKey, requestType, referrer(+apiKey required), currencyIn/OutChainId/Address/Symbol, sortBy(createdAt\|updatedAt\|amountUsd), sortDirection, startTimestamp, endTimestamp, startBlock, endBlock, amountUsdMin/Max, appFeesAmountUsdMin/Max, fillTimeMin/Max, features, includeAuthenticatedData, includeChildRequests, filters(JSON filter-groups, AND within group/OR across groups, `not:` negation, `null` = existence check)` | `requests[]` (see §3 for full shape), `continuation, total` | **Current** |
| GET | `/config/v2` | optional | 200/min | Solver capacity + user balance | `originChainId, destinationChainId, user?, currency?(enum of ids)` | `enabled, user{balance,maxBridgeAmount}, fee, solver{address,balance,capacityPerRequest}, supportsExternalLiquidity` | **Deprecated** — replaced by `/quote/v2` |
| GET | `/chains` | optional | 200/min | All chains + config | `includeChains` | `chains[]` — see §5 for schema | Current |
| GET | `/chains/liquidity` | optional | 200/min | Solver liquidity per currency on a chain | `chainId` (required) | `liquidity[]{chainId,currencyId,symbol,address,decimals,balance,amountUsd}` | Current |
| POST | `/currencies/v1` | optional | 200/min | Curated token metadata (grouped by ID across chains) | `defaultList, chainIds[], term, address, currencyId, tokens[], verified, limit, includeAllChains, useExternalSearch, depositAddressOnly` | `[[{groupID,chainId,address,symbol,name,decimals,vmType,metadata}]]` (nested array by group) | **Deprecated** — use v2 |
| POST | `/currencies/v2` | optional | 200/min | Curated token metadata (flat) | same as v1 (limit default 20, max 100) | `[{chainId,address,symbol,name,decimals,vmType,metadata}]` | Current |
| GET | `/currencies/token/price` | optional | 200/min | Token USD price | `address, chainId` (both required) | `{price: number}` | Current |
| GET | `/swap-sources` | optional | 200/min | List all DEX/swap sources usable in `includedSwapSources`/`excludedSwapSources` | `chainId?` | `{sources: string[]}` | Current |
| POST | `/transactions/single` | optional | 200/min | Index same-chain transfers/wraps/unwraps (not auto-indexed) | `requestId, chainId, tx` (stringified tx incl. `txHash`) | `{message}` | Current |
| POST | `/transactions/index` | optional | 200/min | Accelerate indexing / detect internal deposits via trace analysis (cross-chain, proxy contracts) | `chainId, txHash, requestId?` | `{message}` (404 if tx not found/unconfirmed) | Current |
| POST | `/transactions/deposit-address/reindex` | optional | 200/min | Reindex a deposit address for missed deposits | `chainId, depositAddress, targetChainId?, currency?, sweep?(deprecated, no-op)` | `{message, triggeredCurrencies[], checkedCurrencies, failedCurrencies}` | Current |
| POST | `/fast-fill` | **required** | 200/min | Accelerate a destination fill (app pays fill upfront from its USDC balance) | `requestId, solverInputCurrencyAmount?, maxFillAmountUsd?` | `{message: "Request successfully queued for fast fill."}` | Current |
| POST | `/withdrawals/attest-deposit` | optional | 200/min | Attest a deposit tx so funds become claimable via withdrawal flow (numeric Relay chain id here, not protocol slug) | `chainId(number), transactionId` | `200 default response` | Current, unversioned |
| POST | `/withdrawals/request` | optional | 200/min | Prepare (no signature) then execute (with signature) a Depository withdrawal | `chainId(slug), currency, amount, ownerChainId(slug), owner, recipient, nonce?, additionalData?, signature?` | prepare → `{nonce, validated amount, additionalData}`; execute → `{jobId}` | Current, unversioned |
| GET | `/withdrawals/status` | optional | 200/min | Poll a user-triggered withdrawal job (24h retention) | `id` (=jobId) required | `{status, transaction, withdrawal, txHash, reason}` | Current, unversioned |
| GET | `/app-fees/{wallet}/balances` | optional | 200/min | App fee balances for a wallet | path `wallet` | `{balances[]{currency,amount,amountFormatted,amountUsd,minimumAmount}, totalBalanceUsd, outstandingFastFillBalanceUsd, availableBalanceUsd}` | Current |
| POST | `/app-fees/{wallet}/claim` | optional | 200/min | Claim accrued app fees (returns `authorize` step) | path `wallet`; body `chainId, currency, recipient, amount?` | `{steps[]}` — `authorize` (EIP-191) step | Current |
| GET | `/metrics/usage` | optional (integrator key) | 200/min | API call counts by endpoint/status/error code | `granularity(minutely\|hourly\|daily), startTimestamp, endTimestamp, apiKey(≤50, csv)` | `{metrics[]{apiKey,timestamp,endpoint,statusCode,errorCode,count}}` | Current |
| — | `/authorize` (referenced in rate-limit doc, no dedicated page found) | required | 5/min per (key,wallet), 30/min aggregate/key | On-chain authorization path (used by Hyperliquid nonce-mapping, etc.) | bucketed by `wallet` field | — | Current |

Elevated limits (on request): `/quote` 10 rps, `/requests`+`/requests/v2` share a 10 rps bucket, `/requests/v3` own 20 rps bucket, `/transactions/status` 10 rps.

---

## 2. `POST /quote/v2` — Full Field Reference

Request/response shapes are **identical** between `/quote` (deprecated) and `/quote/v2` (current) except v2 documents a few extra "learn more" cross-links; both are documented at `references__api__get-quote.md` / `get-quote-v2.md`.

### 2.1 Request body — every field

Required core:
- `user` (string, required) — depositing/signing address on origin.
- `originChainId` / `destinationChainId` (number, required).
- `originCurrency` / `destinationCurrency` (string, required) — `0x000...0` = native.
- `amount` (string, required, pattern `^[0-9]+$`) — smallest unit; meaning depends on `tradeType`.
- `tradeType` (enum, required): `EXACT_INPUT | EXACT_OUTPUT | EXPECTED_OUTPUT` (see §3.1).

Optional (full list, with exact semantics from the docs):
- `recipient` (string) — defaults to `user`.
- `txs` (object[]) — destination-chain calls `{to, value, data}`; used for cross-chain calling.
- `txsGasLimit` (number) — total gas limit for `txs`.
- `authorizationList` (object[]) — EIP-7702 authorization list for destination execution `{chainId, address, nonce, yParity, r, s}`.
- `additionalData` (object) — route-specific extra data.
- `referrer` (string) — free-text attribution tag, echoed in webhooks/requests.
- `referrerAddress` (string, `^0x[a-fA-F0-9]{40}$`).
- `refundTo` (string) — origin-chain refund address; **if omitted, automatic refund is disabled**.
- `recoveryAddress` (string) — origin-chain fund-recovery address for deposit addresses; requires `useDepositAddress=true`.
- `refundOnOrigin` (boolean, **deprecated**) — always refund on origin.
- `topupGas` (boolean) — include a destination gas top-up to the recipient (EVM only, non-gas-currency output).
- `topupGasAmount` (string) — top-up amount in USD decimal format, e.g. `100000` = $1; default `2000000` ($2); requires `topupGas`.
- `enableTrueExactOutput` (boolean, default `false`) — for EXACT_OUTPUT, sends swap surplus to solver EOA instead of sweeping to recipient.
- `explicitDeposit` (boolean, default `true`) — `false` = implicit deposit (1 tx, EOA-only); `true` = explicit approve+depositErc20 (2 tx, required for smart wallets and for **builder codes**). Only relevant EVM + Protocol v2.
- `useExternalLiquidity` (boolean) — enables "canonical+" bridging, trades speed for more liquidity.
- `useFallbacks` (boolean) — enable specific fallback routes.
- `usePermit` (boolean) — use EIP-3009/permit for supported currencies (e.g. USDC).
- `permitExpiry` (number) — permit validity window in seconds, default 10 min.
- `includeProtocolData` (boolean) — returns full `protocol.v2` block (order data + `orderSignature`); may increase latency. Required for input-validation flow (§3).
- `useDepositAddress` (boolean) — use a deposit address when calldata can't be sent with the origin tx (native-currency bridges, Bitcoin, etc.); does **not** support `sponsoredFeeComponents`.
- `strict` (boolean, **deprecated**, ignored by v2).
- `slippageTolerance` (string, bps, `^([0-9]{1,4}|10000)$`, 0–10000) — auto-calculated if omitted.
- `latePaymentSlippageTolerance` (string, bps, 0–10000) — slippage allowance for destination gas if deposit lands after order deadline.
- `appFees` (object[]) — integrator fee config (see App Fees doc, bps-based).
- `gasLimitForDepositSpecifiedTxs` (number) — required explicit gas limit when `txs` are executed during the deposit tx.
- `forceSolverExecution` (boolean) — force solver execution even for same-chain swaps (which self-execute by default).
- `subsidizeFees` (boolean) — sponsor pays fees (Fee Sponsorship), includes gas top-ups.
- `sponsoredFeeComponents` (enum[]: `execution, swap, relay, app, rent`, min length 1) — which components to sponsor; requires `subsidizeFees=true`; default = `execution, swap, relay, app` (rent stays user-paid unless explicit).
- `maxSubsidizationAmount` (string) — cap in USDC decimal format (e.g. `1000000` = $1); sponsor covers up to cap, user pays remainder.
- `subsidizationBps` (integer, 0–10000) — % of each sponsored component the sponsor covers; default full coverage; applied before `maxSubsidizationAmount`.
- `subsidizeRent` (boolean, **deprecated**) — alias that adds `rent` to `sponsoredFeeComponents`.
- `includedSwapSources` / `excludedSwapSources` (string[]) — restrict/exclude DEX sources globally.
- `includedOriginSwapSources` / `includedDestinationSwapSources` (string[]) — restrict per-leg (useful for Solana tx-size mitigation).
- `originGasOverhead` (number) — gas overhead for origin chain when solver executes a gasless origin tx.
- `depositFeePayer` (string) — Solana fee/rent payer account for deposit tx.
- `maxRouteLength` (number) — max hops for Solana swap routing (recommended: 4, then 3 if still oversized).
- `useSharedAccounts` (boolean) — prevents certain ATA-creation instructions on Solana.
- `includeComputeUnitLimit` (boolean) — include compute-unit-limit instruction for Solana origin requests.
- `overridePriceImpact` (boolean) — ignore price-impact errors.
- `disableSwapProviderPreference` (boolean) — disable preferred swap-provider selection.
- `disableOriginSwaps` (boolean) — disable origin-side swaps.
- `indicativeQuote` (boolean) — return an inexecutable preview quote.
- `fixedRate` (string) — rate to charge for fixed-spread quotes.
- `ttl` (number) — quote time-to-live in seconds from generation; unfilled after this window → refund instead of fill.

### 2.2 Response — every top-level field

- `requestId` (string) — unique quote/execution identifier.
- `steps[]` — execution recipe (see §3.2 for full step schema): `{id, action, description, kind(transaction|signature), requestId, items[]{status, data, check{endpoint,method}}}`.
- `fees` (object, **deprecated** — kept for back-compat) — `gas, relayer, relayerGas, relayerService, app, subsidized`, each `{currency, amount, amountFormatted, amountUsd, minimumAmount}`. Use `details.expandedPriceImpact` / `data.fees` (requests v3) instead.
- `feeSponsorship` (object) — `quoted` and `actual` sub-objects, each: `selectedComponents[]` (which of `execution/swap/relay/app/rent` are sponsored), `capHit`(bool), `components{execution,swap,relay,app,rent}` each `{selected, total{...}, sponsored{...}, userPays{...}}`, `sponsoredTotal{...}`, `userPaysTotal{...}`, `maxSubsidizationAmount`, `subsidizationBps`; `actual` additionally has `sponsorPayment{amount,address,chainId}`.
- `details` (object) — swap/bridge summary:
  - `operation`, `sender`, `recipient`
  - `currencyIn` / `currencyOut` / `refundCurrency` / `currencyGasTopup` — each `{currency{chainId,address,symbol,name,decimals,metadata{logoURI,verified,isNative}}, amount, amountFormatted, amountUsd, minimumAmount}`
  - `totalImpact{usd,percent}`, `swapImpact{usd,percent}`
  - `expandedPriceImpact{swap{usd},execution{usd},relay{usd},app{usd},sponsored{usd}}` — current source of truth for fee display (maps to `data.fees` in requests v3)
  - `rate` (string)
  - `slippageTolerance{total, origin{usd,value,percent}, destination{usd,value,percent}}`
  - `timeEstimate` (number, seconds/blocks)
  - `userBalance` (string)
  - `fallbackType` (string)
  - `isFixedRate` (bool), `fixedRateFee{usd}`
  - `route{origin{inputCurrency,outputCurrency,router,includedSwapSources[]}, destination{...same...}}`
- `protocol.v2` — `{orderId, hubType("onchain"), orderData(<unknown> unless includeProtocolData=true, then full order — see §3 input-validation for shape), orderSignature, paymentDetails{chainId,depository,currency,amount}}`.

### 2.3 Full `protocol.v2.orderData` shape (from Input Validation guide, with `includeProtocolData:true`)
```json
{
  "protocol": {
    "v2": {
      "orderId": "0xd4f71fa1...",
      "hubType": "onchain",
      "orderData": {
        "version": "v1",
        "solverChainId": "base",
        "solver": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
        "salt": "0xfd83...",
        "inputs": [{ "payment": {"chainId":"ethereum","currency":"0x000...","amount":"100000000000000000","weight":"1"}, "refunds": ["..."] }],
        "output": {
          "chainId": "base",
          "payments": [{"recipient":"0xf3d6...","currency":"0x000...","minimumAmount":"97991321030687428","expectedAmount":"99991143908864722"}],
          "calls": [],
          "deadline": 1788888266,
          "extraData": "0x000...b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"
        },
        "fees": []
      },
      "orderSignature": "0x...",
      "paymentDetails": {"chainId":"ethereum","depository":"0x4cd00e387622c35bddb9b4c962c136462338bc31","currency":"0x000...","amount":"100000000000000000"}
    }
  }
}
```
`orderSignature` is the solver's EIP-191 signature over the 32-byte order ID, signed by EVM solver `0xf70da97812CB96acDF810712Aa562db8dfA3dbEF` on every EVM chain — verifiable onchain via `ECDSA.recover`.

---

## 3. Core Concepts

### 3.1 Trade Types
- **EXACT_INPUT** — user specifies input amount; output varies; fails if input too small to cover fees.
- **EXPECTED_OUTPUT** — user specifies approximate desired output; input is computed; actual output can vary with slippage; auto-accounts for fees; recommended when exact output isn't required or destination calls aren't involved.
- **EXACT_OUTPUT** — user specifies exact output; input computed to guarantee it; if unfillable, request fails and origin refund issues; auto-accounts for fees; recommended for exact-payment/destination-call scenarios (e.g. minting exact ERC20 amount). Destination calls also support `EXACT_INPUT` to cap spend with variable output.

### 3.2 Step Execution
Flow: fetch quote → iterate `steps[]` (skip empty-item steps) → execute each item by `kind` (`transaction`|`signature`) → poll `check.endpoint` until `success` → done.

**Step IDs (transaction kind):**
| id | purpose |
|---|---|
| `deposit` | deposit funds to relayer for cross-chain execution |
| `approve` / `approval` | ERC20 approval before deposit/swap |
| `swap` | same-chain swap execution |
| `send` | same-asset, same-chain transfer to different recipient |

**Step IDs (signature kind):**
| id | purpose |
|---|---|
| `authorize` | (1) claim app fees — EIP-191 wallet-ownership proof, or (2) Hyperliquid v2 nonce-mapping |
| `authorize1` | cross-chain permit (Permit2 / EIP-3009 TransferWithAuthorization) |
| `authorize2` | same-chain swap permit (`PermitBatchWitnessTransferFrom`, Permit2) |

Common flows: `deposit` (single-step bridge/swap), `swap` (same-chain), `approve→deposit`, `approve→swap`, `authorize1` (gasless permit transfer). Each signature step has `data.sign{signatureKind: eip191|eip712, ...}` and `data.post{endpoint, method, body}`; post the signature as a query param to the `post.endpoint`. Each item optionally has `check{endpoint, method}` to poll — always `/intents/status/v3?requestId=...`.

Top-level quote object also returns `fees`, `breakdown{value,timeEstimate}`, `balances{userBalance,requiredToSolve}` alongside `steps`.

### 3.3 Handling Quote Errors (`/quote/v2`)
**Expected/handleable errors** (32 codes): `AMOUNT_TOO_LOW, CHAIN_DISABLED, EXTRA_TXS_NOT_SUPPORTED, FORBIDDEN, INSUFFICIENT_FUNDS, INSUFFICIENT_LIQUIDITY, INVALID_ADDRESS, INVALID_EXTRA_TXS, INVALID_GAS_LIMIT_FOR_DEPOSIT_SPECIFIED_TXS, INVALID_INPUT_CURRENCY, INVALID_OUTPUT_CURRENCY, INVALID_RECIPIENT, INVALID_SLIPPAGE_TOLERANCE, NO_INTERNAL_SWAP_ROUTES_FOUND, NO_QUOTES, NO_SWAP_ROUTES_FOUND, PRICE_FETCH_FAILED(503,retry), REQUEST_TIMED_OUT(retry), ROUTE_TEMPORARILY_RESTRICTED, RPC_HTTP_ERROR(retry), SANCTIONED_CURRENCY, SANCTIONED_WALLET_ADDRESS, SERVICE_UNAVAILABLE(503,retry), SOLANA_TX_TOO_LARGE, SWAP_IMPACT_TOO_HIGH, UNAUTHORIZED, UNSUPPORTED_CHAIN, UNSUPPORTED_CURRENCY, UNSUPPORTED_EXECUTION_TYPE, UNSUPPORTED_ROUTE, USER_RECIPIENT_MISMATCH`.
**Unexpected/infra errors**: `DESTINATION_TX_FAILED, ERC20_ROUTER_ADDRESS_NOT_FOUND, UNKNOWN_ERROR, SWAP_QUOTE_FAILED, PERMIT_FAILED`.
Example error body: `{"message":"...", "errorCode":"INVALID_INPUT_CURRENCY"}` (some also carry `errorData`, e.g. `DESTINATION_TX_FAILED`).

### 3.4 Execution Errors (post-submission, on the request object)
`failReason` (fill failures) — grouped by category, ~70 codes total (full enum reproduced in `/intents/status/v3` response schema above and in `/requests/v3` `failReason` query param). Categories: Deposit & Validation (`DEPOSIT_CHAIN_MISMATCH, INCORRECT_DEPOSIT_CURRENCY, DOUBLE_SPEND, DEPOSITED_AMOUNT_TOO_LOW_TO_FILL, ORIGIN_CURRENCY_MISMATCH, TTL_EXPIRED, DEPOSIT_CONFIRMATION_TIMEOUT, DEPOSIT_REORGED, ORPHANED_DEPOSIT_REFUND, BLOCKED_WALLET`); Solver Capacity & Balance (`SOLVER_CAPACITY_EXCEEDED, SOLVER_BALANCE_TOO_LOW, SPONSOR_BALANCE_TOO_LOW, INSUFFICIENT_FUNDS_FOR_RENT, NEGATIVE_NEW_AMOUNT_AFTER_FEES, AMOUNT_TOO_LOW_TO_REFUND, GASLESS_PERMIT_BALANCE_TOO_LOW`); Swap Routing & Pricing (`NO_QUOTES, NO_INTERNAL_SWAP_ROUTES_FOUND, SWAP_IMPACT_TOO_HIGH, INSUFFICIENT_POOL_LIQUIDITY, SLIPPAGE, TOO_LITTLE_RECEIVED, GENERATE_SWAP_FAILED, REVERSE_SWAP_FAILED`); Tx Construction & Gas (`TRANSACTION_TOO_LARGE, SWAP_USES_TOO_MUCH_GAS, NEW_CALLDATA_INCLUDES_HIGHER_RENT_FEE, INVALID_GAS_PRICE, QUOTED_GAS_LIMIT_EXCEEDED, JUPITER_INVALID_TOKEN_ACCOUNT, TRANSACTION_SUBMISSION_FAILED, TRANSACTION_NOT_INCLUDED`); Onchain Execution & Revert (`EXECUTION_REVERTED, TRANSACTION_REVERTED, MISSING_REVERT_DATA, CONTRACT_PAUSED, TOKEN_NOT_TRANSFERABLE, TRANSFER_FAILED, TRANSFER_FROM_FAILED, TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE, TRANSFER_AMOUNT_EXCEEDS_BALANCE, INSUFFICIENT_NATIVE_TOKENS_SUPPLIED, INCORRECT_PAYMENT, ZERO_SELL_AMOUNT, INVALID_SENDER, INVALID_SIGNER, DESTINATION_TOKEN_TRANSFER_REJECTED`); Order & Signature (`ORDER_EXPIRED, ORDER_IS_CANCELLED, ORDER_ALREADY_FILLED, SIGNATURE_EXPIRED, INVALID_SIGNATURE, INVALID_NONCE, SEAPORT_INEXACT_FRACTION, SEAPORT_INVALID_FULFILLER, PROTOCOL_DEADLINE_EXPIRED`); Account Abstraction (`ACCOUNT_ABSTRACTION_INVALID_NONCE, ACCOUNT_ABSTRACTION_SIGNATURE_ERROR, ACCOUNT_ABSTRACTION_GAS_LIMIT`); NFT Minting (`MINT_NOT_ACTIVE, ERC_1155_TOO_MANY_REQUESTED, MINT_QUANTITY_EXCEEDS_MAX_PER_WALLET, MINT_QUANTITY_EXCEEDS_MAX_SUPPLY`); Other (`FLUID_DEX_ERROR, MANUAL_ADMIN_REFUND, UNKNOWN, N/A`).
`refundFailReason` (refund-leg failures, defaults `N/A`): `AMOUNT_TOO_LOW_TO_REFUND, NEGATIVE_NEW_AMOUNT_AFTER_FEES, SWAP_CURRENCY_NOT_ON_ORIGIN, REFUND_RECIPIENT_IS_VASP, MANUAL_REFUND_REQUIRED, N/A`. (Note: `DEPOSIT_ADDRESS_MISMATCH` and `MANUAL_REFUND_REQUIRED` appear in the `/intents/status/v3` and `/requests/v3` enums but not in the standalone execution-errors table — treat both docs' enums as authoritative union.)

### 3.5 Refunds
Paid on origin chain to `refundTo` (auto-refund disabled if unset). Triggers: tx revert, wallet-switch mismatch, under-deposit, destination outage, duplicate/missing request-ID in calldata, quote-regeneration causing output below `currencyOut.minimumAmount`. Refund amount = post-gas, and if an origin swap occurred, whatever the depository actually received after that swap (not original deposit amount). No refund if amount < gas cost. Refund currency = one of the route's `solverCurrencies` (native/stable), tries to match original send currency. Automatic and near-instant. Force a refund for testing: pass `referrer: "debug-force-refund"`.

### 3.6 Surplus & Shortage
Origin ops can land **Exact**, **Surplus** (positive slippage — solver got more than quoted), or **Shortage** (negative slippage — less than quoted). Solver proceeds if it can still swap the actual amount at ≥ the quoted rate; otherwise behavior follows failure/refund paths. Surplus → user typically gets extra; Shortage → user typically gets slightly less.

### 3.7 Wallet Detection (`explicitDeposit`)
Protocol v2 EVM ERC20 deposits: **implicit** (`explicitDeposit:false`, 1 tx, EOA-only, direct transfer w/ order-ID calldata) vs **explicit** (`explicitDeposit:true`, approve + `depositErc20`, works for all wallets, batchable). Detection: (1) EIP-5792 `getCapabilities` (`atomicBatch`, `paymasterService`, `auxiliaryFunds`, `sessionKeys`), (2) contract-code presence (`getCode`), (3) EIP-7702 delegation (`0xef01` code prefix → still needs `explicitDeposit:true`). `isEOA = !hasSmartWalletCapabilities && !hasCode && !isEIP7702Delegated`. Safety overrides: force `explicitDeposit:true` if native balance is 0, or tx count ≤ 1. Default fallback on detection error: `explicitDeposit:true`. Not relevant for native ETH deposits.

### 3.8 Input Validation (replaces the removed signature API)
`GET /requests/:requestId/signature` and `/signature/v2` are **removed** (404). New flow requires `includeProtocolData:true` on `/quote/v2`, then locally: (1) read `output.payments[].recipient/minimumAmount/currency`, `output.chainId`, `inputs[].payment.amount/currency`, `output.deadline` — compare `minimumAmount` (protocol-enforced floor), not `expectedAmount`; (2) recompute `orderId` via `@relay-protocol/settlement-sdk`'s `getOrderId(orderData, CHAINS)` using a VM-type map built from `GET /chains` (`bvm→bitcoin-vm, evm→ethereum-vm, hypevm→hyperliquid-vm, lvm→lighter-vm, svm→solana-vm, tonvm→ton-vm, tvm→tron-vm, xrpvm→xrp-vm`), and compare against `protocol.v2.orderId`; (3) confirm the deposit tx pays the **canonical depository from `GET /chains`** (not `protocol.v2.depository` from the quote — that would let a tampered response self-validate), passes the recomputed order ID as the deposit `id` argument to `depositNative(address,bytes32)` / `depositErc20(address,address,uint256,bytes32)`, uses the correct function per `payment.currency`, and moves exactly `payment.amount`. Onchain verification alternative: recover the EIP-191 signer of `orderSignature` over the raw order-ID bytes and require it equals the fixed Relay EVM solver address. Deposit-address flows are **not yet verifiable this way** (no calldata to bind an order ID to) — contact Relay if needed.

### 3.9 Contract Compatibility
Relayer executes via Vectorized's gas-optimized `Multicaller` contract (except simple empty-calldata bridges, sent directly). Since `msg.sender` = Multicaller/Relayer, not the user: use **Unauthenticated Delegation** (pass a beneficiary address for net-beneficial actions like mint/deposit/bid — never for sell/withdraw/cancel; use a router contract if no native delegation exists), **Authenticated Delegation** (custom signature auth; future: permit signatures, `MulticallerWithSigner`, ERC-2771 forwarder), or **Just-In-Time Gas** (bridge a small gas amount, have the user execute directly — fully backward-compatible, manual today).

### 3.10 Fees — exact schedule
Four components: **Execution Cost** ($0.02 flat + destination fill gas estimate always; + origin gas estimate only for gasless txs — regular txs pay origin gas directly, not counted here), **Swap Cost** (DEX fees, DEX impact, solver rebalancing; Hyperliquid passes through a $1 activation fee Relay cannot waive), **Platform Fees** (flat bps, table below), **App Fees** (integrator-added, on top).

Platform Fees charged to end users:
| Type | Bps |
|---|---|
| Token Bridge & Same-Chain Wrap/Unwrap | 0.00% |
| Stablecoin Swap | 0.01% |
| Major Swap | 0.06% |
| Minor Swap | 0.15% |

Integrator revenue share (requires: API key on quote + KYB + >$10M trailing-30d volume + EVM payout address; cannot be used to discount the product to users):
| Volume tier | Bridge/Wrap | Stablecoin | Major | Minor |
|---|---|---|---|---|
| $10M–$100M | 0% | 34% | 25% | 33.33% |
| $100M–$1B | 0% | 67% | 50% | 66.67% |

Definitions: **Major Stablecoin** = USDC, USDC.e, USDT, USDT0, DAI, USDe, USDS, USD1, PYUSD, USDG, mUSD, USDm, USDH, pUSD, PlumeUSD. **Major Token** = ETH, WETH, BTC, WBTC, SOL, WSOL, POL, BNB, PLUME.
API surfacing: `GET /requests/v3` → `data.fees.{quoted,actual}.{execution,swap,platform,app,sponsored}` (USD-denominated); quote API / `/requests/v2` use `expandedPriceImpact` with `relay` instead of `platform`. The top-level `fees` object (both quote and requests/v2) is **deprecated** — raw-wei only, doesn't include full cost breakdown; its sub-fields are `relayerService, relayerGas, relayer(=service+gas), app, subsidized`.

### 3.11 Rate Limits — see §1 table (API keys doc). Recovery guidance: cache static config (chains/currencies), debounce `/quote` input, validate client-side before quoting, widen/stop status polling once terminal, use `GET /requests/v3` for bulk fetch instead of per-ID polling, exponential backoff on 429, then move to webhooks/websockets before requesting an elevated limit via the Dashboard support widget.

---

## 4. Guides

### 4.1 Bridging Integration Guide
3-step flow: get quote (`EXACT_INPUT`/`EXPECTED_OUTPUT`/`EXACT_OUTPUT`) → execute steps → poll `/intents/status/v3?requestId=...` (1/sec, or use webhook/websocket). Pre-flight: verify balance, check chain support, keep quotes fresh, handle errors.

### 4.2 Call Execution (Calling) Integration Guide
Cross-chain arbitrary contract calls via `txs[]` in the quote request. `EXACT_OUTPUT` allows precomputed multi-call calldata (e.g. approve Aave pool + `supply()` fixed amount). `EXACT_INPUT` has variable output, so integrators typically need a **destination proxy contract** that reads its live balance at execution time and builds follow-up calldata dynamically (pull full approved balance → approve target → call with live balance). ERC20 calls require an approval tx before the spending tx in `txs[]`. Router sweep helpers: `cleanupErc20s`, `cleanupNative` (call via `txs` against the router contract). `Quote Parameters for Cross-Chain Calls`: `amount`(sum of all `txs[].value`), `tradeType`, `txs[].{to,value,data}`. Preflight checklist covers contract compatibility, approvals, `amount` sum-check, tradeType choice, proxy-contract planning for EXACT_INPUT, calldata validation, testing, gas estimation.

### 4.3 Deep Linking
**Bridge page** `relay.link/bridge/{chainName}` (spaces→dashes) query params: `toAddress, amount, fromChainId, fromCurrency, toCurrency, tradeType(EXACT_INPUT|EXPECTED_OUTPUT|EXACT_OUTPUT)`. **Dedicated chain pages** support the same params plus `fromChainId`. **Onramp page** `relay.link/onramp/{chainName}`: `toAddress, toCurrency`. Unsupported chains for deep-linking: Forma, Gravity, Hychain, Onchain Points, Powerloom, Sanko, Kai. Example: `relay.link/bridge/arbitrum?fromChainId=8453&fromCurrency=0x8335...&toCurrency=0xaf88...&amount=100`.

### 4.4 Smart Accounts
ERC-4337 (paymaster-sponsored txs, bundled `approve→swap→send` UserOperations, Safe/Kernel support) and EIP-7702 (turns EOAs into smart accounts so the user is `msg.sender` on destination, preserves intent/gas delegation across chains, avoids destination smart-account deployment). Solves: msg.sender mismatch, batching after bridge, flexible gas payment, temporary smart-account behavior for EOAs.

### 4.5 Testnet Support
Base URL `https://api.testnets.relay.link` for API/SDK; supported testnets: Base Sepolia (84532), Sepolia (11155111), tokens "All". Testnets not recommended for swap-testing (illiquid) — use cheap L2s (Base/Arbitrum) instead for swaps. Query `https://api.testnets.relay.link/chains` for the live list.

### 4.6 Transaction Indexing
Two APIs: `POST /transactions/single` (same-chain transfers/wraps/unwraps — not auto-monitored; body: `requestId, chainId, tx`) and `POST /transactions/index` (accelerates indexing + detects internal deposits via trace analysis, critical for custom proxy contracts; body: `chainId, txHash`; call immediately after broadcast, before confirmation; Bitcoin: wait ≥1 confirmation or get 404). Decision matrix: cross-chain/proxy/same-chain-swap txs → `transactions/index`; same-chain transfers/wraps/unwraps → `transactions/single`.

### 4.7 Webhooks
Self-serve per API key in Dashboard (one endpoint per key, optional custom headers). Statuses streamed: `waiting, depositing, pending, submitted, success, failure, refund`. Payload:
```json
{
  "event": "request.status.updated",
  "timestamp": 1774993296140,
  "data": {
    "status": "refund",
    "inTxHashes": ["0x..."], "txHashes": [],
    "updatedAt": 1774993296121,
    "originChainId": 8453, "destinationChainId": 42161,
    "depositAddress": {"address":"0x..","depositAddressType":"open","depositor":"0x..","depositTxHash":"0x.."},
    "requestId": "0x...", "referrer": "your-referrer",
    "details": null, "failReason": "DOUBLE_SPEND", "refundFailReason": "N/A"
  }
}
```
Verification headers: `X-Signature-Timestamp`, `X-Signature-SHA256` = `HMAC-SHA256(apiKey, "${timestamp}.${body}")`, compare with `crypto.timingSafeEqual`; reject non-matching with non-2xx. Delivery: up to 10 retries w/ exponential backoff built-in; recommend a gateway (e.g. Hookdeck) for guaranteed delivery/fan-out/replay in production.

### 4.8 Websockets
`wss://ws.relay.link?apiKey=YOUR_API_KEY`. Wait for `{"type":"connection","status":"ready","data":{"id":"..."}}` before sending. Subscribe: `{"type":"subscribe","event":"request.status.updated","filters":{"id":"0x..."}}`; unsubscribe same shape with `"type":"unsubscribe"` (not required on disconnect — server auto-cleans). Server does rolling restarts for deploys — reconnect logic required. Same status enum as webhooks.

### 4.9 Builder Codes (Base)
ERC-8021 `dataSuffix` appended to the **deposit step's calldata only** (`1-byte length + ASCII code + 0x00 version + 0x8021×8 marker`). Requires `explicitDeposit:true` + `protocolVersion:"v2"` (Depository order-ID tracking survives trailing bytes; implicit/calldata-matched deposits would break). Only works for Depository-routed quotes — same-chain swaps unsupported.

### 4.10 Bitcoin Support
Chain ID `8253038`; native BTC address `bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8` (decimals 8). Case-sensitive addresses. Withdrawals return **PSBT** instead of EVM calldata (sign via `signPsbt` callback, base64). Balance = UTXO model, computed via mempool.space `funded_txo_sum - spent_txo_sum - mempool spent`. Deposit-address block confirmations: 1 block typical, 2 blocks for high-value deposits (per-currency threshold); `timeEstimate` reflects which rule applies. Manual reindex: `POST /transactions/index` with `chainId:8253038` + Bitcoin txHash (requires ≥1 confirmation, else 404). SDK: `@relayprotocol/relay-bitcoin-wallet-adapter`.

### 4.11 Solana Support
Chain ID `792703809`. Case-sensitive addresses; supports any Jupiter-tradeable token. Common tokens: SOL (`111...111`, 9dp), USDC (`EPjF...`, 6dp), wSOL (`So11...112`, 9dp), USDT (`Es9v...`, 6dp). Transaction size hard-gated at Solana's **1232-byte wire limit** at quote time — `POST /quote`, `/quote/v2`, `/price` all return `400 SOLANA_TX_TOO_LARGE` with measured size and overage if the compiled tx would exceed it. Mitigations: `includedOriginSwapSources:["jupiter"]` to pin routing, `maxRouteLength` (4 → 3 if still oversized). Wallets prepending compute-budget instructions (~60 bytes) at send time must check headroom themselves.

### 4.12 Hyperliquid Support
Chain ID `1337` (Hypercore); HyperEVM is separate (`chainId=999`, standard flow). Deposit params: `toChainId:1337`, `recipient`(Hyperliquid address). Withdrawal params: `protocolVersion:"v2"` (mandatory), `fromChainId:1337`. Currencies: Perps USDC = custom address `0x000...000`; Spot USDC = `0x6d1e7cde53ba9467b783cb7c530ce054`; HIP-3 DEX tokens = spot address + hex-encoded DEX name suffix. Withdrawal is a **two-signature flow**: (1) `authorize` step — EIP-712 `NonceMapping` message mapping a nonce to the request ID (override `domain.chainId` and `signatureChainId` to the user's active EVM chain — the field only affects signature validity, not fund routing); (2) `deposit` step — EIP-712 `HyperliquidTransaction:SendAsset` message using the **same nonce**, submitted to `https://api.hyperliquid.xyz/exchange` with `{signature:{r,s,v}, nonce, action}` (v must be a Number). Balances: Hyperliquid `info` API, `type:"clearinghouseState"`, read `withdrawable`.

### 4.13 Lighter Support
Chain ID `3586256`. `recipient`/`user` = **Lighter account index** (not wallet address) — resolve via `GET https://mainnet.zklighter.elliot.ai/api/v1/accountsByL1Address?l1_address=...`. Withdrawal quote returns a `transfer` action in `data.action`: `{type, toAccountIndex, assetIndex, fromRouteType, toRouteType, amount, usdcFee, memo(hex-encoded Relay requestId)}`. Requires a Lighter-scoped API key to submit signed txs (SDK packages/lazy-loads the signing binary). SDK: `@relayprotocol/relay-lighter-wallet-adapter` (+ `@relay-protocol/lighter-ts-sdk` for own bootstrap).

### 4.14 Migrating to Requests v3
Timeline: v2 deprecated **Jul 22 2026** (still works) → rate limit throttled progressively from **Sep 1 2026** → fully retired **Nov 24 2026**. In-band deprecation signals on every v2 response: `Deprecation`(RFC 8594), `Sunset`(RFC 7231), `Link` headers (all in `Access-Control-Expose-Headers`), plus a `deprecation{message,deprecatedAt,throttledFrom,sunsetAt,successor,migrationGuide}` object on 200s, and a route-specific 429 body with `successor`/`migrationGuide` (no `Retry-After`).
Key breaking changes: `x-api-key` now **required** for v3; `data.fees` **changes meaning** (v2: raw wei `{gas,fixed,price}`; v3: reused key now holds `{quoted,actual}` USD breakdown, was `expandedPriceImpact` in v2, with `relay`→`platform` rename); currencies unified to single objects; fee sponsorship consolidated under `data.feeSponsorship`; app fees consolidated to `data.appFees.{quoted,actual}`; `hash`→`txHash` on tx entries; new statuses `depositing`/`submitted` added, `delayed` removed; `failReason`/`refundFailReason` are `null` (not `"N/A"`) when absent; `sender` moves to root; currency/rate reads move to `data.route.{quoted,actual}`. Migration checklist: switch endpoint+auth, update fee reads, repoint currency/route reads, consolidate app fees/sponsorship, fix tx-hash/status/null handling, adopt the new `term`/`filters` querying surface (pagination unchanged, `limit` max 50).

### 4.15 Transaction Size Optimization — see §4.11 (Solana).

### 4.16 Troubleshooting
Failed fills: pull `failedTxHash`, `failedTxBlockNumber`, `failedCallData` from `GET /requests/v2?id=...` (or Ctrl+I on the transaction page in the Relay app) and simulate in Tenderly for the exact revert reason.

---

## 5. Resources

### 5.1 Supported Chains (mainnets, from `references__api__api_resources__supported-chains.md`)
69+ chains. Selected non-obvious chain IDs: Abstract 2741, Animechain 69000, ApeChain 33139, Avalanche 43114, B3 8333, Base 8453, Berachain 80094, **Bitcoin 8253038**, Blast 81457, BNB 56, BOB 60808, Boba 288, Celo 42220, Cronos 25, Doma 97477, Eclipse 9286185, Ethereal 5064014, Ethereum 1, Flow EVM 747, Gensyn 685689, Gnosis 100, Gunz 43419, HyperEVM 999, **Hyperliquid 1337**, Ink 57073, Katana 747474, **Lighter 3586256**, Linea 59144, Lisk 1135, Manta Pacific 169, Mantle 5000, MegaETH 4326, Metis 1088, Mode 34443, Monad 143, Morph 2818, Mythos 42018, Optimism 10, Plasma 9745, Plume 98866, Polygon 137, Robinhood Chain 4663, Ronin 2020, Scroll 534352, Shape 360, **Solana 792703809**, Somnia 5031, Soneium 1868, Sonic 146, Stable 988, Superseed 5330, Tempo 4217, **TON 224235520**, **Tron 728126428**, Unichain 130, World Chain 480, **XRP 537724**, Zircuit 48900, ZkSync Era 324, Zora 7777777. Testnets: Base Sepolia 84532, Sepolia 11155111. `tokenSupport` per chain is `All` or `Limited` (see §5.4 for how to check individual tokens). Adding a new chain: contact Relay (works for any EVM chain, OP-stack rollups, Arbitrum Orbit, etc.).

### 5.2 Solver Currencies & Swap Support (subset — see the full per-chain table in the crawl for all 60+ rows)
Format: Chain — Solver Currencies — Swaps Supported — Gas Top-Up Supported.
Ethereum: ETH, USDC, USDT, ANIME, WETH, SYND, USDe, PLUME, mUSD, DAI, APE, SIPHER, USDG, AUSD, PYUSD — swap✓ topup✓.
Base: ETH, USDC, USDT, cbBTC, WETH, SYND, SOL, DEGEN — ✓✓.
Arbitrum: ETH, USDC, USDT, WETH, ANIME, APE — ✓✓.
Solana: USDC, USDT, PENGU, CASH, PYUSD, USDG, SOL — swap✓, topup✗.
Bitcoin: BTC — swap N/A, topup✗.
Hyperliquid: USDC, USDe — swap✓, topup✗.
Lighter: ETH(Spot), USDC(Perp) — swap✓, topup✗.
(Full 60-row table is in `references__api__api_resources__supported-routes.md`.)
Route-check procedure: `GET /chains` → check `tokenSupport` (`All`→any Solver/DEX-liquid token supported; `Limited`→inspect `erc20Currencies[].supportsBridging` / `currency.supportsBridging`).

### 5.3 Contract Addresses
**Solver addresses**: Bitcoin `bc1qq2mvrp4g3ugd424dw4xv53rgsf8szkrv853jrc`; EVM `0xf70da97812cb96acdf810712aa562db8dfa3dbef`; SVM `F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe`; Tron `TYVWGh8XkmU49Hi9PkGAZXiiJPB3J5zJZy`.

**Contract versions** (by EVM fork — London/Cancun/Zero-ZkEVM address variants differ):
| Contract | London | Cancun | Zero-ZkEVM |
|---|---|---|---|
| v2 Router | 0x113a327221d2c4660684449bfc39bc14ad1aaf38 | 0xf5042e6ffac5a625d4e7848e0b01373d8eb9e222 | 0x8fdceeda2951a9747feaf25311435448bce47b2a |
| v2 ApprovalProxy | 0xcd740b0e005cb8647f9baf4febedc8753ceef861 | 0xbbbfd134e9b44bfb5123898ba36b01de7ab93d98 | 0xaec31c3780521c34ca59dc2eb5fb9ee2e285cebe |
| v2.1 Router | 0xb758f3bfa7b9d39ef5457d7c7ffb3702f2ad3982 | 0x3ec130b627944cad9b2750300ecb0a695da522b6 | 0xb758f3bfa7b9d39ef5457d7c7ffb3702f2ad3982 |
| v2.1 ApprovalProxy | 0x953c95146eb8ce763f35caf2f1d46ddf6a33bea2 | 0x58cc3e0aa6cd7bf795832a225179ec2d848ce3e7 | 0x953c95146eb8ce763f35caf2f1d46ddf6a33bea2 |
| v3 Router | 0x9ef6d3c2f60d7b9008d74cab1fc0f899c957c819 | 0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f | 0xe16870b028704e38dbc254a84d3f72c8ba345ca9 |
| v3 ApprovalProxy | 0x8754bc615047de01228a7527b712806a71a8dc9a | 0xccc88a9d1b4ed6b0eaba998850414b24f1c315be | 0xf6e54bbf91e564fcf0df3ed9f2dd82913e9232c3 |

**Per-chain mainnet deployments** (RelayReceiver / ERC20Router / ApprovalProxy — v3 addresses used by most chains, `0xb92fe...` / `0xccc88...`, since they're on Cancun; a handful of older/EVM-quirky chains use the v2.1 addresses `0x9ef6d3c2...` / `0x8754bc61...`, namely Cronos, Linea, Mantle, Metis; Bitcoin/Eclipse/Hyperliquid/Lighter/Solana/TON/Tron have no EVM contracts, `N/A`). Full 60-row table is in `references__api__api_resources__contract-addresses.md`; notable entries: Ethereum RelayReceiver `0xa5f565650890fba1824ee0f21ebbbf660a179934`, Base same, Arbitrum same, Polygon same, Optimism same (this receiver address is shared across most standard EVM chains); Abstract/ApeChain/Katana etc. use `0xa06e1351e2fd2d45b5d35633ca7ecf328684a109`; several newer chains use `0x7f4babd2c7d35221e72ab67ea72cba99573a0089` or `0xac4615ffec9dbf5efe28db0f98f0011e6df0dabd`.
**Testnet**: Base Sepolia RelayReceiver `0x4cec3461dd63f22554b7fa2abba5bbfe9e86ddfd`, ERC20Router `0xf5042e6ffac5a625d4e7848e0b01373d8eb9e222`, ApprovalProxy `0xbbbfd134e9b44bfb5123898ba36b01de7ab93d98`; Sepolia RelayReceiver same, ERC20Router `0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab`, ApprovalProxy `0x77a917df7a084b7b3e43517ae28373c2a5492625`.

### 5.4 `GET /chains` — full response schema
```json
{
  "chains": [{
    "id": 123, "name": "...", "displayName": "...", "httpRpcUrl": "...", "wsRpcUrl": "...",
    "explorerUrl": "...", "explorerName": "...", "explorerPaths": {"transaction":"...","address":"...","token":"..."},
    "depositEnabled": true, "tokenSupport": "All", "disabled": true, "partialDisableLimit": 123,
    "blockProductionLagging": true,
    "currency": {"id":"...","symbol":"...","name":"...","address":"...","decimals":123,"supportsBridging":true},
    "withdrawalFee": 123, "depositFee": 123, "surgeEnabled": true,
    "featuredTokens": [{"id":"...","symbol":"...","name":"...","address":"...","decimals":123,"supportsBridging":true,"metadata":{"logoURI":"..."}}],
    "erc20Currencies": [{"id":"...","symbol":"...","name":"...","address":"...","decimals":123,"supportsBridging":true,"supportsPermit":true,"withdrawalFee":123,"depositFee":123,"surgeEnabled":true}],
    "solverCurrencies": [{"id":"...","symbol":"...","name":"...","address":"...","decimals":123}],
    "iconUrl": "...", "logoUrl": "...", "brandColor": "...",
    "contracts": {"multicall3":"...","multicaller":"...","onlyOwnerMulticaller":"...","relayReceiver":"...","erc20Router":"...","approvalProxy":"...","v3":{"erc20Router":"...","approvalProxy":"..."}},
    "vmType": "bvm|evm|svm|tvm|tonvm|hypevm|lvm|xrpvm|hederavm",
    "explorerQueryParams": {}, "baseChainId": 123, "statusMessage": "...",
    "solverAddresses": ["..."], "tags": ["..."],
    "protocol": {"v2": {"chainId": "...", "depository": "...", "depositoryVault": "..."}}
  }]
}
```
`disabled` flags an incident-driven chain outage; `blockProductionLagging` flags degraded block production (surface to users in real time).

### 5.5 App-Fee/Withdrawal-related contract reference
Relay Depository canonical address is per-chain, exposed as `chain.protocol.v2.depository` in `/chains` — **always resolve from `/chains`, never trust `protocol.v2.depository` echoed back in a quote** for validation purposes (see §3.8).

---

## Notes on scope / what's UNVERIFIED
- The `/authorize` endpoint is referenced (rate limits doc) but has **no standalone reference page** in the crawl — only its bucket/limits and its use inside the Hyperliquid `authorize` step are documented. `UNVERIFIED`: full request/response schema for `/authorize` as a general-purpose endpoint.
- `references__api__advanced.md`, `core.md`, `overview.md`, `utilities.md` are all the **same landing/index page content** (confirmed by identical byte content) — not four distinct references; they're link hubs into the endpoints above.
- The `get-quote.md` (v1) and `get-quote-v2.md` pages are near-byte-identical in schema; v1 is explicitly marked **Deprecated**, v2 is current — only presentational "Learn more" links differ.
- Two `execution-errors`-style enums exist (standalone Execution-Errors doc vs. the `/intents/status/v3` + `/requests/v3` query-param enum) and are not 100% identical (`DEPOSIT_ADDRESS_MISMATCH`, `MANUAL_REFUND_REQUIRED` appear only in the endpoint enums) — flagged above, treat the endpoint enum as the wire-format source of truth.

---
