"""What the exact models answer without asking the chain."""


def test_a_one_to_one_leg_is_walked_rather_than_sent():
    """WRAP_NATIVE, UNWRAP_NATIVE and STAKE_NATIVE return dx in RouteQuoter.vy
    with no call.  Without a model each was a hole, and one hole sends the whole
    route to the chain -- on gnosis, where WXDAI is the wrapped native, that was
    2 of 14 candidates and a 172 ms confirmation on every quote."""
    from erouter.chain.exact_probe import ExactQuoterClient
    from erouter.core.types import ArcKind

    client = ExactQuoterClient.__new__(ExactQuoterClient)
    for kind in (ArcKind.WRAP_NATIVE, ArcKind.UNWRAP_NATIVE, ArcKind.STAKE_NATIVE):
        model = client._resolve_model("0x" + "aa" * 20, kind, 0, 0)
        assert model is not None, f"{kind.name} still has no model"
        assert model.get_dy(0, 0, 12345) == 12345
