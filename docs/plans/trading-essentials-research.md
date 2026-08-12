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

## E. Open questions blocking precise estimates

1. Can the Mini App reach `api/routes/terminal.py` (mounting + auth)? Determines
   whether Phase 0 is a URL change or a new auth path. — *research in flight*
2. Which market-data provider backs candles/trending across 46 chains, and at
   what cost? — *research in flight*
3. Does `_resolve_pool` (`terminal.py:102`) cover all 46 chains or a subset?
   Chart coverage depends on GeckoTerminal network mapping.
