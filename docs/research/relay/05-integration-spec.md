# Relay integration spec (build with it)

Goal: add Relay as a cross-chain provider in the Python swap engine so the bot can race Relay against Across, Li.Fi, Socket, and the rest, and collect an app fee on every Relay fill. This is a **MONEY-PATH** change (swap execution). Reviewed by `money-path-reviewer` before merge.

## Facts from the live API (see 04-live-api-probe.md)

- Base URL `https://api.relay.link`. `/quote` is deprecated, use `POST /quote/v2`. Same response shape plus `feeSponsorship`.
- No API key required. `x-api-key` header raises rate limits. **Do not send `referrer` without a key** (401 `UNAUTHORIZED_QUOTE`). `appFees` works without a key.
- Request: `user, originChainId, destinationChainId, originCurrency, destinationCurrency, amount (string, smallest units), tradeType: "EXACT_INPUT", recipient, slippageTolerance (bps string, optional), appFees: [{recipient, fee: "<bps>"}]`.
- Response: `requestId`, `steps[]` (each `{id: "approve"|"deposit"|"swap"|"send"|"authorize", kind: "transaction"|"signature", items[{status, data{from,to,data,value,chainId,gas,maxFeePerGas,maxPriorityFeePerGas}, check{endpoint,method}}]}`), `fees{gas, relayer, relayerGas, relayerService, app, subsidized}` each with `amount, amountFormatted, amountUsd, currency{symbol,decimals,chainId}`, `details{currencyIn, currencyOut{amount, amountFormatted, amountUsd, minimumAmount}, timeEstimate (seconds), totalImpact{usd,percent}, rate, slippageTolerance}`.
- Status: `GET /intents/status?requestId=0x…` → `{status: "unknown"|"pending"|"success"|"failure"|"refund", txHashes?, inTxHashes?, destinationChainId?}` (treat anything else as pending).
- Chains: `GET /chains` → `{chains:[{id, name, vmType, depositEnabled, disabled, currency{address,decimals}}]}`. 61 chains today incl. Solana (792703809), Bitcoin (8253038), TON (224235520), Tron (728126428), HyperLiquid (1337).
- Native token address on EVM: `0x0000000000000000000000000000000000000000`. Solana native: `11111111111111111111111111111111`.
- Native-in flows are one `deposit` tx with `value`; ERC-20 flows are `approve` then `deposit`. Execute steps **in order**, and poll `items[].check.endpoint` after the deposit.

## Files

1. `bot/services/relay_api.py` (new). Mirror `bot/services/across_api.py` style: module docstring, dataclasses, `RelayError`, `RelayAPI` class, module-level `relay_api = RelayAPI()`.
   - `RELAY_API_URL = "https://api.relay.link"`.
   - Chain name → Relay chain id map for the chains we already have in `bot/config/chains.py` (use `get_chain_by_name(...).chain_id` for EVM; add explicit ids for solana `792703809`). Keep a static `RELAY_CHAIN_IDS` fallback dict for the 7+ chains we support, and a `refresh_chains()` that pulls `/chains` and caches for 1 hour (never blocks a quote if it fails).
   - `is_supported_route(from_chain, to_chain)`: both chains known and deposit-enabled; **same-chain allowed** (Relay does same-chain swaps too) but only route cross-chain from the engine for now.
   - `get_quote(from_chain, to_chain, from_token_address, to_token_address, amount_raw, from_address, to_address=None, slippage_bps=None) -> RelayQuote` calling `POST /quote/v2`. Attach `appFees` when `settings.relay_app_fee_recipient` and `settings.relay_app_fee_bps > 0`. Add `x-api-key` header when `settings.relay_api_key` is set, and only then also send `referrer: "suwappu"`. Use `api_limiter.wait_and_acquire("relay")` and `get_session()` like Across.
   - `RelayQuote` fields: request_id, from_chain, to_chain, from_token, to_token, from_amount, to_amount, to_amount_min (`details.currencyOut.minimumAmount`), from_amount_human, to_amount_human, gas_cost_usd (`fees.gas.amountUsd`), relayer_fee_usd (`fees.relayer.amountUsd`), app_fee_usd, total_cost_usd, price_impact_pct (`details.totalImpact.percent` as float), estimated_fill_time (`details.timeEstimate`), steps (list of normalized txs `{step_id, to, data, value:int, chainId:int, gas:int|None, maxFeePerGas, maxPriorityFeePerGas}`), raw_quote.
   - `get_status(request_id) -> RelayStatus(request_id, status, tx_hashes, raw)`; map `success`→`FILLED`, `failure`→`FAILED`, `refund`→`REFUNDED`, else `PENDING`.
   - Fail loudly on malformed steps (no `to`/`data`) like `AcrossAPI._normalize_tx`. Reject `kind == "signature"` steps with `RelayError("signature steps not supported")` rather than silently skipping.
