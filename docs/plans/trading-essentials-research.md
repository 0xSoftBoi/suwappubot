# Trading Essentials — Research Notes (ticket input)

Companion to `trading-product-essentials.md`. This file holds the deeper
implementation detail needed to write tickets. Verified 2026-08-12.

---

## A. The bot already solved the action problem. The webapp reinvented it badly.

This is the most important finding of the research pass, and it changes several
tickets from "design a system" to "reuse the one we have".

`bot/handlers/paste_trade.py` implements the canonical Telegram trading UX
end-to-end, and it is **registered and live** (`bot/main.py:61,552,561,801`):

> paste a contract address with no command → token card + safety check → Buy buttons

Its own module docstring names this "the single most-expected interaction in
this category". Key pieces:

### `PRESET_AMOUNTS` — per-chain, native-denominated (paste_trade.py:49)

```python
PRESET_AMOUNTS = {
    "SOL":   [0.1, 0.5, 1.0, 5.0],
    "ETH":   [0.01, 0.05, 0.1, 0.5],
    "BNB":   [0.05, 0.1, 0.5, 1.0],
    "POL":   [10, 50, 100, 500],
    "MATIC": [10, 50, 100, 500],
    "TRX":   [100, 500, 1000, 5000],
}
DEFAULT_PRESETS = [0.01, 0.05, 0.1, 0.5]
```

### `build_buy_keyboard()` (paste_trade.py:64) — explicitly built for reuse

Already shared between the paste-to-trade card **and** the `/trending` token
view "so the Buy experience is identical everywhere". Buttons carry only
`pbuy_<amount>`; execution funnels through `swap.paste_buy_entry`, which runs
the existing quote → confirm → 2FA → spending-limit path. Comment is explicit:
*"no surface executes a swap directly."*

**Contrast with the Mini App** (`webapp/src/pages/TokenDetail.tsx:54`):

```ts
const BUY_PRESETS = ['0.01', '0.05', '0.1', '0.5']  // ETH values, all 46 chains
<p>Buy with ETH</p>                                  // line 121
```

**Ticket implication:** the webapp preset ticket is *not* "design presets". It is
"lift `PRESET_AMOUNTS` into `packages/shared` and consume it in both stacks."
The security model (`paste_buy_entry` as the single execution funnel) is also
the pattern the webapp's one-click ticket must follow — do **not** let the Mini
App execute swaps directly.

### Still genuinely missing in BOTH surfaces
Presets are **not user-editable** anywhere. That is the actual Axiom gap, and it
is a real ticket in its own right (settings UI + persistence + both stacks).

---

## A2. Reference spec — the paste→buy funnel, read end-to-end

This is the pattern every other Buy surface should copy. Read
`paste_trade.py:155-278` (card) then `swap.py:2003-2100` (`paste_buy_entry`).

### The chain of custody

```
paste address
  → _render_token_card()          gates, then stash paste_token
  → build_buy_keyboard(native)    buttons carry only "pbuy_<amount>"
  → paste_buy_entry()             RE-gates, seeds swap context
  → show_wallet_selection → quote → CONFIRM_SWAP → 2FA → spending limits
  → execute
```

`paste_buy_entry` is rate-limited at entry (`swap.py:2017`) and its docstring is
categorical: *"It NEVER calls execute_swap directly — the guardrail."*

### Five properties worth copying verbatim

1. **Fail-closed gates run BEFORE the CTA renders.** xStocks region
   (`paste_trade.py:169`), Robinhood equity (`:199`), honeypot hard-block
   (`:235`), blacklist/sanctions `check_address_gate` (`:248`).
2. **Blocked ⇒ `paste_token` is never stashed.** The comment at `:232` is the
   point: *"no Buy button, and we do NOT stash the token so the pbuy_ path can't
   be used for it."* The button cannot be replayed, because the state it needs
   was never written.
