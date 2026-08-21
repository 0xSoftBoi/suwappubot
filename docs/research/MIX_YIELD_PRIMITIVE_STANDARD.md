# Suwappu Mix-Yield Primitive Standard

## Status

This document is the normative engineering and security standard for Suwappu's mixed-yield portfolio primitive. It is informed by the public Alchemix MYT architecture and its audit history, but the Suwappu implementation is independent and intentionally narrows privileged execution surfaces.

## Portfolio architecture

A mixed-yield vault MUST expose fungible portfolio shares over one underlying asset and MAY allocate that asset across multiple independently risk-classified strategies through narrow adapters.

The vault separates responsibilities:

- **Share layer:** deposit, mint, withdraw, redeem, conservative NAV, and immediate-liquidity views.
- **Allocator:** may move funds only among already-approved strategy adapters.
- **Governance:** timelocked strategy onboarding/configuration and allocator rotation.
- **Emergency authority:** may immediately stop new allocations and unwind killed strategies.
- **Strategy adapters:** protocol-specific deposit/withdraw/accounting only; no generic arbitrary-call surface.

## Risk classes and hard caps

The current standard uses three risk classes:

| Class | Individual strategy cap | Aggregate class cap |
|---|---:|---:|
| Conservative | governance-defined up to 100% | 100% |
| Moderate | 25% | 40% |
| Aggressive | 10% | 10% |

Caps are measured against conservative portfolio NAV and MUST be enforced after allocation. A configuration change that would make a live portfolio unhealthy MUST fail rather than grandfather unsafe exposure silently.

## Conservative NAV

External strategy reports are not authoritative share NAV.

Required accounting behavior:

1. Strategy losses are recognized immediately.
2. Reported gains enter accounted NAV only through a configured maximum gain rate.
3. Idle underlying in either the vault or an adapter remains part of NAV.
4. A strategy withdrawal is accounted from underlying actually received, not the adapter's return value alone.
5. Deposit and withdrawal rounding that is permitted by the underlying protocol MUST be bounded explicitly. The current Aave V3 and ERC-4626 adapters permit at most one smallest unit of underlying deposit rounding loss; larger unexplained loss is an accounting failure.
6. Any permitted rounding loss is realized immediately in vault NAV rather than hidden or socialized later.

### Why bounded rounding is normative

Ethereum mainnet-fork validation found the same behavior independently in two production protocols:

- Aave V3 USDC can mint an aUSDC claim one micro-USDC below an exact USDC supply because of scaled-balance conversion rounding.
- A production Morpho USDC ERC-4626 vault can convert newly minted shares back to an asset value one micro-USDC below the exact deposit because ERC-4626 conversion rounds down.

Therefore "exact deployed value equals requested assets" is not a valid production invariant. "Loss is no more than a protocol-specific, explicitly bounded rounding budget and is immediately recognized" is the correct invariant.

## Liquidity semantics

`totalAssets` and immediate withdrawal capacity are different quantities.

The vault MUST NOT advertise all strategy NAV as synchronously withdrawable. Strategy adapters expose `liquidAssets` and the portfolio's `maxWithdraw` / `maxRedeem` are bounded by those values.

Protocol-specific rules:

- **Aave V3:** synchronous strategy liquidity is bounded by reserve underlying cash behind the aToken, plus any adapter-idle underlying.
- **ERC-4626 / Morpho-style vaults:** synchronous strategy liquidity is bounded by target `maxWithdraw(adapter)`, plus adapter-idle underlying.

A mainnet-fork stress test performs a real Aave supply and then reduces reserve cash to model a highly utilized reserve. Suwappu MUST shrink `maxWithdraw` accordingly and reject withdrawals above immediately realizable cash while still allowing withdrawals within the bound. This state mutation models the liquidity condition after utilization; it is not presented as a simulation of Aave's borrow transaction path.

## Adapter requirements

Every strategy adapter MUST:

- return the same underlying asset as the parent vault;
- authorize only the parent vault for state-changing adapter operations;
- expose underlying-denominated `totalAssets` and `liquidAssets`;
- include adapter-idle underlying in both views;
- use exact protocol entrypoints rather than generic execution;
- measure underlying actually returned to the parent vault;
- enforce caller-provided `minAssetsOut` on normal and emergency withdrawal;
- zero temporary protocol approvals after use;
- preserve a withdrawal/unwind path after new allocation is killed;
- fail atomically on protocol reverts;
- bound any protocol-specific rounding tolerance explicitly.

A generic adapter MUST NOT be treated as permission to onboard arbitrary vaults. Each concrete target still requires governance review, risk classification, exposure caps, and protocol-specific fork tests.

## Governance and emergency controls

Risk-increasing changes require a timelock. Emergency actions in the safe direction may be immediate.

Required controls:

- timelocked new-strategy onboarding;
- timelocked risk-cap changes;
- timelocked allocator rotation;
- immediate strategy kill that stops new allocation;
- deposit pause;
- emergency strategy unwind with minimum-output protection;
- killed strategies remain withdrawable/deallocatable.

## Adversarial acceptance suite

Before an adapter is considered supported, tests MUST cover at least:

- reverting/frozen deposits and withdrawals;
- adapter callback/reentrancy attempts;
- impossible or `uint256.max` NAV reports;
- dishonest liquidity reports;
- real strategy loss after previously reported gain;
- emergency-exit failure preserving accounting state;
- strategy kill while idle vault liquidity remains withdrawable;
- protocol deposit rounding;
- synchronous-liquidity contraction under reserve/vault utilization;
- live protocol deposit/deallocation round trips on a fork where feasible.

The parent vault additionally maintains stateful invariants for:

- `totalAssets == idleAssets + accountedStrategyAssets`;
- idle accounting is physically backed by underlying in the vault;
- aggregate strategy accounting equals the sum of per-strategy accounting;
- `maxWithdraw` never exceeds conservative claim or synchronous liquidity;
- individual and aggregate risk caps remain healthy.

CI currently runs the stateful invariant suite with 512 runs and depth 64.

## Live-protocol validation

The current Ethereum fork suite covers:

- Aave V3 USDC supply, deallocation, and user withdrawal;
- Aave reserve-cash utilization stress after a real supply;
- production Morpho USDC ERC-4626 deposit and withdrawal;
- portfolio withdrawal bounds derived from the Morpho target's live `maxWithdraw`.

The integrated Solidity gate has passed all of the above together with the local unit, adapter, adversarial, compile, and 512-run / 64-depth invariant suites.

CI uses a public Ethereum live-head RPC. This validates current deployed behavior but is not deterministic historical replay. A production release process SHOULD additionally use an authenticated archive RPC and pin known-good Ethereum block numbers for reproducible regression testing.

## Release bar

Passing the Solidity suite means the implementation satisfies the repository's current engineering gates; it is not equivalent to a third-party security audit or a mainnet deployment recommendation.

Before production deployment, Suwappu SHOULD additionally require:

- protocol-specific adapter review;
- pinned archive-fork regression suite;
- static analysis and symbolic/property tooling beyond Foundry fuzzing;
- independent security review;
- deployment configuration review for every live target and cap;
- operational runbooks for strategy kill, liquidity freeze, and loss realization.
