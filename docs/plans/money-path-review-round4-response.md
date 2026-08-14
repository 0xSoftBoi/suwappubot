# Money-path review round 4 — response

Every finding closed. Verdict on entry: BLOCK (2 blockers, 4 high, 6 medium, 5 low).

## Live on-chain check that unblocked B2

`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` on chain 4663 (`eth_chainId` → `0x1237`):

| call | result |
|---|---|
| `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` | `0xd099cc98…13de8` — matches canonical EIP-3009 |
| `receiveWithAuthorization(...)`, `to == msg.sender` | reverts `InvalidSignature()` `0x8baa579f` (signature check reached) |
| `receiveWithAuthorization(...)`, `to != msg.sender` | reverts `CallerMustBePayee()` `0x5454b17d` |

So USDG does expose it, and it does enforce the payee check. B2's fix is sound.

## Findings

| # | Fix | Commit |
|---|---|---|
| B1 renewal impossible forever | `subscriptionSeq` mixed into the nonce (V2), `nextSubscriptionNonce` view, Python reads seq before signing | `0a8441a4` |
| B2 settlement unbound | `receiveWithAuthorization` with `to = address(this)`, sweep to treasury | `0a8441a4` |
| H1 treasury signed from config | no longer signed over at all — read from contract storage at settlement | `0a8441a4` |
| H2 watch-only wallets grant perks | `KEY_CONTROLLED_PROVIDERS` filter + `order_by(Wallet.id)` | `0862de5e` |
| H3 blocking web3 on the loop | bounded executor, per-call timeout, `(address, ticker)` boost cache | `0862de5e` |
| H4 relayer nonce race | lock over nonce-read + send, `"pending"` tag, local floor, admission gate | `a97a07fe` |
| M1 `decimals()` outside the catch | cached at `setEthUsdFeed`, which rejects a feed that cannot answer | `a92af43f` |
| M2 flat fallback mis-prices | last-good in-band price cached on mint, used for 7 days before the constant | `a92af43f` |
| M3 `price == 0` phase | `PriceZero()` | `a92af43f` |
| M4 `renounceOwnership` | disabled | `a92af43f` |
| M5 `ownerMint` ignores end/pause | both enforced | `a92af43f` |
| M6 price from a Python constant | read `pricePerPeriod()` by eth_call, fail closed | `a92af43f` |
| L1 stale supply during `onERC721Received` | `totalSupply` written before the loop, `nonReentrant` on `ownerMint` | `a92af43f` |
| L2 signature malleability | reject high-half `s`, `v ∉ {27,28}` | `a92af43f` |
| L3 unchecked `uint128(entry)` | `SafeCast.toUint128` | `a92af43f` |
| L4 future-stamped feed reads fresh | `updatedAt == 0 \|\| updatedAt > block.timestamp` → stale | `a92af43f` |
| L5 relayer key as `str` | `SecretStr` | `a92af43f` |

## Tests

Two of my own tests asserted B1's behaviour as a security property
(`test_membership_evm.py`, `test_attacks_evm.py`) — both corrected; the suite now
distinguishes "replay is dead" from "repurchase is impossible".

New regression tests, all behavioural rather than source greps, and each verified
to FAIL against the pre-fix code where that was checkable:

- renewal across three consecutive purchases with distinct nonces
- raw `receiveWithAuthorization` from a third party rejected, nonce unburned
- treasury rotation mid-flight routes to the new address and still credits
- watch-only / inactive / absent wallet cases against a real DB
- event-loop blocking measured by wall clock (tick counting does **not** catch it)
- four concurrent relayer broadcasts — pre-fix all four take nonce 0
- reverting `decimals()`, outage pricing, `price == 0`, renounce, `ownerMint`
  after the announced end, future-stamped rounds

## State

Full suite: 2,225 passed, 26 failed — byte-identical to the pre-existing baseline
(aegis / nl-intent / tempo, all missing-dependency failures unrelated to this work).
`black --check` clean across 524 files. `bot.main` imports.

Gas snapshot re-baselined: the positions case measured a **free** phase, which
`configurePhase` now rejects, and which never exercised the oracle read, the
last-good cache write or the refund branch. Priced measurement: 256,897 (x1),
58,767 per card (x10).

Published ABIs regenerated — `SuwappuPositions.json` was missing 26 functions,
the entire pricing and mint-lifecycle surface.

## Not done

Nothing from the review is outstanding. Still true of the feature as a whole:
the contracts are **not deployed** and no fix here has been exercised against a
real transaction on 4663. Everything above is verified against real compiled
bytecode on eth-tester plus the four live `eth_call`s listed at the top — that is
code-complete and adversarially tested, not functionally verified on-chain.
