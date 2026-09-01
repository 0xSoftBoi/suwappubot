# SuwappuCoreRouter — money-path-reviewer audit (2026-08-31)

Branch: `nanofaxcopy/hyperliquid-primitives-hip4-audit`
Scope: `contracts/hypercore/SuwappuCoreRouter.sol` (+ `L1Read.sol`, `CoreWriterLib.sol` for semantics)
Audited at commit: `deac4cfcdbb7e6e44f49a6ac27e43bf5ddf8979e` (last commit touching the file as of this audit)

## Verdict: BLOCK for any value-bearing deploy

2 new fund-loss paths, both reachable through the contract's own liveness
design (`forceRelease`/`retry`), not through misuse. Testnet soak is fine —
these require real HyperCore round-trip timing to trigger. This supersedes
the "cleared SHIP-TO-TESTNET" status recorded in `DEPLOY_HYPEREVM.md`
(892bd507) — that record predates this pass and did not catch F1/F2.

---

## NEW — open findings

### F1 · HIGH · `claim()` has no in-flight guard → a force-released `Bridging`
swap can eat a later swap's EVM credits
`SuwappuCoreRouter.sol:343-367` (missing guard before :359-360), enabled by `:397-402`.

`forceRelease()`'s `Bridging` branch sets `inFlight = 0` but leaves the swap
`Bridging` with `owedOut`/`owedIn` intact and `claim()` permanently callable.
`claim()` — unlike `retry()` at :375 — has **no** `inFlight` check. Two
`Bridging` swaps can coexist, so the "per-swap EVM snapshot" gate is not
actually per-swap once they overlap.

Exploit (no attacker needed — any keeper triggers it):
1. Swap B settles: `owedOut = 1000`, `evmOutSnapshot = 0`; its Core→EVM
   `spotSend` is rejected and `retry(B)` doesn't land either.
2. At `settledL1Block + 100_000`, `forceRelease(B)` → `inFlight = 0`, B stays
   `Bridging`.
3. Victim C runs the full lifecycle, settles with `owedOut = 1200`,
   `evmOutSnapshot = 0`. C's bridge-back lands: router EVM balance = 1200.
4. `claim(B)`: `1200 >= 0 + 1000` ✅ → pays B's user 1000 out of **C's**
   tokens. Balance = 200.
5. `claim(C)`: `200 >= 0 + 1200` ✗ → `BridgeNotLanded` forever. `retry(C)`
   re-sends `_min64(owedOut, _free(out))`, now ~0 on Core.
6. B is `Done`, so `retry(B)` is dead — B's 1000 stays on Core, unattributable
   to anyone. C's loss cascades into D, E…

`test_forceRelease_fromFunding_andBridging`
(`test/CoreRouterTest.t.sol:404-412`) asserts this state without a concurrent
swap, so the suite passes.

**Fix (recommended, structural):** The primary dilemma for this issue
is how one user may take funds from another user's subsequent swap. this is
only possible when multiple users are making use of the same contract, which
itself is a drawback that bottlenecks the system. The recommended fix is to
isolate each user with their own EIP-1167 cloned router, eliminating the
bottleneck in the system at the same time as never commingling assets at 
any point in the router's lifecycle.

See `contracts/PROPOSAL_PER_USER_ROUTER_ISOLATION_2026-09-01.md`. Under
per-user proxy isolation there is no shared account left for even the
stale-vs-stale race above to occur on, and the same isolation closes F2 and
F3 by the same mechanism (removing the shared balance, not patching each
way sharing it goes wrong). 

**Fix (tactical, patches the contract as currently shaped, recommended):**
gate `claim()` itself rather than changing what `forceRelease()` does:

```solidity
if (inFlight != 0 && inFlight != id) revert Locked();
```

placed right after `claim()`'s existing `ZeroAmount` check. This is
sufficient on its own — `forceRelease()` doesn't need to change at all.
Mechanism: `inFlight` can only be `0` while a claimable (`Bridging`) swap
exists via exactly one path — `forceRelease()`'s `Bridging` branch (traced
against every `inFlight` write site in the contract; `claim()` and the
Funding/Pending-abandon branch both always pair clearing the lock with
taking the swap out of `Bridging`). So the guard permits a claim exactly
when it's safe — either you're the current lock holder (`inFlight == id`,
the normal path), or the router is genuinely idle (`inFlight == 0`, nothing
else is mid-flight to misattribute) — and blocks it exactly when it isn't:
the instant a *different* swap becomes active (`inFlight == thatSwap`), any
stale claim is locked out until that swap's own `claim()` naturally clears
the lock again — by which point that swap has already extracted precisely
its own owed amount, leaving nothing of its to steal.

