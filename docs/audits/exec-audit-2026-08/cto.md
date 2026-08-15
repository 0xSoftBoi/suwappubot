# CTO Audit — Architecture, Bridges, Chains (exec-audit-2026-08)

Scope covered: bridge layer (7 providers + registry), BTC/Atomiq bridge + poller, Turnkey client/fallback, chain-config RPC coherence. Not reached (flagged, not skipped): api/main.py lifespan async/sync audit; full dead-chain executor sweep.

## Top 10 findings (ranked)

**1. HIGH — `bot/services/hot_wallet.py:1027-1342` (`_sign_via_turnkey`)**
Custodial/house hot-wallet withdrawal signing calls Turnkey directly with no circuit breaker or backup-key fallback — unlike user-wallet signing (`bot/services/wallet.py:1688-1815`, wrapped in `turnkey_fallback.sign_*_with_fallback`). A Turnkey outage hard-fails all custodial withdrawals/fee-sweeps.
Fix: route HotWallet signing through the same CircuitBreaker/backup-key mechanism, or document fail-closed intent.

**2. HIGH — `bot/services/btc_bridge_poller.py:19,94-107`**
After 10 consecutive failures (~3-4 min at 20s), poller marks `BtcSwap` finished/failed unconditionally, without checking on-chain escrow. For btc_out/ln_out, escrow may be committed on Starknet (funds locked); if Atomiq's API is down the refund action never arrives — DB says "failed" while funds sit in escrow with no automated recovery.
Fix: query escrow contract directly before giving up; widen window toward the 2h standard (`swap_engine.py` `ZEROX_UNRESOLVED_FAIL_AFTER`); add a distinct "stuck-in-escrow, needs manual refund" state.

**3. MEDIUM — `bot/services/bridge/near_intents.py:288-372` (`commit_quote`)**
Only method minting a spendable `deposit_address`; never called outside the module (quote-only today). Unaudited idempotency: retry would mint a second one-time deposit address with no de-dup key.
Fix on wiring: persist minted address immediately (row-before-signing discipline per `bot/models/bridge.py`); retries reuse persisted address.

**4. MEDIUM — `bot/services/btc_bridge.py:468`**
Starknet escrow signing calls `wallet_service.get_private_key(wallet)` which raises for Turnkey wallets (`wallet.py:696-700`). Safe only via the unenforced invariant that Turnkey wallets are evm/solana.
Fix: assert Starknet wallets can never be `wallet_provider="turnkey"`, or build the signer first.

**5. MEDIUM (caveat) — `registry.py` + `swap_engine.py:79-88`**
Allowlist design is good: near_intents, allbridge, symbiosis, arbitrum_native are excluded from execution. But 4 of 8 bridge modules have never run a live quote→execute→settle cycle — their refund/error logic is verified only in review. Real live surface: Li.Fi, 0x-crosschain, gated USDT0.

**6. LOW/GOOD — `swap_engine.py:8172-8180`** — fixed near-miss: concurrent multi-wallet 0x_crosschain previously shared mutable `quote.raw_quote`, letting wallet B clobber wallet A's quote_id mid-flight; now isolated per task. Watch for the same class in any provider carrying mutable state in raw_quote/raw_response.

**7. LOW/GOOD — `swap_engine.py:8110-8149`** — fail-closed pattern to copy: unresolved 0x status falls back to on-chain origin-receipt check, 2h bound shared between manual-refresh and poller paths. This is the standard finding #2 should meet.

**8. LOW — Turnkey fallback covers EVM + typed-data + Solana only.** Tron always signs locally with backup key by design (`wallet.py:1883-1886`) — "no primary", not a fallback. Name this in the incident runbook.

**9. INFO — chain-config RPC coherence clean.** All 46 chains' `rpc_url_env` fields exist in settings.py (goat/starknet false-positives corrected; `titan_rpc_url` is MEV builder RPC, unrelated). NOT verified: which configured chains lack a live executor ("dead chains") — recommend scout diff of `CHAINS.keys()` vs chain-set literals in swap_engine.py/lifi_api.py/bridge `is_supported_route`.

**10. INFO — not reached: api/main.py lifespan async/sync audit.** Exactly the "CI green ≠ bot boots" class — recommend a dedicated scout pass. (COO's audit covered crash-isolation of the same services.)

## Architecture verdict

The executable bridge surface (Li.Fi, 0x-crosschain, gated USDT0, Atomiq/BTC) shows real fail-closed engineering: quote sanity bands, cross-format address validation, idempotency keys stamped before broadcast, and a documented fix for a genuine concurrent fund-tracking bug. The BTC/Atomiq escrow path is the one place "give up after ~3 min" is materially weaker than the 2h + on-chain-fallback standard, despite the same on-chain-lock risk — top actionable gap. Turnkey's circuit breaker protects user swaps but not custodial hot-wallet withdrawals — an inconsistency, not a choice. "8 bridges" overstates live surface: real exposure is 3 well-guarded paths. Dead-chain sweep and lifespan async audit are the next two passes.
