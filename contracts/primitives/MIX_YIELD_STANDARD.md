# Suwappu Mix-Yield Primitive Standard

Status: implementation target for `claude/suwappu-1-core-primitives-lxb8kh`.

## Why this exists

The current primitives are useful single-purpose building blocks (`SuwappuTimeCurve`, `SuwappuAmortizingVault`, `SuwappuMutualCredit`), but the yield surface needs a portfolio primitive rather than another single-strategy wrapper. The target is the useful product standard demonstrated by Alchemix MYT: one liquid share token, multiple independently risk-classified strategies, explicit allocation caps, continuously compounding NAV, and redeemability without requiring the holder to manage strategy positions.

This is a design standard, not an assertion of compatibility with Alchemix or Morpho.

## Required user semantics

A Suwappu Mix-Yield Vault MUST:

1. accept exactly one base asset per vault;
2. issue fungible ERC-4626-compatible shares representing a pro-rata claim on idle assets plus strategy assets;
3. make yield accrue through share price / `convertToAssets`, not rebasing share balances;
4. support permissionless deposits and withdrawals subject only to available/realizable liquidity and explicit strategy withdrawal constraints;
5. expose live strategy composition, target allocation, current allocation, risk tier, cap, liquidity state, and last valuation timestamp on-chain;
6. never advertise an APY as guaranteed; realized NAV is the accounting source of truth;
7. treat strategy loss as NAV loss rather than hiding it behind stale accounting;
8. use conservative realizable-value accounting where fees, slippage, withdrawal penalties, or delayed liquidity exist.

## Strategy risk model

Every strategy is classified before activation from four dimensions:

- **Entry/exit:** direct contract path vs DEX/auction dependency.
- **Valuation:** fundamental backing/share accounting vs external market/oracle price.
- **Liquidity:** immediate, bounded delay, or materially lockable.
- **Additional risk:** maturity, complexity, governance/admin surface, bridge/cross-chain dependency, and operational confidence.

Tiers are monotonic: an additional risk factor may raise risk, never lower it.

| Tier | Max single strategy | Max aggregate tier |
| --- | ---: | ---: |
| Conservative | 100% | 100% |
| Moderate | 25% | 40% |
| Aggressive | 10% | 10% |

These are protocol ceilings, not target allocations. Governance MAY set stricter vault-specific caps but MUST NOT loosen these ceilings without a versioned protocol upgrade/governance action with delay.

Before allocation, enforce both:

`postStrategyAssets / postTotalAssets <= individualCap`

and

`postTierAssets / postTotalAssets <= aggregateTierCap`.

Use conservative rounding so a rounding edge cannot place the vault above a cap.

## Adapter contract

Strategies MUST sit behind a narrow adapter boundary. The vault must not encode protocol-specific behavior.

```solidity
interface ISuwappuYieldStrategy {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);       // conservative NAV
    function maxWithdraw() external view returns (uint256);      // realizable now
    function deposit(uint256 assets) external returns (uint256 deployed);
    function withdraw(uint256 assets, address receiver)
        external returns (uint256 received);
}
```

Adapters MUST account for exit fees/penalties in `totalAssets` when those costs are unavoidable to realize value. Incentive/reward tokens MUST be either (a) harvested and converted to the base asset, (b) conservatively valued and explicitly included, or (c) excluded from NAV. They must never become untracked value silently stranded in an adapter.

## Allocation and rebalancing

The allocator is a constrained portfolio controller, not an unrestricted multisig transfer function.

Each active strategy stores:

- adapter address;
- risk tier;
- target weight;
- individual cap;
- enabled/disabled state;
- last reported NAV;
- last valuation timestamp.

Rebalances MUST validate aggregate target weights and risk caps before moving funds. A rebalance MUST be atomic with respect to cap checks: if the resulting state violates a ceiling, revert.

Forced deallocation must have an explicit cost/griefing policy. A caller must not be able to repeatedly force expensive strategy exits for free. The implementation should use either allocator-only deallocation, a configurable penalty/bond, or a permissionless keeper path whose execution is bounded by governance-defined economics.

## Share-price safety

External strategy bugs and donation/accounting shocks can create discontinuous NAV jumps. The production vault MUST have a configurable maximum positive share-price growth rate used as a circuit breaker for accounting/borrowing integrations. A positive jump beyond the bound must not silently increase borrow power.

Negative NAV changes MUST NOT be rate-limited away: losses need to surface.

The implementation should distinguish:

- `rawTotalAssets`: best current strategy accounting;
- `accountedTotalAssets`: value admitted by the share-price guard for integrations;
- `liquidAssets`: value realizable within the configured withdrawal horizon.

Deposits/withdrawals must use one documented accounting convention consistently; lending/LTV integrations should consume guarded/conservative value.

## Governance safety

Production configuration changes MUST be delayed. At minimum, adding/replacing adapters, increasing caps, changing risk tiers downward, changing share-price guards, changing allocator authority, and changing forced-deallocation economics require a timelock.

Emergency actions may disable new deposits/allocation to a strategy immediately, but emergency authority MUST NOT be able to confiscate user shares or arbitrarily rewrite NAV.

Risk-tier upgrades (more risky) may be immediate for safety accounting; risk-tier downgrades require delay.

## Withdrawal behavior

`maxWithdraw`/`maxRedeem` must reflect realizable liquidity, not theoretical NAV. Withdrawal routing should consume idle assets first and then strategies in a deterministic governance-configured withdrawal queue.

If full liquidity is not immediately realizable, the vault must not lie by returning an optimistic `maxWithdraw`. A future async extension may use ERC-7540-style requests, but synchronous ERC-4626 methods must remain truthful.

## Observability

Emit events for strategy add/remove, risk-tier change, cap change, target change, allocation/deallocation, harvest, realized loss, share-price circuit-breaker activation, and governance queue/execute actions.

Expose a single composition view suitable for SuwappuBot/Terminal so users and agents can answer: where is my asset, how risky is each component, how much is liquid now, and what changed?

## Integration with existing Suwappu primitives

`SuwappuAmortizingVault` should consume Mix-Yield shares as collateral only through guarded/conservative valuation. Yield can amortize debt, but debt accounting must not assume a monotonically increasing strategy NAV.

`SuwappuMutualCredit` must not treat an unguarded Mix-Yield share price as risk-free collateral.

`SuwappuTimeCurve` remains orthogonal; do not mix bonding-curve reserve solvency with portfolio-yield accounting.

## Acceptance gates

The implementation is not mainnet-ready until all of the following hold:

- ERC-4626 property tests for deposit/mint/withdraw/redeem and rounding direction;
- invariant: shares cannot claim more than conservatively accounted assets;
- invariant: every post-rebalance allocation satisfies individual and aggregate tier caps;
- invariant: disabled strategies receive no new allocation;
- invariant: reported synchronous liquidity never exceeds realizable liquidity;
- loss tests, donation tests, stale valuation tests, fee-on-exit tests, reward-token tests;
- malicious/reentrant adapter tests;
- allocator griefing/forced-deallocation tests;
- share-price spike/circuit-breaker tests;
- governance/timelock tests;
- fuzzed multi-strategy withdrawal-order tests;
- fork tests against every production adapter;
- independent security review before mainnet deposits.

## Product surface

SuwappuBot and the Terminal should display the vault as one position but make composition inspectable: base asset, share price, realized trailing yield, current strategies and weights, tier/cap utilization, immediately withdrawable amount, and any active safety guard. Do not collapse these into a single APY number.