3. **Every gate is enforced twice.** `paste_buy_entry` re-checks xStocks
   (`swap.py:2053`) and Robinhood (`:2036`) — explicitly because *"a stale or
   forged pbuy callback must never turn a canonical Robinhood Stock Token into a
   quote."* `paste_trade.py:166` states the rule: *"both layers must agree."*
   The execution-layer gate is placed *after* the address is known but *before*
   any quote or wallet work, so it also covers users who bypass the card.
4. **Honest degradation.** The safety check is Solana-only, and the card says so
   — *"degrade honestly elsewhere rather than imply a check we didn't run"*
   (`:214`). It never fakes a green check.
5. **Native symbol comes from chain config**, not a literal:
   `chain_config.native_token` (`:210`), rendered as `Buy with {native}` (`:271`).
   This is precisely the line the Mini App hardcoded to "ETH".

### Where even the best implementation falls short

Ticket these against the framework rather than assuming the bot path is done:

- **The card is info-thin.** It shows identity + safety + Buy. **No price, no
  market cap, no liquidity, no volume, no chart.** Against *"reduce text,
  increase numbers/charts"* the highest-conviction moment in the product shows
  almost no numbers — while `terminal.py` already computes all of them.
- **EVM chain resolution is serial and narrow.** `EVM_PROBE_CHAINS`
  (`paste_trade.py:46`) probes 7 chains one at a time via Alchemy
  (`:121-134`) — a latency cost on the `<5s` path, across 7 of 46 chains.
  Parallelising these probes is a cheap, isolated win.
- **The EVM fallback can render a Buy button on the wrong chain.** If Alchemy is
  unconfigured or the token isn't on those 7 chains, `get_token_info` returns
  `chain: "ethereum", symbol: "Token", decimals: 18` (`:136-142`) — and the card
  still renders Buy buttons. Worth a ticket: fail visible rather than guess.
- **Honeypot checking is Solana-only** (`:217`), but EVM tokens still get Buy
  buttons. `check_address_gate` covers blacklist/sanctions on all chains; it does
  not cover honeypots.
- **tron/starknet are identity-only** (`:144-152`) — no metadata provider, guessed
  decimals.

---

## B. Correction: there is no true one-tap buy in the bot

An earlier audit pass reported `/s` (`bot/handlers/quickswap.py:29`) as "1 tap".
That is wrong and would have produced a bad ticket. `/s` is a **typed command**
requiring `/s <amount> <from_token> [chain] <to_token> [chain]`. It is fast for
power users who type, but it is not a button.

Worse, `quickswap.py` resolves tokens via `get_token_by_symbol`
(`bot/config/tokens.py`, the static 151-token list). **You cannot `/s` an
arbitrary contract address.** So the discovery→action path breaks precisely for
the long-tail tokens discovery is supposed to surface. `paste_trade.py` is the
handler that covers arbitrary addresses; `/s` does not.

---

## C. Alerts stop one step short — and it's a structural change, not a label

`bot/services/alerts.py:285`:

```python
deep_link = build_alert_deep_link(alert)
reply_markup = InlineKeyboardMarkup(
    [[InlineKeyboardButton("💱 Review & Sign", url=deep_link)]]
)
```

This is a **`url=` deep-link button**, not `callback_data`. Converting it to an
inline buy/sell CTA is therefore not a copy change — it needs callback buttons
plus a handler, and the natural move is to reuse `build_buy_keyboard()` from
paste_trade so the alert CTA matches every other Buy surface.

Note the alert also mirrors to WhatsApp via `template_service.send_price_alert`
(`alerts.py:~305`) — any CTA change needs a WhatsApp-side decision too.

---

## C2. The bot's flagship discovery surface is structurally capped

`bot/handlers/trending.py` is well-built — it correctly reuses
`build_buy_keyboard` so Buy is identical everywhere, and it caches the list in
`user_data` to stay under Telegram's 64-byte `callback_data` limit. But against
*"design for infinite discovery"* it is the opposite on three axes, and all
three are deliberate, documented choices in the module docstring:

1. **Pull-only.** "THIS IS PULL-ONLY … there is NO background push, no
   unsolicited message." No re-engagement loop exists at all.
2. **Solana-only.** The sole feed is `launch_detector.get_recent_launches()`
   (`bot/services/sniping/`) — Solana launches. On a product spanning 46 chains,
   discovery covers one.
3. **Capped at 8.** `MAX_TRENDING = 8` (trending.py:38). There is no paging, no
   "load more", no scroll. Discovery terminates after 8 rows.

Prediction markets are surfaced as a **single deep-link** into the `/predict`
conversation rather than enumerated markets (documented as a v1 shortcut,
because `pred_trending` is conversation-internal state, not a top-level handler).

**Ticket implication:** "more surface area for discovery = more time spent = more
trades" has no room to operate here. Paging + multi-chain feeds + a push path
are three separable tickets.

### The push loop exists — it just carries the wrong payload

`bot/services/digest_service.py` is a **running background service**, started at
`api/main.py:405` and stopped at `:497`. It already has everything a discovery
push needs: opt-in gating, a `last_digest_at` cadence check, an hourly tick
(`CHECK_INTERVAL_SECONDS = 3600`), and a Telegram send path.

But it sends a **weekly portfolio summary** (`DIGEST_INTERVAL_DAYS = 7`). For a
trading product, a 7-day cadence is not a re-engagement loop — it is a
newsletter. The scheduler, opt-in model, and delivery path are all reusable;
only the payload and cadence need to change.

So "add discovery push" is **not** greenfield. Ticket it as: reuse
`digest_service`'s opt-in + scheduler pattern for a fast-cadence discovery/alpha
push, rather than building a second scheduler.

---

## D. Ticket system

- Linear team: **Suwappu** (single team in workspace).
- Statuses: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`,
  `Duplicate`.
- Existing repo backlog uses `SUW-###` IDs and is tracked in
  `.claude/skills/goal/SKILL.md`. Overlapping open items already filed:
  - `SUW-194` — `/webapp/snipe` POST has no backend (webapp snipe is dead)
  - `SUW-197` — terminal perps TP/SL needs backend order-type support
  - `SUW-195` — tweet feed provider decision
- **New tickets should cross-reference these rather than duplicate them.**

---

## E. RESOLVED: the Mini App can reach the terminal API today. No auth work.

This was the main open question for ticket sizing. **Answer: Phase 0 is a URL
change, not an auth project.**

- Router: `APIRouter(prefix="/terminal", tags=["terminal"])` (`terminal.py:21`),
  mounted at `api/main.py:764` via `app.include_router(terminal_router)` —
  **no `dependencies=[...]`**, so there is no router-wide auth.
- The five data routes take **only `Query(...)` params, no `Depends()`**:

  | Route | Signature | Auth |
  |---|---|---|
  | `GET /terminal/chart/ohlcv` (`:172`) | `pair, chain=ethereum, interval=1h, limit≤500` | none |
  | `GET /terminal/perps/candles` (`:227`) | `coin, interval=1h, limit≤500` | none |
  | `GET /terminal/perps/whales` (`:386`) | `coin, sample=60` | none |
  | `GET /terminal/token/safety` (`:1020`) | `chain, address` | none |
  | `GET /terminal/discovery/final-stretch` (`:1106`) | `limit≤100` | none |

- The one auth helper in the file, `_terminal_user` (`:1227`), reads a Bearer
  header or `suwappu_auth` cookie and raises 401 "Sign in to trade". It is used
  by **user-scoped trading routes only** (perps/predictions, keyed on
  `users.id`) — not by any of the read-only data routes above.
- CORS already allows the Mini App origin: `app.suwappu.bot` is in the allowed
  list at `api/main.py:655`.
- These routes are documented as degrading to empty payloads rather than 5xx
  ("never 5xx … matching the other public discovery endpoints"), so wiring them
  cannot take the Mini App down when an upstream is flaky.

