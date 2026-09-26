"""Gnosis's USDC transmuter: a 1:1 adapter that mints one way and pays the other.

`USDCTransmuter` at `0x0392A2...52B2` takes the omnibridge USDC and **mints**
Circle's USDC.e against it, and burns USDC.e to pay omnibridge USDC back out of
a reserve it holds.  So the two directions are bounded by different things --
a mint allowance one way, a token balance the other -- and reading the empty
side as "no capacity" understated the mint direction sevenfold.
"""

from __future__ import annotations

from erouter.chain.wrappers import build_transmuter_arcs
from erouter.core.transport import Answer, Status

USDC = "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83"    # omnibridge
USDCE = "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0"   # Circle standard
ADAPTER = "0x0392a2f5ac47388945d8c84212469f545fae52b2"


def _word(value: int) -> Answer:
    return Answer(Status.VALUE, value.to_bytes(32, "big"))


REVERT = Answer(Status.REVERTED)


class _Nodes:
    def __init__(self, decimals=6):
        self._decimals = decimals

    def has(self, token):
        return token.lower() in (USDC, USDCE)

    def node(self, token):
        return 0 if token.lower() == USDC else 1

    def decimals(self, token):
        return 6 if token.lower() == USDC else self._decimals

    def symbol(self, token):
        return "USDC" if token.lower() == USDC else "USDC.e"


class _Chain:
    transmuters = ((USDC, USDCE, ADAPTER),)


class _Client:
    """Answers the six reads the builder makes, in order, per entry."""

    def __init__(self, *, usdc_held, usdce_held, usdce_allowance,
                 usdce_is_minter=True):
        self.answers = [
            # token_a == USDC: never a minter, it is the bridged token
            _word(usdc_held), REVERT, REVERT,
            # token_b == USDC.e: Circle's FiatToken, the adapter is a minter
            _word(usdce_held),
            _word(int(usdce_is_minter)),
            _word(usdce_allowance),
        ]

    def raw(self, batch):
        assert len(batch) == len(self.answers), "the builder changed its reads"
        return self.answers


def _arcs(**kw):
    got = build_transmuter_arcs(_Nodes(), _Chain(), _Client(**kw))
    return {(a.token_in.lower(), a.token_out.lower()): a for a in got}


LIVE = {"usdc_held": 10_332_754_020_000, "usdce_held": 0,
            "usdce_allowance": 77_477_341_960_000}


def test_the_mint_direction_is_capped_by_the_allowance_not_the_reserve():
    arc = _arcs(**LIVE)[(USDC, USDCE)]
    assert arc.cap == 77_477_341.96
    assert arc.a == 1.0 and arc.B == 0.0 and arc.clamped


def test_the_redeem_direction_is_capped_by_what_the_adapter_holds():
    arc = _arcs(**LIVE)[(USDCE, USDC)]
    assert arc.cap == 10_332_754.02


def test_both_directions_exist():
    """It converts both ways; only the ceiling differs."""
    assert set(_arcs(**LIVE)) == {(USDC, USDCE), (USDCE, USDC)}


def test_a_revoked_allowance_falls_back_rather_than_inventing_capacity():
    """No reserve and no mint right must not read as unbounded."""
    arcs = _arcs(usdc_held=10_332_754_020_000, usdce_held=0,
                 usdce_allowance=0, usdce_is_minter=False)
    assert arcs[(USDC, USDCE)].cap == 10_332_754.02, "the opposite reserve"


def test_a_non_minter_with_a_reserve_is_capped_by_that_reserve():
    arcs = _arcs(usdc_held=1_000_000_000, usdce_held=4_000_000_000,
                 usdce_allowance=0, usdce_is_minter=False)
    assert arcs[(USDC, USDCE)].cap == 4_000.0
    assert arcs[(USDCE, USDC)].cap == 1_000.0


def test_the_cap_uses_the_decimals_of_the_token_it_counts():
    """`reserve` is an amount of the *output* token, so it scales by its
    decimals -- not the input's.  Equal at 6/6 on Gnosis, wrong the moment a
    transmuter spans two decimalities."""
    got = build_transmuter_arcs(
        _Nodes(decimals=18), _Chain(),
        _Client(usdc_held=10**6, usdce_held=5 * 10**18, usdce_allowance=0,
                usdce_is_minter=False))
    arcs = {(a.token_in.lower(), a.token_out.lower()): a for a in got}
    assert arcs[(USDC, USDCE)].cap == 5.0, "output side is 18 decimals"
    assert arcs[(USDCE, USDC)].cap == 1.0, "output side is 6 decimals"
