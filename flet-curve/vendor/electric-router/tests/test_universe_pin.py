"""The pool list is the input `--block` does not pin.

It arrives from an API on a five-minute TTL, and its TVL used to weight the
reference-price fit -- so a quote at a pinned block depended on when it was
asked.  Measured at block 25,770,648: eight quotes over thirteen minutes,
identical across two five-minute plateaus and different between them, changing
at exactly the refetch where a pool's TVL moved and not at the one where it did
not.

Two answers to that.  The weights now come from what each pool holds at the
pinned block, so the numbers the solve is built on are block-derived; and the
fingerprint below says which pool *set* was used, since membership is still a
function of the list.
"""

from __future__ import annotations

from erouter.core.pools import Coin, PoolSpec
from erouter.dev.universe import UniverseLoad


def pool(address: str) -> PoolSpec:
    return PoolSpec(
        address=address, name="p", pool_type="main",
        coins=(Coin("0x" + "11" * 20, "A", 18, 0), Coin("0x" + "22" * 20, "B", 18, 1)),
        tvl_usd=1e6,
    )


def test_the_fingerprint_names_the_pool_set():
    one = UniverseLoad([pool("0x" + "aa" * 20), pool("0x" + "bb" * 20)], "cache")
    same = UniverseLoad([pool("0x" + "bb" * 20), pool("0x" + "aa" * 20)], "api")
    other = UniverseLoad([pool("0x" + "aa" * 20), pool("0x" + "cc" * 20)], "cache")

    assert one.fingerprint == same.fingerprint, "order must not matter"
    assert one.fingerprint != other.fingerprint, "membership must"
    assert len(one.fingerprint) == 8


def test_the_fingerprint_ignores_address_case():
    lower = UniverseLoad([pool("0x" + "ab" * 20)], "cache")
    upper = UniverseLoad([pool("0x" + "AB" * 20)], "cache")
    assert lower.fingerprint == upper.fingerprint


def test_a_pool_leaving_changes_it():
    """Membership is the channel `--pin-universe` exists to hold still."""
    full = UniverseLoad([pool("0x" + f"{k:02x}" * 20) for k in range(5)], "cache")
    minus = UniverseLoad(full.pools[:-1], "cache")
    assert full.fingerprint != minus.fingerprint
