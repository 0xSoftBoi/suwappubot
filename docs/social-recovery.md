# Social Recovery (DKIM email)

Recover a lost Suwappu account by proving control of your registered recovery
email — verified by its **DKIM signature** (RFC 6376), the trust-minimized core
of "zk-email". No third party (e.g. Turnkey) is trusted to vouch for the email;
the bot verifies the RSA-SHA256 signature itself against the sender domain's
DNS-published key.

This complements the existing Turnkey recovery (`bot/services/wallet_recovery.py`),
which only works for Turnkey-hosted wallets. DKIM recovery works for any account,
including local KMS wallets.

## Flow

```
new account            bot                         email worker
  │  /recover you@x.com │                                │
  ├────────────────────▶│ request_recovery()             │
  │  challenge + delay  │  (RecoveryRequest, time-lock)   │
  │◀────────────────────┤                                │
  │  email w/ challenge in subject, from you@x.com ──────▶│
  │                     │  submit_approval_email(raw) ◀───┤  (DKIM verify)
  │                     │  status: approved               │
  │            …time-lock elapses…                        │
  │                     │  finalize_recovery() ◀──────────┤  (scheduled)
  │  account transferred│                                 │
```

1. **`/recover you@email.com`** (`bot/handlers/recovery.py`) from the new account
   creates a time-locked `RecoveryRequest` with a random challenge token.
2. The user emails that token (in the subject) **from their recovery address**.
3. An email-ingestion worker calls
   `social_recovery_service.submit_approval_email(raw_bytes)`. The email is
   DKIM-verified, the From address must equal the registered recovery email, and
   the verified DKIM domain must match — then the request is marked **approved**.
4. After the **time-lock** (default 24h), `finalize_recovery()` transfers the
   account (and its wallets) to the new Telegram id. The original owner can
   `cancel_recovery()` any time before execution — the anti-theft guarantee.

## What's built vs. not

| Piece | Status |
|---|---|
| DKIM RSA-SHA256 verification (relaxed/simple, RFC 6376) | ✅ `bot/services/dkim_verifier.py`, tested against RFC known-answer vectors + RSA round-trip. |
| Recovery state machine (request → approve → time-lock → finalize → cancel) | ✅ `bot/services/social_recovery.py`, 12 tests. |
| `/recover` command + cancel button | ✅ `bot/handlers/recovery.py`. |
| Email **ingestion** worker (IMAP/webhook → `submit_approval_email`) | ⛔ Not built — it's an infra integration point. |
| Scheduled **finalize** after time-lock | ⛔ Not built — wire into the bot's background services. |
| On-chain **zk** proof (trustless contract-side verification) | ⛔ Future — integrates ZK Email's audited circuits + relayer once wallets are smart accounts. |

## Dependencies

- `cryptography` (already present) — RSA/SHA-256 verification.
- `dnspython` — fetches the `selector._domainkey.<domain>` TXT record. The key
  resolver is injectable, so verification is fully testable offline.

## To finish productionizing

1. **Email ingestion**: add a worker (IMAP poll on a dedicated recovery inbox, or
   an inbound-email webhook from a provider) that passes raw messages to
   `submit_approval_email`.
2. **Finalize job**: a background task that calls `finalize_recovery` for
   approved requests whose time-lock has elapsed (mirror the pattern of the
   other services started in `api/main.py`'s lifespan).
3. **Notify the owner** on every new request so a fraudulent recovery is visible
   and cancellable within the delay window.
