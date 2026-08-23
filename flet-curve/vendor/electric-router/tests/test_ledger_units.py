"""The loss ledger has to measure the caller's tokens, not the node's.

`price_out_per_in` is a ratio between *nodes*, so it prices the output in the
destination node's canonical token.  When the caller asked for a merged token
instead -- sDOLA rather than DOLA -- comparing the delivered sDOLA against a
DOLA ideal reports the vault's premium as loss.  It is a loss that does not
move with the size of the trade, which is what gave it away: 2,909 bp on
crvUSD -> sDOLA at both $100 and $2,000,000.
"""

from __future__ import annotations

import pytest

from erouter.core.nodes import Conversion, ConversionKind, NodeMap
from erouter.dev.cli import _ledger

DOLA = "0x865377367054516e17014ccded1e7d814edc9ce4"
SDOLA = "0xb45ad160634c528cc3d2926d9807104fa3157305"
CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"

#: sDOLA was worth this many DOLA at block 25,797,550.
RATE_NUM, RATE_DEN = 141028173, 10**8


class _Route:
    def __init__(self, modelled_out: int):
        self.modelled_out = modelled_out


class _Result:
    def __init__(self, modelled_out: int, verified_out: int):
        self.route = _Route(modelled_out)
        self.verified_out = verified_out
        self.fee_bp = 0.0
        self.impact_bp = 0.0
        self.price_impact_bp = None
        self.impact_fraction = 0.0
        #: A frictionless crvUSD -> DOLA, node to node.
        self.price_out_per_in = 1.0


def _nodes() -> NodeMap:
    nodes = NodeMap()
    nodes.add_token(CRVUSD, "crvUSD", 18)
    nodes.add_token(DOLA, "DOLA", 18)
    nodes.add_token(SDOLA, "sDOLA", 18)
    nodes.merge(
        Conversion(ConversionKind.ERC4626, SDOLA, DOLA, RATE_NUM, RATE_DEN,
                   target=SDOLA)
    )
    return nodes


def test_a_merged_destination_does_not_book_its_premium_as_loss():
    """A perfect trade into sDOLA must read as zero loss, not 2,909 bp."""
    nodes = _nodes()
    amount_in = 2_000_000.0
    # Frictionless: every crvUSD becomes a DOLA, then buys sDOLA at the rate.
    perfect = amount_in * RATE_DEN / RATE_NUM
    ledger = _ledger(
        _Result(int(perfect * 10**18), int(perfect * 10**18)),
        nodes, CRVUSD, SDOLA, amount_in, perfect,
    )
    assert ledger["total_bp"] == pytest.approx(0.0, abs=1e-6)
    assert ledger["verified_bp"] == pytest.approx(0.0, abs=1e-6)


def test_a_real_loss_into_a_merged_destination_still_reads():
    """The premium goes; the 50 bp actually lost stays."""
    nodes = _nodes()
    amount_in = 2_000_000.0
    perfect = amount_in * RATE_DEN / RATE_NUM
    delivered = perfect * (1 - 50e-4)
    ledger = _ledger(
        _Result(int(delivered * 10**18), int(delivered * 10**18)),
        nodes, CRVUSD, SDOLA, amount_in, delivered,
    )
    assert ledger["total_bp"] == pytest.approx(50.0, abs=1e-3)


def test_an_unmerged_destination_is_untouched():
    """Nothing changes where both ends are their node's canonical token."""
    nodes = _nodes()
    ledger = _ledger(
        _Result(995 * 10**18, 995 * 10**18), nodes, CRVUSD, DOLA, 1000.0, 995.0
    )
    assert ledger["total_bp"] == pytest.approx(50.0, abs=1e-3)
