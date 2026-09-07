"""Every chain's declared native wrapper, checked against that chain.

`Chain.wraps_native` says the gas token and `Chain.wrapped` are one node.  That
is an assertion about a contract, and getting it wrong mints value or emits a
leg that reverts -- the R5 hazard, in the shape a native wrapper takes.  It
cannot be probed cheaply at build time: Arbitrum's WETH reverts on a zero-value
`deposit()` and is a real wrapper, while Fraxtal's `0xFC00..06` answers the
whole ERC20 surface and is not one.  So the table declares it and this checks
the declaration.

Two properties, and each catches a different wrong entry:

* **`deposit()` and `withdraw(uint256)` are in the code.**  Fraxtal's is an
  `OptimismMintableERC20` for L1 frxETH with neither, so a `WRAP_NATIVE` leg
  would revert.  Celo's `wrapped` is CELO's own ERC20 face, likewise.
* **It holds at least one native unit per unit of supply.**  A wrapper short of
  its own supply cannot pay the unwrap side, and merging would price a claim
  above what redeems it.  A surplus is fine and is not rare -- etherlink's WXTZ
  runs 22% over, which is over-collateralisation, not a discount.

Every chain in the table is checked, not only the ones with pools today: a
wrapper goes wrong long before a pool arrives on it.
"""

from __future__ import annotations

import pytest

from erouter.chain import chains as chain_table
from erouter.core.keccak import keccak256
from erouter.dev import config

pytestmark = pytest.mark.forked

CHAINS = sorted(chain_table.CHAINS)


@pytest.fixture(scope="module")
def probe():
    if not config.have_networks():
        pytest.skip("networks.py not configured")

    from erouter.dev.rpc import JsonRpcTransport, RpcError

    def read(name):
        chain = chain_table.CHAINS[name]
        try:
            rpc = JsonRpcTransport(config.rpc_url(chain.rpc_attr),
                                   chain_id=chain.chain_id)
            block = hex(int(rpc.fetch("eth_blockNumber", []), 16) - 3)
        except (RpcError, AttributeError, OSError) as exc:
            pytest.skip(f"{name} unreachable: {str(exc)[:60]}")
        wrapped = chain.wrapped.lower()
        code = bytes.fromhex(rpc.fetch("eth_getCode", [wrapped, block])[2:])
        # A proxy keeps the selectors in its implementation, so look there.
        slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
        impl = rpc.fetch("eth_getStorageAt", [wrapped, slot, block])
        if int(impl, 16):
            code = bytes.fromhex(
                rpc.fetch("eth_getCode", ["0x" + impl[-40:], block])[2:])
        held = int(rpc.fetch("eth_getBalance", [wrapped, block]), 16)
        supply = int(rpc.fetch("eth_call", [
            {"to": wrapped, "data": "0x" + keccak256(b"totalSupply()")[:4].hex()},
            block]), 16)
        return chain, code, held, supply

    return read


@pytest.mark.parametrize("name", CHAINS)
def test_a_merged_wrapper_can_be_wrapped_and_unwrapped(name, probe):
    chain, code, _held, _supply = probe(name)
    if not chain.wraps_native:
        return
    for sig in (b"deposit()", b"withdraw(uint256)"):
        assert keccak256(sig)[:4] in code, (
            f"{name}: {chain.wrapped} is merged with {chain.native_symbol} but "
            f"has no {sig.decode()} -- a WRAP_NATIVE leg would revert")


@pytest.mark.parametrize("name", CHAINS)
def test_a_merged_wrapper_is_solvent(name, probe):
    chain, _code, held, supply = probe(name)
    if not chain.wraps_native:
        return
    if supply == 0:
        pytest.skip(f"{name}: no supply to check against")
    assert held >= supply, (
        f"{name}: W{chain.native_symbol} holds {held:,} against a supply of "
        f"{supply:,} -- short {supply - held:,} wei, so the unwrap side cannot "
        f"pay and the merge prices a claim above what redeems it")


@pytest.mark.parametrize("name", CHAINS)
def test_a_refused_wrapper_really_is_one(name, probe):
    """The declaration in the other direction, so `wraps_native=False` cannot
    quietly outlive the reason for it and keep a chain's gas token unroutable."""
    chain, code, held, supply = probe(name)
    if chain.wraps_native:
        return
    wraps = all(keccak256(s)[:4] in code for s in (b"deposit()", b"withdraw(uint256)"))
    assert not (wraps and supply and held >= supply), (
        f"{name}: {chain.wrapped} takes deposit/withdraw and holds {held:,} "
        f"against {supply:,} -- it looks like a real wrapper now, so "
        f"wraps_native=False is costing {chain.native_symbol} its node")
