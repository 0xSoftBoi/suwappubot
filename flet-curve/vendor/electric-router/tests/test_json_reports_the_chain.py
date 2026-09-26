"""The JSON must put the chain's number under the plainest name.

`ETH -> ETHx` at 100 ETH is 241% of the pool's own reserve.  The model expected
91.15 ETHx and the chain paid 82.50, and the terminal showed both, labelled.
The JSON showed `amount_out: 91.15` and `loss_bp.total: 24.7` -- the model's
figures, under the two names a caller reaches for first -- with the truth filed
under `verified_out` and the verified *loss* nowhere at all.

On an ordinary trade the two agree to a fraction of a bp, which is why it went
unnoticed: `USDC -> WETH` differs in the sixth digit.  It only shows where the
model is asked for something it was never fitted for, and that is exactly where
a caller most needs the answer to be the real one.
"""

from __future__ import annotations

from typing import ClassVar

from erouter.core.schema import _loss_bp, to_json


class _Result:
    """The fields `to_json` reads, and nothing else."""

    src_token = "0x" + "11" * 20
    dst_token = "0x" + "22" * 20
    amount_in = 100 * 10**18
    fee_bp = 3.8171
    impact_bp = 20.9175
    certificate = True
    certificate_reason = None
    price_impact_bp = None
    impact_fraction = 0.05
    impact_reference_in = 0
    impact_reference_out = 0
    arcs: ClassVar[list] = []
    counters: ClassVar[dict] = {}
    timings: ClassVar[dict] = {}
    warnings: ClassVar[list] = []

    def __init__(self, modelled_out: int):
        self.route = _Route(modelled_out)
        self.nodes = _Nodes()


class _Route:
    legs: ClassVar[list] = []
    paths: ClassVar[list] = []
    potentials: ClassVar[dict] = {}
    slots: ClassVar[dict] = {}

    def __init__(self, modelled_out: int):
        self.modelled_out = modelled_out


class _Nodes:
    tokens_of: ClassVar[dict] = {}

    def decimals(self, _token) -> int:
        return 18

    def symbol(self, _token) -> str:
        return "T"


MODELLED = 91_147_643_149_562_622_995      # what the model expected
VERIFIED = 82_504_042_754_956_296_192      # what the chain paid
LEDGER = {"total_bp": 24.8191, "verified_bp": 970.7731, "model_delta_bp": -945.954}


def test_amount_out_is_what_the_chain_paid():
    payload = to_json(_Result(MODELLED), verified_out=VERIFIED, ledger=LEDGER)
    result = payload["result"]
    assert result["amount_out"] == str(VERIFIED), (
        "a caller reading the obvious field got the model's number, 10% high"
    )
    assert result["modelled_out"] == str(MODELLED)
    assert result["verified_out"] == str(VERIFIED)
    assert result["verified"] is True


def test_amount_out_falls_back_to_the_model_when_nothing_verified():
    payload = to_json(_Result(MODELLED), verified_out=None)
    result = payload["result"]
    assert result["amount_out"] == str(MODELLED)
    assert result["modelled_out"] == str(MODELLED)
    assert result["verified_out"] is None and result["verified"] is False


def test_the_loss_total_is_the_verified_one():
    loss = to_json(_Result(MODELLED), verified_out=VERIFIED,
                   ledger=LEDGER)["result"]["loss_bp"]
    assert loss["total"] == loss["verified_total"] == 970.7731, (
        "loss_bp.total reported 24.7 bp for a trade that cost 970"
    )
    assert loss["modelled_total"] == 24.8191


def test_fee_and_impact_sum_to_the_model_not_to_the_truth():
    """They are the model's decomposition; the chain reports one number."""
    loss = _loss_bp(_Result(MODELLED), LEDGER, 24.7346)
    assert abs(loss["fee"] + loss["impact"] - 24.7346) < 1e-6
    assert loss["modelled_total"] == 24.8191      # the reference-price version
    assert loss["total"] != loss["fee"] + loss["impact"]


def test_a_model_that_understated_the_loss_reads_negative():
    loss = _loss_bp(_Result(MODELLED), LEDGER, 24.7346)
    assert loss["model_delta"] == -945.954, "negative means the model was optimistic"


def test_a_model_that_overstated_the_loss_reads_positive():
    """§3.6's expected sign, so the field is not just always negative."""
    healthy = {"total_bp": 4.17, "verified_bp": 4.09, "model_delta_bp": 0.08}
    loss = _loss_bp(_Result(MODELLED), healthy, 4.17)
    assert loss["model_delta"] == 0.08
    assert loss["total"] == 4.09 and loss["modelled_total"] == 4.17


def test_without_a_ledger_nothing_claims_to_be_verified():
    loss = _loss_bp(_Result(MODELLED), None, 24.7346)
    assert loss["total"] == loss["modelled_total"] == 24.7346
    assert loss["verified_total"] is None and loss["model_delta"] is None
