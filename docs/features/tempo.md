# Tempo: gasless swaps & machine payments

Tempo is a stablecoin-native chain where gas is paid in TIP-20 stablecoins
rather than a volatile native token. Suwappu uses that to make onboarding feel
gasless, and to support machine-to-machine micropayments.

## Gasless (fee-payer) swaps

On Tempo, Suwappu can **sponsor the gas** for a new user's first swaps. Under
the hood these are Tempo **type-0x76 fee-payer** transactions: the swap is
built and counter-signed by Suwappu's sponsor wallet (via the official
`pytempo` SDK), so the fee is paid by the bot, not by you.

For you, that means **effectively gasless onboarding** — your first swaps on
Tempo cost you nothing in gas. Because Tempo settles fees in TIP-20
stablecoins, the underlying cost is tiny (sub-`$0.001` per swap).

### How it works and what to expect

- **Per-user lifetime cap:** sponsorship covers your **first 3 swaps**
  (`MAX_SPONSORED_TXS_PER_USER = 3`). After that, swaps execute as normal,
  user-paid.
- **Daily budget:** there's a shared daily sponsorship budget (default
  `$100/day`, `DAILY_SPONSOR_BUDGET_USD`). If the day's budget is exhausted,
  sponsorship pauses until the next day.
- **Graceful fallback:** if sponsorship isn't available — cap reached, budget
  spent, or the feature is turned off — the swap **still executes**, just
  user-paid. You're never blocked from swapping.
- **Best-effort, not a guarantee:** sponsorship accounting is tracked
  in-memory and resets if the bot process restarts. It's an onboarding perk,
  not a hard financial guarantee.

> Gasless swaps are gated by config (`tempo_fee_sponsor_enabled`, off by
> default) and require a funded sponsor wallet. When it's off, Tempo swaps are
> simply user-paid — which on Tempo is still only fractions of a cent.

## Machine Payments Protocol (MPP)

MPP lets you pay services and agents on Tempo with one-time micropayments or
streaming payment **sessions** — handy for paying per-call for AI, data,
compute, or API services.

| Command | What it does |
|---|---|
| `/mpp list [category]` | Browse the MPP service directory. Categories: `ai`, `data`, `compute`, `api`. |
| `/mpp pay <url> <amount>` | Make a one-time micropayment to a service. |
| `/mpp session <url>` | Open a streaming payment session (a small deposit funds usage). |
| `/mpp status` | View your active streaming sessions and spend. |

Examples:

```
/mpp list ai
/mpp pay https://service.example/api 0.05
/mpp session https://service.example/stream
/mpp status
```

> **Early-stage:** MPP is new and the service directory is still being
> populated as Tempo mainnet ramps up. Expect a short list of services for now.
