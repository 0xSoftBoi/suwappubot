# Proposal: per-user router isolation for SuwappuCoreRouter

Date: 2026-09-01
Author: audit follow-up discussion, branch `nanofaxcopy/hyperliquid-primitives-hip4-audit`
Status: idea for a future market/version — not a patch to the existing deployed-shape contract

## Problem

`SuwappuCoreRouter.sol` crowds **every user of a given market** behind a
single global lock (`inFlight`). Only one swap, from one user, can be
in-flight at a time per router instance — everyone else queues behind it.

That lock isn't an arbitrary throughput knob. It exists because HyperCore's
spot accounting is keyed by address: `L1Read.spotBalance(address(this), token)`
reads *this contract's* balance. Since every user swaps through the same
contract address, every user shares one HyperCore account, one Core balance,
one EVM ERC-20 balance. The lock is the only thing standing between that
shared balance and cross-user misattribution.

It isn't fully sufficient, either — see `contracts/AUDIT_COREROUTER_2026-08-31.md`.
F1 (fixed), F2, F3, and the documented donation-griefing residual are four
separate symptoms of the *same* root cause: balance-delta attribution across a
balance shared by strangers is inherently fragile. Every fix so far has been
a patch to one specific way that sharing goes wrong. None of them address the
sharing itself.

## Proposal

Give every user their own dedicated HyperCore account — i.e. their own
contract address — instead of sharing the market's router. Concretely: a
minimal proxy per user (EIP-1167 clone), `delegatecall`-ing into one shared
logic implementation per market.

**Why this actually works, not just "helps":** `delegatecall` preserves the
caller's own address and storage — `address(this)` inside the shared logic
code resolves to the *proxy's* address, not the implementation's. So
`L1Read.spotBalance(address(this), token)` and every `CoreWriterLib` action
issued from inside a user's proxy are automatically scoped to that proxy's
own, exclusive HyperCore account. There is no balance left to share, so there
is no delta left to misattribute — not "harder to exploit," structurally
absent. F1/F2/F3/the donation residual all stop being possible in one move,
because their shared precondition (one address, many users) is gone.

## Sketch

- **`RouterFactory` (per market)** — deploys a minimal proxy per user via
  `CREATE2`, so a user's proxy address is deterministic and can be
  precomputed/approved-against before it's even deployed (lazy-deploy on
  first `initiate()`, à la counterfactual smart-wallet patterns).
- **`SuwappuCoreRouterLogic` (one per market, shared)** — holds the actual
  four-phase lifecycle code, unchanged in spirit from today's contract. Market
  config (`baseErc20`, `quoteErc20`, `orderAsset`, decimals, `treasury`,
  `feeBps`) needs to move from per-instance immutables to either (a) baked
  into each clone's bytecode via immutable-args cloning (e.g. Solady's
  `LibClone`), or (b) read from the factory on each call. (a) is cheaper at
  steady-state and keeps the "immutable, no admin" character of the original.
- **Per-proxy storage** — `inFlight` becomes near-vestigial: it only prevents
  *the same user* from double-submitting two overlapping swaps against their
  own balance, which is a self-imposed, low-stakes constraint rather than a
  scarce shared resource contended by every user on the DEX. The `swaps`
  mapping likewise no longer needs to be global.
- **Access control** — only the owning user (whoever the factory deployed the
  proxy for) may call `initiate()` on their own proxy; `execute`/`settle`/
  `claim`/`retry`/`forceRelease` can stay permissionless exactly as today,
  since anyone calling them now only ever affects that one isolated user's
  state, regardless of who triggers it.
- **Funds custody** — users approve their own proxy address directly (same
  UX as approving any other contract), not the shared logic implementation.

## Tradeoffs

- **Deployment cost**: one clone per user, ~45–55k gas (EIP-1167 minimal
  proxy), one-time and easily amortized over that user's swap history. Lazy
  `CREATE2` deploy on first use avoids paying for users who never swap.
- **Storage-layout discipline**: `delegatecall` proxies require the logic
  contract's storage layout to stay stable forever (no admin/upgrade means
  this is a one-time design decision, not an ongoing risk — consistent with
  the project's existing "immutable, no upgrade path" philosophy).
- **Not a hot-patch**: this reshapes the contract's whole architecture. It
  isn't something to retrofit onto the currently-deployed
  `SuwappuCoreRouter.sol` — it's a candidate shape for the *next* router
  version/market, deployed alongside or instead of the current one.

## Recommendation

Worth prototyping as a v2 router architecture before the next market
deployment, specifically because it eliminates an entire class of findings
at the root rather than requiring a fix-per-symptom cadence (this file
exists because round 5 found what rounds 1–4 didn't). Suggest scoping a
small spike: `RouterFactory` + `LibClone`-style immutable-args logic +
port of the existing `CoreRouterTest.t.sol` suite against the cloned
version, and a fresh adversarial pass once that's stood up.
