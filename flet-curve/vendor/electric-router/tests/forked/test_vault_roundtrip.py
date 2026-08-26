"""The R5 gate: every merged vault must survive an executed round trip.

A node merge asserts that two tokens are the same thing at a fixed rate, in
*both* directions.  Nothing readable from a `view` function establishes that.
`convertToAssets` linearity, `maxDeposit`, `totalAssets` -- sUSDe and pufETH
pass all of them, and both are traps: sUSDe redemption needs a seven-day
cooldown, pufETH's is a withdrawal queue.  Merging either would declare it
equal to its asset at NAV and mint the market discount out of nothing.

The only check that sees a cooldown is doing it.  This deals the asset,
deposits, and redeems, on a fork, inside `anchor()`.
"""

from __future__ import annotations

import boa
import pytest

from erouter.chain import chains as chain_table

pytestmark = pytest.mark.forked

ERC20_ABI = """[
 {"name":"approve","inputs":[{"name":"s","type":"address"},{"name":"a","type":"uint256"}],
  "outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
 {"name":"balanceOf","inputs":[{"name":"o","type":"address"}],
  "outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
 {"name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8"}],
  "stateMutability":"view","type":"function"},
 {"name":"totalSupply","inputs":[],"outputs":[{"name":"","type":"uint256"}],
  "stateMutability":"view","type":"function"}]"""

VAULT_ABI = """[
 {"name":"asset","inputs":[],"outputs":[{"name":"","type":"address"}],
  "stateMutability":"view","type":"function"},
 {"name":"deposit","inputs":[{"name":"assets","type":"uint256"},{"name":"receiver","type":"address"}],
  "outputs":[{"name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
 {"name":"redeem","inputs":[{"name":"shares","type":"uint256"},{"name":"receiver","type":"address"},
  {"name":"owner","type":"address"}],"outputs":[{"name":"","type":"uint256"}],
  "stateMutability":"nonpayable","type":"function"}]"""

# Round-tripping 1,000 units is far above dust and far below any vault's depth,
# so a loss here is a property of the vault rather than of the size.
UNITS = 1_000
# stETH-style share arithmetic loses a wei or two to integer division; anything
# beyond that is a fee or a haircut, and neither may be hidden inside a merge.
TOLERANCE_WEI = 4


@pytest.fixture(scope="module")
def node_map(pools, quoter_client, chain):
    from erouter.chain.wrappers import build_node_map
    from erouter.core.pools import parse_universe
    from erouter.dev.universe import read_balances, resolve_dialects

    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    nodes, _ = build_node_map(specs, chain, quoter_client)
    return nodes


@pytest.fixture(scope="module")
def forked_env(rpc):
    # `allow_dirty` because another forked test may have deployed into boa's
    # global env first; we re-fork to a pinned block and every round trip runs
    # inside `anchor()`, so whatever was there is discarded either way.
    boa.fork(rpc.pin.url, block_identifier=rpc.block, allow_dirty=True)
    return boa.env


@pytest.mark.parametrize(
    "vault", chain_table.get("ethereum").erc4626_allowlist, ids=lambda v: v[:10]
)
def test_allowlisted_vault_round_trips(forked_env, vault):
    """deposit -> redeem returns what went in, to within a couple of wei."""
    v = boa.loads_abi(VAULT_ABI).at(vault)
    asset = boa.loads_abi(ERC20_ABI).at(v.asset())
    amount = UNITS * 10 ** asset.decimals()

    with boa.env.anchor():
        who = boa.env.generate_address()
        boa.env.set_balance(who, 10**20)
        boa.deal(asset, who, amount * 2)
        with boa.env.prank(who):
            asset.approve(vault, 2**256 - 1)
            shares = v.deposit(amount, who)
            assert shares > 0, "deposit minted nothing"
            # The half that matters.  A cooldown or a queue reverts here, and
            # that is the whole reason this test executes rather than reads.
            returned = v.redeem(shares, who, who)

    assert returned >= amount - TOLERANCE_WEI, (
        f"round trip lost {amount - returned} wei of {UNITS} units: this vault "
        "charges to leave and must not be a zero-resistance node merge"
    )


@pytest.mark.parametrize(
    "vault", chain_table.get("ethereum").oneway_vaults, ids=lambda v: v[:10]
)
def test_oneway_vault_is_not_merged(node_map, vault):
    """The traps must stay arcs, never merges.

    Guards the direction the allowlist can silently drift in: someone sees
    sUSDe pass `convertToAssets` linearity and adds it.  Its deposit is a
    perfectly good one-way arc; its redemption is not.
    """
    nodes = node_map
    if not nodes.has(vault.lower()):
        pytest.skip(f"{vault[:10]} not in the universe at this TVL floor")
    conversion = getattr(nodes, "conversion", {})
    assert vault.lower() not in conversion, (
        f"{vault[:10]} is merged; its redemption is gated, so a merge lets the "
        "router exit at NAV instantly when it cannot"
    )