2. `bot/config/settings.py`: add next to `across_api_key`:
   - `relay_api_key: Optional[str]` (default None)
   - `relay_app_fee_recipient: Optional[str]` (default None; EVM address that accrues app fees, claimable via Relay's claim-app-fees endpoint)
   - `relay_app_fee_bps: int = 0` (0 = no app fee)
   - `relay_enabled: bool = True`
3. `bot/services/swap_engine.py`: add provider `"relay"`.
   - Instantiate `self.relay = RelayAPI()` next to `self.across`.
   - `_is_relay_route(from_chain, to_chain, from_token, to_token)`: `settings.relay_enabled` and `self.relay.is_supported_route` and cross-chain only.
   - `_get_relay_quote(...)` → `SwapQuote(provider="relay", ..., to_amount_min=quote.to_amount_min, gas_cost_usd=quote.gas_cost_usd, gas_cost_trusted=True, fee_cost_usd=quote.relayer_fee_usd + quote.app_fee_usd, estimated_time=quote.estimated_fill_time, time_trusted=True, price_impact=quote.price_impact_pct, raw_quote={..., "request_id", "steps", "recipient"})`. Resolve token addresses the same way the Across/Li.Fi paths do (look at how `_get_across_quote` / `_get_lifi_quote` get addresses; use the existing token-config helpers).
   - Race it wherever `_get_across_quote` is raced (both places: the cross-chain race near line ~1855 and the aggregated race near ~3936). Keep the same timeout wrappers used for Across.
   - `_execute_relay_swap(quote, wallet_data) -> str`: re-quote fresh for the same recipient (quotes expire), then send each EVM step in order via the existing sign/send path used by `_execute_across_swap` (reuse its nonce/gas handling; honor `gas` from the step when present, else estimate). Return the **deposit** tx hash. Only EVM origin chains; raise `SwapError` for non-EVM origins for now.
   - Register in the execute dispatch (`elif quote.provider == "relay": tx_hash = await self._execute_relay_swap(quote, wallet)`), and in any provider reliability/security maps that list `"across"` (router.py `~1027`, `~1041`) with similar scores (0.95 / 0.7).
   - After the deposit tx confirms, record `request_id` in `raw_quote` so the tx poller can later call `relay.get_status`. If there is an existing generic bridge-status hook the Across path uses, wire the Relay status into it the same way; otherwise leave a clearly named TODO with the endpoint.
4. `bot/services/router.py`: add `"relay"` to the provider comment/enum and reliability maps; add `self.relay` + a `_get_relay_route` mirroring `_get_across_route` if the router races bridges there.
5. Tests: `tests/test_relay_api.py` with mocked `get_session` responses using the real JSON in `docs/research/relay/probe/quote-v2-base-usdc-to-arb-usdc-appfee.json`: quote parsing (fees, min out, steps order approve→deposit), app-fee attachment logic, 401 handling, status mapping, malformed step rejection, signature-step rejection. Extend `tests/test_swap_routing.py` only if it has a provider-list assertion that must include relay.
6. `black --line-length=100` on every touched file; `python3 -c "import ast; ast.parse(...)"` on each; `python3 -c "import bot.services.relay_api, bot.services.swap_engine"` boot gate.

## Non-goals (this pass)
- Solana/Bitcoin/TON origin execution (quote only).
- `txs` / calling, gasless, fee sponsorship, deposit addresses.
- RelayKit UI in the webapp.
