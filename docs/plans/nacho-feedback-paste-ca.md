# Plan: Nacho feedback — CA paste bug + speed/pools/chain-detect/bridge UX

Source: user DM (2026-08-28). Screenshot: user pasted `0xd698419f135e...4ba3`
into the bot and got *"Sorry, I couldn't understand that — try /s ..."* instead
of a token card. Feedback, in priority order: (1) txn speed, (2) paste CA →
insta-load all pools, (3) show which chain the token is on, (4) built-in
bridge, (5) later: limit orders + copy trading.

## Root cause of the screenshot bug (P0)

Paste-to-trade **already exists** (`bot/handlers/paste_trade.py:281`
`on_freeform_text` → `_render_token_card`), but with `NL_TRADING_ENABLED=true`
the NL handler `handle_nl_text` (`bot/handlers/nl_trade.py:294`) intercepts
free text first. A bare 0x address passes `_looks_like_trade_text`
(`nl_trade.py:265`), reaches the LLM intent parse, produces an incomplete
intent, and hits `FALLBACK_MESSAGE` at `nl_trade.py:375`/`:394` — it **never
falls through** to the paste-to-trade card. Secondary path: pasting a CA while
the `/s` ConversationHandler is mid-state (chain selector open, as in the
screenshot) is also unhandled.

## Phase 1 — P0 bug fix (bot-dev, small)

1. In `handle_nl_text`, before `_looks_like_trade_text`: run
   `detect_address_chain()` (`bot/utils/validators.py:131`) on the first token
   (and the embedded-address scan reused from `paste_trade.py:304-316`); on a
   hit, delegate to `on_freeform_text` and return. No LLM call for a pasted CA.
2. In the `/s` conversation's chain-selection state, add a text handler that
   detects a pasted address, ends/short-circuits the conversation, and renders
   the token card.
3. Regression tests: bare CA, CA in forwarded text, CA mid-`/s`-conversation,
   with NL flag on AND off.

## Phase 2 — Chain detection + insta-load pools on paste

Today `get_token_info` (`paste_trade.py:95-150`) probes 7 EVM chains
**sequentially** via Alchemy metadata — slow, misses chains, and returns no
pool data.

1. Add a `dexscreener` (or GeckoTerminal) client in `bot/services/`: one
   `GET /latest/dex/tokens/{address}` call returns **every chain the token
   trades on, all pools, liquidity, price, volume** — solves "which chain" and
   "insta-load pools" in a single round-trip.
2. Race it against the existing Alchemy probe with `asyncio.gather` (parallel,
   not sequential); first useful answer wins, others cancel.
3. Token card upgrades: chain badge, top pools (DEX, liquidity, price), and if
   the token lives on multiple chains, a chain-picker row.
4. Cache token-info results (short TTL) alongside the existing quote/price
   caches in `swap_engine.py`.

## Phase 3 — Txn speed (perceived + real)

1. Instrument: log per-stage latency (paste→card, quote, sign, broadcast,
   confirm) so we optimize with data, not vibes.
2. Pre-warm: on card render, background-fetch a default-size quote so the
   first Buy tap is instant (quote cache `swap_engine.py:34` already exists).
3. Immediate UX ack: "⚡ Fetching…" placeholder edited in place, never a
   silent gap.
4. Review sequential provider loops for `asyncio.gather` racing.

## Phase 4 — Surface the bridge (already built)

Socket (`bot/services/socket_api.py`), Li.Fi (`lifi_api.py`), and the bridge
registry (`bot/services/bridge/registry.py`) already exist. Gap is UX:
`build_buy_keyboard(..., allow_cross_chain=info["chain"] == "robinhood")`
(`paste_trade.py:277`) only offers cross-chain buys on one chain. Enable
cross-chain buy from the token card on **all** supported chains, labeled
"🌉 Buy from another chain". MONEY-PATH → `money-path-reviewer` before merge.

## Phase 5 — Limit orders + copy trading (verify & expose)

Both exist: `bot/handlers/limit_orders.py` + `bot/services/orders.py`
(PRO-gated: LO/DCA/trailing) and `bot/services/copy_service.py` + models.
Audit wiring (dead-button check via `scout`), confirm copy-trade *execution*
actually fires (scout flagged it as possibly track-only), then add entry
points on the token card and reply to Nacho with what's already live.

## Sequencing & routing

| Phase | Agent | Size |
|-------|-------|------|
| 1 | bot-dev | S — ship first, this is the visible bug |
| 2 | bot-dev | M |
| 3 | bot-dev + swap-debug | M |
| 4 | bot-dev → money-path-reviewer | M |
| 5 | scout audit → bot-dev | S–M |

Each phase: black-format, parse-check, `pytest tests/`, `/ship`, then live
verify by pasting the actual CA from the screenshot into the prod bot
(standing rule 2: no "live" claim without a real end-to-end test).