**This is what actually segregates users, not just narrows the window**:
since exactly one swap can ever hold `inFlight` at a time regardless of
whose swap it is, *whoever currently holds the lock is fully protected from
every other stale claim, unconditionally* — a stale claim can never drain
an actively in-progress swap, full stop, no timing luck involved. One
honest residual: if *multiple* already-abandoned swaps are simultaneously
sitting `Bridging` with `inFlight == 0` (possibly belonging to different
users, if more than one swap independently got stuck and released before
anyone started a new one), they can still race each other for whatever
balance happens to be idle at that moment — first `claim()` wins. That's a
real but much lower-severity residual than F1 itself: it can only ever
happen among mutually-abandoned claims, never at the expense of a user
currently mid-swap.

Confidence: **high**.

Before — `SuwappuCoreRouter.sol:343-349` (buggy: no `inFlight` gate at all):
```solidity
function claim(uint128 id) external {
    Swap storage s = swaps[id];
    if (s.status != Status.Bridging) revert BadStatus();
    if (s.owedOut == 0 && s.owedIn == 0) revert ZeroAmount();

    (uint64 coreTokenOut, uint64 coreTokenIn) =
        s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);
    ...
```

After — proposed fix (not applied to the codebase; described here only):
```solidity
function claim(uint128 id) external {
    Swap storage s = swaps[id];
    if (s.status != Status.Bridging) revert BadStatus();
    if (s.owedOut == 0 && s.owedIn == 0) revert ZeroAmount();
    // AUDIT FIX (F1): claim() had no relationship to inFlight at all, so a
    // swap left Bridging-and-claimable by forceRelease() (see its Bridging
    // branch, unchanged) could be paid out of a LATER, unrelated swap's
    // landed bridge-back once that swap took the lock (cross-swap credit
    // theft; see contracts/test/CoreRouterAudit.t.sol). Permit a claim only
    // when it's safe to trust the balance check below: either this swap
    // still holds the lock (the normal path), or nothing else is currently
    // mid-flight to misattribute (inFlight == 0, genuinely idle).
    if (inFlight != 0 && inFlight != id) revert Locked();

    (uint64 coreTokenOut, uint64 coreTokenIn) =
        s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);
    ...
```

### F2 · MEDIUM-HIGH · `retry()`'s `inFlight` guard is call-time only; the
send it issues is async and can perturb the *next* swap's delta window
`SuwappuCoreRouter.sol:372-385`, guard at :375.

Header claim (:52-53) that "retry() cannot perturb a live delta window" only
holds if the lock is held across the async landing — the exact argument used
to make `forceRelease` retain the lock (deac4cfc). `retry()` is allowed when
`inFlight == 0`; `initiate()` can take the lock the very next block; the
retry's `spotSend` lands after → new swap under-credited.

Second effect: `_bridgeBack(coreTokenOut, _min64(s.owedOut, _free(coreTokenOut)))`
sends "up to `owedOut` of whatever free balance exists," not "re-send what
didn't land." If the original send *did* land and residue exists on Core
(aborted-swap deposit, unlanded fee, donation), `retry()` double-bridges it —
manufacturing the documented donation-residual precondition for free.

**Fix:** `retry()` should require `inFlight == id` or re-acquire the lock.
Confidence: **high** on the lock gap, **medium** on the double-bridge.

---

## MEDIUM

- **F3 — `inSnapshot` uses `free`, `_reconcile` compares against `total`.**
  Consistent only if `hold == 0` at snapshot time, but `forceRelease`'s own
  abort path deliberately leaves `hold > 0`. Once that stale hold resolves,
  a later swap's refund/proceeds get inflated by up to `coreIn`, drawn from
  the abandoned balance. `:246` vs `:321`.
- **F4 — `minCoreOut` is dead code.** Documented as an "acceptance bound for
  fee-charging" but only gates a zero check and an event flag; fee is charged
  regardless of fill quality. Callers relying on the ABI's implied slippage
  protection get none. `:92`, `:226`, `:325`, `:336`.
- **F5 — `execute()`'s landing check overflows in uint64.**
  `_free(coreTokenIn) < s.inSnapshot + s.coreIn` (`:274`) sums in uint64; a
  donated balance near `type(uint64).max` reverts the check permanently,
  wedging every swap for 100k L1 blocks. Cast to uint256.
