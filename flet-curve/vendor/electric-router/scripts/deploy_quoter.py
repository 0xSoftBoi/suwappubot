#!/usr/bin/env python3
"""Deploy RouteQuoter.vy, so quoting stops shipping the contract with it.

Until it is deployed, every quote goes out as an `eth_call` with the runtime
bytecode attached as a state override.  That works and needs no transaction --
which is why development runs that way -- but it puts 7,486 bytes on the wire on
*every* call: measured on a cold USDC->WETH route over a 129 ms link, 14 round
trips, 1.54 MB sent, of which 0.21 MB (14%) was the contract.

Deploying also takes boa out of the request path entirely.  `core/quoter.py`
already builds calldata for "a RouteQuoter at this address", so once one exists
the browser build needs nothing but `eth_call` -- no compiler, no state-override
support, no boa.  That is the §Portability seam, and this script opens it.

Dry-runs on a fork by default; `--broadcast` sends it for real.

    python scripts/deploy_quoter.py --chain ethereum
    python scripts/deploy_quoter.py --chain ethereum --broadcast --verify
    python scripts/deploy_quoter.py --chain all --verify-only

The deployer key is a brownie keystore under `~/.brownie/accounts/`, decoded
with a passphrase at the prompt -- the same arrangement yb-core's scripts use.
Everything not specific to the quoter lives in `dev/deploy.py`, shared with
`deploy_router.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

CONTRACT = REPO / "contracts" / "RouteQuoter.vy"
SALT_PHRASE = "erouter.RouteQuoter.v2"
# A pool and a swap that every mainnet fork can answer, used to prove the
# deployed contract behaves identically to the one we have been overriding.
SANITY_POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"  # 3pool
SANITY_DX = 1_000 * 10**6  # 1,000 USDC
# The kinds a redeployment is usually *for*: whatever the deployed contract
# could not price is exactly what nobody notices is missing, because an
# unknown kind comes back REVERTED and the router quietly routes around it.
SANITY_CDAI = "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643"
SANITY_CDAI_DX = 100_000 * 10**8


def _sanity_probe(chain):
    """A pool on *this* chain that the deployment can be checked against.

    Mainnet's 3pool was hardcoded, which is no test at all anywhere else: the
    address has no code, the quote returns zero, and a working deployment would
    look broken.  The deepest pool in the chain's own universe is the honest
    choice -- the one a first route is most likely to touch.
    """
    from erouter.core.types import ArcKind, Probe
    from erouter.dev.universe import load_pools

    if chain.name == "ethereum":
        return ([Probe(SANITY_POOL, ArcKind.SWAP_STABLE, 1, 2, 3, SANITY_DX)],
                "1,000 USDC -> USDT on 3pool")
    load = load_pools(chain, min_tvl=1_000.0)
    for pool in sorted(load.pools, key=lambda p: -p.tvl_usd):
        if pool.swap_kind is None:
            continue
        for i, j in pool.swap_pairs():
            # Size from reserves where they are known, and from decimals where
            # they are not -- on the chains this script exists for, reserves
            # come back as zeros, since reading them needs the quoter deployed
            # here.  A thousandth of a token serves any pool above $1,000
            # without rounding to nothing.
            if i < len(pool.balances) and pool.balances[i] > 0:
                dx = max(int(pool.balances[i] * 1e-4), 1)
                note = "1e-4 of reserve"
            else:
                dx = max(10 ** max(pool.coins[i].decimals - 3, 0), 1)
                note = "0.001 token"
            return ([Probe(pool.address, pool.swap_kind, i, j,
                           pool.n_coins, dx)],
                    f"{pool.name[:28]} {i}>{j} at {note}")
    raise SystemExit(f"no quotable pool on {chain.name} to sanity-check against")


def check(address: str, chain, url: str, args, *, on_fork: bool) -> int:
    """Does it answer?  Compared against the override path on the same block,
    because "deployed" and "usable" are different claims."""
    if on_fork:
        return 0

    from erouter.core.quoter import QuoterClient
    from erouter.core.types import ArcKind, Probe
    from erouter.dev.boa_host import override_client
    from erouter.dev.rpc import JsonRpcTransport

    probe, label = _sanity_probe(chain)
    rpc = JsonRpcTransport(url, chain_id=chain.chain_id)
    deployed = QuoterClient(rpc, address).probe(probe)[0]
    print(f"\n  sanity {label}")
    print(f"    deployed   {deployed.value:,} ({deployed.status.name})")
    if not deployed.ok or deployed.value <= 0:
        print("  ! the deployed quoter cannot price a pool on this chain")
        return 1
    # The override is the reference *where one can be had*.  The chains this
    # deployment is for are exactly the ones that reject state overrides -- tac
    # and etherlink answer HTTP 400 -- so on those there is nothing to compare
    # against and a positive quote is the whole test.
    try:
        overridden = override_client(rpc).probe(probe)[0]
    except Exception as exc:
        print(f"    override   unavailable on this chain ({str(exc)[:40]})")
        overridden = None
    if overridden is not None and overridden.ok:
        print(f"    override   {overridden.value:,} ({overridden.status.name})")
        if deployed.value != overridden.value:
            print("  ! the deployed quoter disagrees with the override; not usable")
            return 1
        print("    agree")

    # Every kind, not just the one that has always worked.  A kind the
    # deployment is missing does not fail loudly: it answers REVERTED, and the
    # router treats that as "this leg cannot be traded" and silently takes a
    # worse route.
    #
    # cDAI is a mainnet address, so this is a mainnet test.  Running it
    # everywhere would fail every other chain *after* broadcasting, which reads
    # as a broken deployment when it is a missing token.
    if chain.name != "ethereum":
        return 0
    lend = [Probe(SANITY_CDAI, ArcKind.LEND_REDEEM, 0, 0, 0, SANITY_CDAI_DX)]
    got = QuoterClient(rpc, address).probe(lend)[0]
    want = override_client(rpc).probe(lend)[0]
    print("\n  sanity 100,000 cDAI -> DAI (LEND_REDEEM)")
    print(f"    deployed   {got.value:,} ({got.status.name})")
    print(f"    override   {want.value:,} ({want.status.name})")
    if got.value != want.value or not got.ok:
        print("  ! the deployed quoter cannot price LEND_REDEEM -- lending")
        print("    arcs would be built and then silently routed around")
        return 1
    print("    agree")
    return 0


def next_steps(address: str) -> None:
    print("\n  next, in order:")
    print(f'   1. src/erouter/dev/chains.py: quoter="{address}"')
    print("   2. erouter warmcache   -- the local EVM reads the quoter's code")
    print("      from data/evm-state, and this address is not in it yet; without")
    print("      this every local quote returns nothing")
    print(f"   3. whitelist {address} on the RPC key, and drop the old one")
    print("   4. erouter route --from cDAI --to DAI --amount 100000")
    print("      -- should now work without --fresh-quoter")


def main() -> int:
    from erouter.dev.boa_host import runtime_bytecode
    from erouter.dev.deploy import Target, run

    return run(
        Target(label="quoter", contract=CONTRACT, salt_phrase=SALT_PHRASE,
               runtime=runtime_bytecode, check=check, next_steps=next_steps),
        __doc__,
    )


if __name__ == "__main__":
    raise SystemExit(main())
