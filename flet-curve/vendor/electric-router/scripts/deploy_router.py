#!/usr/bin/env python3
"""Deploy ElectricRouter.vy, the contract that executes a route on chain.

The quoter answers questions; this one moves money.  Everything the repo
measures -- the per-leg minimum rates, the fraction encoding, the native-ETH
paths -- is executed by this contract, and until it has an address the encoder
is producing calldata for nowhere.  `core.schema.ROUTER_ADDRESS` is empty on
purpose: a wrong address there is a burnt transaction.

CREATE2 through the deterministic proxy, so it lands on the same address on
every chain.  That matters more here than for the quoter: an integrator
hardcodes a router, and one address across fourteen chains is one thing to
audit rather than fourteen.

Dry-runs on a fork by default; `--broadcast` sends it for real.

    python scripts/deploy_router.py --chain ethereum --create2
    python scripts/deploy_router.py --chain all --create2 --funding
    python scripts/deploy_router.py --chain all --create2 --broadcast --verify
    python scripts/deploy_router.py --chain all --verify-only

The deployer key is a brownie keystore under `~/.brownie/accounts/`, decoded
with a passphrase at the prompt.  Everything not specific to the router lives
in `dev/deploy.py`, shared with `deploy_quoter.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

CONTRACT = REPO / "contracts" / "ElectricRouter.vy"
SALT_PHRASE = "erouter.ElectricRouter.v2"
#: A thousandth of the pool's reserve: small enough not to move it, far enough
#: above dust that the output is a number rather than a rounding artifact.
SANITY_SHARE = 1e-4


def _sanity_legs(chain, limit: int = 8):
    """Candidate swaps, deepest pool first.

    A router check has to *trade*, not quote, so the input token has to be one
    a fork can be funded with -- and the deepest pool's is not always.  Polygon
    and avalanche lead with Curve's Aave pools, whose aTokens belong to Aave
    versions Aave has since killed: nothing mints them any more, so they cannot
    be conjured on a fork either.  Monad leads with AUSD, which defeats the
    balance-slot search for its own reasons.  Stopping at the first of those
    reported a working deployment as broken on three chains of fifteen.
    """
    from erouter.dev.universe import load_pools

    load = load_pools(chain, min_tvl=1_000.0)
    offered = 0
    for pool in sorted(load.pools, key=lambda p: -p.tvl_usd):
        if pool.swap_kind is None:
            continue
        for i, j in pool.swap_pairs():
            # Reserves come back as zeros on a chain with no quoter deployed
            # yet, which is exactly the case this script exists for, so fall
            # back to the token's own decimals.
            if i < len(pool.balances) and pool.balances[i] > 0:
                dx = max(int(pool.balances[i] * SANITY_SHARE), 1)
            else:
                dx = max(10 ** max(pool.coins[i].decimals - 3, 0), 1)
            yield load.pools, pool, i, j, dx
            offered += 1
            break                    # one pair per pool is enough to try
        if offered >= limit:
            return
    if not offered:
        raise SystemExit(f"no tradeable pool on {chain.name} to sanity-check against")


def _one_leg_call(pool, i: int, j: int, dx: int, receiver: str, min_rate: int = 0):
    """A route of exactly one swap, built without the solver.

    The solver is not the thing under test here and needs a warmed universe to
    run; the contract is, and it only needs to be handed a leg.
    """
    from erouter.core.routecall import RouteCall, Step

    step = Step(pool=pool.address, kind=pool.swap_kind, i=i, j=j,
                n=pool.n_coins, min_rate=min_rate)
    return RouteCall(
        amount_in=dx, pools=(pool.address,), params=(step.pack(),),
        receiver=receiver, token_in=pool.coins[i].address,
        token_out=pool.coins[j].address,
    )


def check(address: str, chain, url: str, args, *, on_fork: bool) -> int:
    """Execute a real swap through the deployed address.

    Bytecode matching says the right code is there; this says it works.  Run on
    a fork either way -- after a broadcast the fork picks up the deployment
    from chain state, so the address under test is the real one and the trade
    costs nothing.

    Two runs, because a router that executes is only half the claim.  The
    second asks for twice the rate the first achieved and must revert: that is
    the per-leg bound, and a deployment where it does not fire would take every
    route in this repo and drop the protection silently.

    Candidates are tried until one trades.  What a chain's deepest pool does is
    the chain's business -- avalanche's reverts, polygon's holds a token Aave
    stopped minting -- and neither is evidence about the bytecode just deployed.
    """
    import boa

    from erouter.dev.cli import _token_holders
    from erouter.dev.deploy import fork_at_head
    from erouter.dev.router import CONTRACT as SOURCE
    from erouter.dev.router import send

    if args.broadcast:
        # Holding the router: a fork five blocks back predates a deployment
        # mined seconds ago, and every call to it would answer `0x`.
        fork_at_head(url, chain.chain_id, holding=address)
    router = boa.loads_partial(SOURCE.read_text()).at(address)
    who = boa.env.generate_address()

    chosen = None
    skipped: list[str] = []
    for pools, pool, i, j, dx in _sanity_legs(chain):
        holders = _token_holders(pools, pool.coins[i].address, avoid=[pool.address])
        label = (f"{dx / 10 ** pool.coins[i].decimals:,.6f} {pool.coins[i].symbol} -> "
                 f"{pool.coins[j].symbol} on {pool.name[:24]}")
        report = send(_one_leg_call(pool, i, j, dx, who), router=router,
                      wrapped=chain.wrapped, holders=holders)
        if report.ok:
            chosen = (pool, i, j, dx, holders, label, report)
            break
        # Neither a token nothing can mint nor a pool that refuses the trade
        # says anything about the router: both belong to the chain, and one
        # pool that trades is the whole claim.  Named rather than counted,
        # because a pool that reverts is worth chasing on its own.
        why = ("nothing can mint it" if "cannot fund" in report.error
               else f"reverted, {report.error[:34]}")
        skipped.append(f"{pool.coins[i].symbol} on {pool.name[:18]} -- {why}")

    if chosen is None:
        print(f"\n  ! nothing on {chain.name} could be traded through, so this")
        print("    deployment is unproven rather than known bad:")
        for line in skipped:
            print(f"      {line}")
        return 1
    pool, i, j, dx, holders, label, report = chosen
    print(f"\n  sanity {label}")
    for line in skipped:
        print(f"    skipped    {line}")
    out = report.amount_out
    print(f"    executed   {out / 10 ** pool.coins[j].decimals:,.6f} "
          f"{pool.coins[j].symbol}  ({report.gas:,} gas)")
    for line in report.warnings:
        print(f"    note       {line[:70]}")

    # Twice the rate it just achieved cannot be met, so the leg must fail.
    from erouter.core.routecall import ONE

    impossible = 2 * (out * ONE // dx)
    refused = send(_one_leg_call(pool, i, j, dx, who, min_rate=impossible),
                   router=router, wrapped=chain.wrapped, holders=holders)
    if refused.ok:
        print("  ! the minimum-rate check did not fire: this deployment would")
        print("    execute every route in this repo with no per-leg protection")
        return 1
    print(f"    bound      refused at twice the rate ({refused.error[:44]})")
    return 0


def next_steps(address: str) -> None:
    print("\n  next, in order:")
    print(f'   1. src/erouter/core/schema.py: ROUTER_ADDRESS = "{address}"')
    print("   2. docs/router.md: replace the \"not deployed yet\" note with it")
    print("   3. uv run python scripts/fork_execute_routes.py --private")
    print("      -- the sweep against the address integrators will use")


def main() -> int:
    from erouter.dev.deploy import Target, run

    return run(
        Target(label="router", contract=CONTRACT, salt_phrase=SALT_PHRASE,
               check=check, next_steps=next_steps),
        __doc__,
    )


if __name__ == "__main__":
    raise SystemExit(main())
