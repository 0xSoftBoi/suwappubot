# Bridge rails: enabling, verifying, recovering

Every cross-chain rail added on this branch ships **default-OFF**. That is not
caution for its own sake — each flag has a specific precondition that has not
been met, and flipping one without meeting it can strand or lose user funds.

This document is the checklist. It exists because the preconditions were
otherwise scattered across commit messages and code comments.

> Anything below described as *verified* was checked against the live chains by
> `scripts/verify_onchain_constants.py`. Anything described as *unverified* was
> coded from documentation and has never been exercised against a real endpoint.
> Treat the distinction as load-bearing.

---

## Before touching any flag

```bash
bash scripts/verify.sh onchain
```

This re-checks, against mainnet: both CCTP v2 contract addresses, every CCTP
domain ID, `usedNonces` (the relayer's idempotency primitive), every USDT0
token/OFT pairing via `OFT.token()`, USDT0 decimals, the per-chain
`approvalRequired()` values, and all eight LayerZero endpoint IDs. Non-zero exit
means a constant in the tree disagrees with reality — stop and investigate
before shipping anything.

It is deliberately excluded from `verify.sh all`: it hits ~8 public RPC
endpoints which rate-limit and intermittently fail individual methods, so
folding it in would make the general gate flaky for unrelated reasons.

---

## `cctp_v2_enabled` — already ON (default `True`)

CCTP v1 is deprecated by Circle ("V2 is now the canonical CCTP"), so v2 is the
default. Two related knobs:

- `cctp_v2_default_mode` — defaults to `standard`. Setting it to `fast` starts
  **paying Circle's Fast Transfer fee** on every transfer. Fast settles in
  ~8-20s versus hard finality (minutes); Standard is gas-only.
- `cctp_v2_max_fast_fee_bps` — the cap on that fee. A Fast quote is **refused**
  if this is unset or zero rather than submitted with an unbounded fee. Integer
  math, so sub-cent amounts at 1 bps hard-fail loudly rather than rounding to a
  free transfer.

Before switching to `fast`, be aware the fee is deducted from the burned amount
at mint, so the recipient gets `amount - fee`. The quote accounts for this.

## `cctp_generic_rail_enabled` — OFF. **Do not flip alone.**

This rail previously burned USDC that was never minted. It is gated because
`_execute_cctp_swap` does approve + `depositForBurn` on the source chain and
nothing completes the destination side unless the relayer below is running.

**Flipping this without `cctp_generic_relayer_enabled` destroys user funds.**

Preconditions, all of them:

1. `cctp_generic_relayer_enabled = true` and the relayer loop confirmed running.
2. `cctp_relayer_private_key` set, and that wallet **funded with native gas on
   every chain in `cctp_api.CCTP_DOMAINS`** — not just the ones you expect
   traffic on. An unfunded destination chain stalls every deposit routed there.
3. One real small-amount transfer completed end-to-end on a single corridor:
   burn lands → Circle attestation returns → `receiveMessage` mints → recipient
   balance actually increases. Confirm the mint on-chain, not just in our logs.
4. `cctp_generic_relayer_min_native_alert` set to a threshold that gives you
   time to top up, and the alert path confirmed to reach a human.

## `cctp_generic_relayer_enabled` — OFF

Safe to enable **before** the rail itself; with no rail traffic it simply has
nothing to do, which is a good way to confirm the loop starts cleanly and the
balance sweep alerts fire.

How it stays correct, so you know what to watch:

- **Idempotency** is decided by `MessageTransmitterV2.usedNonces` on the
  destination chain — never by matching revert-message text. That distinction
  matters: broadcast failures are dominated by ordinary EOA transaction-nonce
  collisions, which some RPC providers word as "nonce already used". Reading
  that as success would mark a deposit minted when nothing minted.
- **Crash safety**: the burn is recorded as `pending_broadcast` *before* it is
  broadcast, keyed on the locally-derived keccak hash. A client-side timeout
  where the tx still propagates therefore leaves a row for the reconciler to
  resolve via `get_transaction_receipt`.
- **Stalls vs failures** are counted separately. Insufficient relayer gas and
  transient RPC errors increment `stall_count` and alert; they do not consume
  the terminal attempt budget. `failed` means a human must look.

### Recovering a stranded deposit

`requeue_failed()` exists on the relayer but **has no caller** — no admin
command or route exposes it yet. Recovery today means a psql session against
`cctp_generic_deposits`:

```sql
-- Triage: what is stuck and why
SELECT id, status, attempts, stall_count, from_chain, to_chain,
       burn_tx_hash, mint_tx_hash, last_error
FROM cctp_generic_deposits
WHERE status IN ('pending_broadcast', 'burned', 'attested', 'failed')
ORDER BY created_at DESC;
```

Before requeueing anything in `failed`, fix the cause (usually relayer gas on
`to_chain`). Then reset it to `burned` and clear the counters so the loop picks
it up again.

Never hand-set a row to `minted` to silence an alert: `minted` is excluded from
both the pending sweep and requeue, so it makes the deposit permanently
invisible — which is precisely the failure mode the `usedNonces` check exists to
prevent. If you need to confirm a mint really happened, check `usedNonces` for
that message's nonce on the destination chain.

## `usdt0_bridge_enabled` — OFF

The verified part: all eight token/OFT pairs, decimals, EIDs, and the
per-chain approve asymmetry. Both the quote path and the executor are wired, so
this flag is the only thing between the current state and a live transfer.

The asymmetry is the thing to understand before enabling:

| chains | `approvalRequired()` | behaviour |
|---|---|---|
| arbitrum, plasma, hyperevm, ink, unichain, berachain, flare | `0` | native mint/burn OFT — **no** ERC20 approve |
| ethereum | `1` | lockbox holding canonical Tether USDT — approve **required** |

A spurious approve on a satellite only wastes gas. Omitting it on Ethereum makes
the send revert. The quote decides this, not the executor.

Preconditions:

1. `bash scripts/verify.sh onchain` green.
2. One small transfer **per direction**, including at least one through the
   **Ethereum lockbox leg** — that is the only leg that exercises the approve
   branch, so a satellite-only test proves nothing about it.
3. Confirm the LayerZero message actually delivered on the destination, not just
   that the source tx succeeded. `get_status` is currently a stub returning
   `UNKNOWN`; track the source tx hash on LayerZero Scan manually until it is
   implemented.

Note the fee handling when reading quotes: the LayerZero messaging fee is paid
as native tx `value`, buffered 17.5% (surplus is refunded by LayerZero to the
sender), and capped — an absurd fee is refused rather than allowed to drain the
wallet.

## `allbridge_bridge_enabled`, `symbiosis_bridge_enabled`, `near_intents_api_key` — OFF

These three are a different category from the CCTP/USDT0 rails: their **request
and response shapes were coded from documentation and have never been exercised
against a live endpoint.** No amount of on-chain address verification covers
that, because the risk is in the API contract, not the addresses.

Do not enable any of them without first replaying a real quote against the live
API and diffing the response against what the parser expects.

NEAR Intents specifically:
- Requires `near_intents_api_key`; the provider self-disables without it.
- Quoting uses `dry: true`. Only `commit_quote()` (`dry: false`) yields a usable
  deposit address — that split exists so browsing prices does not mint live
  deposit intents.
- `near_intents_fee_bps` is capped at 100, and the fee recipient must be a
  NEAR-shaped account. An EVM address is silently skipped rather than sent.

## `arbitrum_native_bridge_enabled` — OFF, and it will stay inert

`get_quote` returns `None` unconditionally. This is intentional:
`outboundTransfer` is payable and needs
`value >= maxSubmissionCost + maxGas * gasPriceBid`, with `_data` encoded as
`abi.encode(maxSubmissionCost, extraData)`. Those parameters must be fetched
live via `NodeInterface.estimateRetryableTicket`, which is not wired.

Flipping the flag alone changes nothing. Wire live gas estimation first,
otherwise a deposit reverts and burns the user's L1 gas — or worse, creates a
retryable ticket that expires unredeemed after 7 days.

The L2→L1 withdrawal direction is refused by design: a ~7-day challenge period
would be misleading presented as a swap quote.

## `tempo_fee_sponsor_enabled` — OFF, and it is fully built

Not part of this branch, but worth recording since it comes up in the same
breath: the type-0x76 fee-payer sponsorship path in
`bot/services/tempo_fee_sponsor.py` is complete and wired to pytempo. It needs a
live test, not code.

---

## Rolling back

All of these are read-at-startup settings, so rollback is: set the flag to
`false` and restart the service. There is no in-flight migration to reverse.

The one exception is the CCTP generic rail. Turning the rail off while deposits
are in flight leaves them mid-transfer — **keep
`cctp_generic_relayer_enabled = true` until the pending queue drains**, or those
burns never mint:

```sql
SELECT count(*) FROM cctp_generic_deposits
WHERE status IN ('pending_broadcast', 'burned', 'attested');
```

Wait for that to reach zero before disabling the relayer.