- **F6 — Constructor under-validates immutable, unfixable config.**
  `baseExtraEvmDecimals`/`quoteExtraEvmDecimals`/`*WeiDecimals` unbounded
  (can brick `claim()`/`initiate()` later); `orderAsset` never cross-checked
  against `[baseToken, quoteToken]` via `SPOT_INFO` — a wrong value silently
  routes every order to a different market. `:149-168`.
- **F7 — `execute()` is a free look-back option on `limitPx`.** Permissionless,
  unbounded delay after `initiate()`; a caller can wait for price to move
  against the user before triggering the fill. Add an expiry.

## LOW

- **F8 — Lock-hogging DoS.** No minimum swap size; dust swaps can
  perpetually re-claim the global lock.
- **F9 — `inFlight = 0` before external transfers in `claim()`**, plus raw
  `transfer`/`transferFrom` assumptions (no SafeERC20, no fee-on-transfer
  handling — `execute()` would never observe a fee-on-transfer deposit and
  wedge permanently).
- **F10 — `claim()` doesn't verify the fee `spotSend` landed** — sound today
  via CoreWriter FIFO ordering, but undocumented.
- **F11 — `SETTLE_DELAY_L1 = 100` can't distinguish "order rejected" from
  "order not yet landed."**

---

## Already mitigated (do not re-file)

- Order-before-funding race → funded-then-execute (`bf22c458`), `:274`.
- `rescue()` misattribution → removed; `_reconcile(orderPlaced=false)` zeroes
  the out-leg (`8a7def14`, `:320`).
- `forceRelease` reconciling outside the lock → now under the lock
  (`8a7def14`, `:414-418`).
- Recovered `forceRelease` freeing the lock same-tx as its bridge-back → lock
  retained until `claim` (`deac4cfc`, `:419-426`).
- Stale `settle()` after release → `inFlight != id` check + terminalization
  (`:294`, `:436`).
- `retry()` starving `forceRelease` → release keyed off `settledL1Block`
  (`:398`).
- Aggregate-balance claim gating → per-swap EVM snapshots (`:328-329`) —
  correct in isolation; F1 is specifically about two swaps overlapping.
- Fee `spotSend` to uninitialized Core address → constructor
  `coreUserExists` check (`:153`).

## Rounding / overflow — clean

`_evmToCore` reverts on non-divisibility rather than truncating silently.
`_orderSz` truncates down twice; residue returns via `owedIn`. Fee math
(`owedOut + fee == outDelta` exactly) truncates in the user's favor. Only
uint64 overflow risk is F5. No drain vector found in the arithmetic itself.

## `inFlight` invariant — broken in exactly one place

`Funding ⇒ inFlight == id` and `Pending ⇒ inFlight == id` both hold.
`forceRelease`'s `Bridging` branch (`:399`) is the sole break: it clears the
lock while the swap is still claimable and its Core sends' fate is unknown
(F1), and `retry()` is then permitted lock-free (F2).

---

## Coverage note

**Checked:** every line of `SuwappuCoreRouter.sol`; all 5 `Status`
transitions including the never-lands branch of each; `inFlight`
acquire/release across all entry points; all arithmetic for over/underflow
and rounding direction; `claim()`'s snapshot gate under concurrent-swap
interleavings; constructor validation vs. the no-upgrade constraint;
reentrancy/CEI ordering; `L1Read.sol`/`CoreWriterLib.sol` for precompile/
action semantics; full git history of the file (6 commits);
`DEPLOY_HYPEREVM.md` residual list; all 17 tests in
`test/CoreRouterTest.t.sol`.

**Not checked:** did not compile or run the suite — findings are static. No
live chain-998 verification of precompile ABIs, `SPOT_INFO` layout, or actual
CoreWriter action-ordering guarantees (F10/F11 assumptions, not
measurements). Did not review off-chain callers (bot/api-ts) for how
`limitPx`/`minCoreOut` are populated (decides F4's real-world impact).
`MedusaHarness.sol` and other `contracts/` files out of scope.

**Test gaps to add:** two overlapping `Bridging` swaps with interleaved
`claim()` (F1); `retry()` with `inFlight == 0` followed by a new `initiate()`
(F2); `initiate()` with a pre-existing nonzero `hold` (F3); `execute()` with
`inSnapshot` near `type(uint64).max` (F5).
