# W1.4 / W2.1 — Money precision + atomic state audit

Scanner: `scripts/audit/money_precision_scan.py` · Full findings: `.audit/money-precision.json`
Roots scanned: `bot/`, `api/`, `database/`, `scripts/`

## Results

| Class | Count | Meaning |
|---|---:|---|
| `float-money-column` | 48 | A money-named column declared `Float` (**low** — see correction) |
| `float-money-arithmetic` | 97 | Arithmetic on a money value outside `Decimal` |
| `atomic-state` | 1 | Aggregate over an execution table with no success predicate |

Concentration of `float-money-column`: `bot/models/swap.py` (10), `bot/models/fees.py` (9),
`bot/models/copy_trading.py` (8), `bot/models/referral.py` (5), `bot/models/custodial.py` (4).

The scanner is a heuristic linter and exits 0 by design — gating CI on a report with known
false positives just teaches people to ignore it.

## Fixed in this pass

### 1. Fee split did not conserve the pool — `bot/services/fee_service.py`

The 40/60 staking/protocol split of the net fee was two independent float
multiplications:

```python
staking_allocation_usd  = float(net_fee) * 0.40
protocol_allocation_usd = float(net_fee) * 0.60
```

The comment directly above it asserts the invariant `referral + staking + protocol ==
fee_amount`. The code did not hold it. Measured over net-fee values `$0.01`–`$20.00` in
cent steps, **121 of 2,000 failed to conserve** — the two shares did not sum back to the
pool they came from.

Now allocated with `bot.utils.money.pro_rata`, a largest-remainder splitter that assigns
the rounding dust deterministically. Same sweep: **0 of 2,000 fail**. This is Tektonic's
ADL allocation finding applied to our own pool — their greedy most-profitable-first fill
moved $45–52M unnecessarily where integer pro-rata reduced it to ~$3M at zero capital
cost.

### 2. Referral volume gate counted unsettled swaps — `bot/services/referral_service.py:445`

The `$10` lifetime-volume gate before a referrer earns anything summed swaps with status
in `("completed", "submitted")`. **`submitted` is broadcast-but-unconfirmed** — such a
swap can still revert. A referee could therefore cross the payout threshold on volume
that never settled, unlocking referrer rewards against nothing.

Narrowed to `SwapStatus.COMPLETED` only. This is a deliberate behaviour change on the
money path: referees now cross the gate strictly later (when the swap confirms rather
than when it is broadcast), which is the correct direction — Tektonic's institutional
constraint is "exactly 0.00% inflation from reverted or failed executions", and a
threshold computed over in-flight rows is inflated by construction.

## Correction (2026-08-30): the `Float` column severity was wrong

This report originally rated the 48 `Float` money columns **high**, asserting that
"stored totals drift from the sum of their parts and a replay can never reconcile to
zero." That was asserted, not measured. Measuring it:

- 500 buys then 500 partial sells of a sub-cent token: drift from the exact `Decimal`
  result was **$0.0000000000**.
- One large buy then 2,900 tiny partial sells against a BTC-scale price: drift
  **$0.0000000048**.

Double carries ~15–17 significant digits and our magnitudes are nowhere near that. The
columns are a style problem — exact representation matters for audit and equality
comparison — not a source of lost money. Downgraded to **low** in the scanner, with the
measurement recorded in the finding itself. Retyping them is a dual-ORM migration whose
table-rewrite lock costs more than the defect it removes; the right time is when a table
is being altered anyway.

The lesson generalises: this audit found two real bugs by reading code, and one false
alarm by pattern-matching on types. The scanner is worth keeping for the first kind.

## Not fixed — deliberate scope call

The 48 `Float` money **columns** are not migrated here. Changing a column type across
both the SQLAlchemy models and the Drizzle schema is a dual-ORM migration
(`docs/development/migrations.md`, ADR 0003) and belongs in its own change with its own
review, not appended to an audit pass.

The mitigation that *is* in place: `bot/utils/money` gives every write path a way to
quantize to the published precision before the value reaches a `Float` column, so the
stored number is at least reproducible even while the column type is wrong. New money
columns should be `Numeric(38, 18)`.

Most of the 97 `float-money-arithmetic` hits are display formatting and threshold
comparisons where float is harmless. The ones that matter are writes and allocations;
those are the ones to work through, ranked by `severity` in the JSON.

## Re-running

```bash
python3 scripts/audit/money_precision_scan.py                       # console report
python3 scripts/audit/money_precision_scan.py --json .audit/x.json  # full findings
python3 scripts/audit/money_precision_scan.py --class atomic-state  # one class
```