**Ticket implication:** the dead-chart fix (`useChart.ts:88`) is a one-hook
change pointing at `/terminal/chart/ohlcv`. No new endpoint, no auth path, no
backend work. Same for whales, safety, and final-stretch.

## E2. EVM honeypot detection already exists — it just isn't on the buy path

Correcting the gap noted in A2: honeypot checking is Solana-only **in
`paste_trade.py`**, but the capability exists in the repo.
`GET /terminal/token/safety` (`:1020`) aggregates **free** providers:

- **EVM** — GoPlus `token_security` + **Honeypot.is sell-simulation**
  (`terminal.py:878-931`), with a Suwappu-chain → GoPlus-chain-id map at `:825`
- **Solana** — RugCheck report summary (`:948`)

Returns honeypot/can-sell, buy/sell tax, mint & freeze authority, LP-locked,
top-holder concentration, risk flags, and a 0–100 trust score; degrades to
`riskLevel: unknown` rather than failing.

So "add EVM honeypot protection to the buy path" is **not** a build — it is
wiring `paste_trade.py`'s gate to an endpoint that already exists. Given
`_render_token_card` currently shows Buy buttons on EVM with no honeypot check
(A2), this is the highest-value security ticket in the set, and it is cheap.

It also solves the info-thin card problem: this one endpoint supplies most of
the missing "fill the grid" fields.

## E4. Chart coverage is 8 of 46 chains — and the route has no cache

Two findings that together change the dead-chart ticket from "trivial" to
"small, but must ship with caching."

### Coverage: 8 networks, not 46

`GECKO_NETWORK` (`terminal.py:63`) maps Suwappu chain names to GeckoTerminal
networks. Deduplicating the aliases, it covers **8 distinct networks**:

`eth`, `base`, `arbitrum`, `optimism`, `polygon_pos`, `bsc`, `avax`, `solana`

`bot/config/chains.py` defines **46 chains**. So wiring the chart gives real
candles on 8 of them and nothing on the other 38 — including Blast, Ink and
Aurora (added recently in #822/#4e64701), plus Tron, Starknet and Hyperliquid.

The UI must therefore distinguish *"no chart on this chain"* from *"chart failed
to load"*. Today `TokenChart.tsx:86` renders one undifferentiated "No chart data
available" for both, which is exactly the honest-degradation failure the bot
path avoids (A2, property 4).

Timeframes do line up: `GECKO_TIMEFRAME` (`:89`) supports 1m/5m/15m/1h/4h/1D,
and the webapp's `TIMEFRAMES = ['5m','15m','1h','4h','1d']` are all mapped.

### No caching on the chart route

`grep` for cache in `terminal.py` returns only `_leaderboard_cache` (`:347`, ~10
min, for HL leaderboard). **`/chart/ohlcv` is uncached.** Every chart load fans
out *two* sequential, unkeyed, public third-party calls:

1. `_resolve_pool` → DexScreener `/latest/dex/tokens/{address}` (`:102`), picking
   the highest-liquidity pair
2. `_gecko_ohlcv` → GeckoTerminal `/networks/{n}/pools/{pool}/ohlcv/{tf}` (`:123`)

GeckoTerminal's free tier is roughly 30 calls/min. Pointing the Mini App at this
route without a cache would rate-limit at trivial traffic — and because the
route degrades to empty rather than 5xx, it would fail **silently**, putting us
right back at "No chart data available" with no signal.

There is already a caching precedent in this file: the comment at `:2432` notes
another unauthenticated route where "each cache miss fans out to Blockscout".

**Ticket implication:** "wire the chart" and "cache the chart route" are one
ticket, not two. Pool resolution is highly cacheable (a token's best pool rarely
changes); candles need a short TTL keyed on interval.

## E5. Still open

1. Which market-data provider should back candles/trending on the other 38
   chains, and at what cost? — *agent did not report; needs a redo*
2. `/discovery/final-stretch` is explicitly scoped to "the canonical memecoin
   chain" (Solana) — so it does **not** solve multi-chain discovery. A
   multi-chain feed is still a real ticket.
