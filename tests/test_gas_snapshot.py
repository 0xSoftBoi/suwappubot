"""Gas snapshot — a regression guard, not a target.

Measured against the real compiled bytecode on eth-tester. Numbers are ceilings
with headroom; the point is to catch a change that quietly makes minting or
subscribing dramatically more expensive, not to freeze exact values (they shift
with solc versions and OZ upgrades).

Refresh after an intentional change:
    node scripts/build_contract_test_artifacts.js
    python3 -m pytest tests/test_gas_snapshot.py -q
and update the ceilings below with the printed values.
"""

import json
import os

import pytest

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")

PRO, ENTERPRISE = 1, 3
PRO_PRICE = 9_990_000

# Ceilings ~8% above measured, so ordinary compiler drift does not flake the
# suite but a structural regression (an unpacked struct, a write moved back into
# a loop) trips it immediately.
CEILINGS = {
    "mintFree": 110_000,
    "subscribe_new": 184_000,
    "subscribe_renew": 70_000,
    # Re-baselined when the positions case switched from a FREE phase to a
    # PRICED one: a 0-price phase is now rejected, and the free measurement never
    # exercised the oracle read, the last-good-price cache write or the refund
    # branch that every real mint pays for. 256,897 / 58,767 measured.
    "positions_mint_x1": 278_000,
    "positions_mint_x10_per_card": 64_000,
}


@pytest.fixture()
def w3():
    from web3 import EthereumTesterProvider, Web3

    return Web3(EthereumTesterProvider())


def _artifacts():
    with open(ARTIFACTS) as f:
        return json.load(f)["artifacts"]


def _deploy(w3, art, name, *args, frm=None):
    frm = frm or w3.eth.accounts[0]
    c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
    rcpt = w3.eth.wait_for_transaction_receipt(c.constructor(*args).transact({"from": frm}))
    return w3.eth.contract(address=rcpt.contractAddress, abi=art[name]["abi"])


def _gas(w3, fn, sender):
    rcpt = w3.eth.wait_for_transaction_receipt(fn.transact({"from": sender}))
    assert rcpt.status == 1
    return rcpt.gasUsed


def test_membership_gas_within_ceilings(w3):
    art = _artifacts()
    owner, treasury, alice, bob = w3.eth.accounts[:4]
    usdg = _deploy(w3, art, "MockUSDG")
    m = _deploy(w3, art, "SuwappuMembership", usdg.address, treasury, owner)
    usdg.functions.mint(alice, 10**12).transact({"from": owner})
    usdg.functions.approve(m.address, 2**200).transact({"from": alice})

    measured = {
        "mintFree": _gas(w3, m.functions.mintFree(), bob),
        "subscribe_new": _gas(w3, m.functions.subscribe(PRO, 1, 2**200), alice),
        "subscribe_renew": _gas(w3, m.functions.subscribe(PRO, 1, 2**200), alice),
    }
    for key, used in measured.items():
        assert used <= CEILINGS[key], f"{key} regressed: {used:,} > {CEILINGS[key]:,}"
    print("\n" + "\n".join(f"  {k:24} {v:>9,}" for k, v in measured.items()))


def test_positions_mint_gas_within_ceilings(w3):
    art = _artifacts()
    owner, alice = w3.eth.accounts[0], w3.eth.accounts[1]
    args = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))
    pos = _deploy(w3, art, "SuwappuPositions", args["caps"], args["tokens"], "https://x/", owner)
    feed = _deploy(w3, art, "MockEthUsdFeed", 2000_00000000)
    pos.functions.sealRegistry().transact({"from": owner})
    pos.functions.setEthUsdFeed(feed.address).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    # Public phase: no merkle root, $20 a card, generous caps. Priced, not free —
    # a 0-price phase is rejected outright now, and measuring a free mint would
    # miss the oracle read and the last-good-price cache the real path pays for.
    pos.functions.configurePhase(3, b"\x00" * 32, 2000, 50, 0, now - 1, 0).transact({"from": owner})

    def _mint(qty):
        cost = pos.functions.quote(3, qty).call()
        rcpt = w3.eth.wait_for_transaction_receipt(
            w3.eth.send_transaction(
                {
                    "from": alice,
                    "to": pos.address,
                    "value": cost,
                    "gas": 2_000_000,
                    "data": pos.encode_abi("mint", args=[3, 0, qty, 0, []]),
                }
            )
        )
        assert rcpt.status == 1
        return rcpt.gasUsed

    one = _mint(1)
    ten = _mint(10)
    per_card = ten // 10
    assert one <= CEILINGS["positions_mint_x1"], f"{one:,}"
    assert per_card <= CEILINGS["positions_mint_x10_per_card"], f"{per_card:,}"
    print(f"\n  positions mint x1        {one:>9,}\n  positions x10 per card   {per_card:>9,}")
