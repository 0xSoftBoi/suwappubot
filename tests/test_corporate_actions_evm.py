"""Corporate actions — the thing that only works on Robinhood Chain.

These are LICENSED equities. They split. The chain publishes the resulting
`uiMultiplier()` on-chain, which no other chain does for a licensed instrument,
and `priceOf` already returns 0 while `oraclePaused()` is true — which is exactly
the window a corporate action lands in.

The consequence, if you read the price without the multiplier: a card minted
before a 10:1 split compares an old-basis entry against a new-basis price and
prints a fabricated -90% on a position whose holder did nothing but hold.
"""

import json
import os

import pytest

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")
PUBLIC = 3
CENTS = 2000
ETH_USD = 2000_00000000
ZERO_ROOT = b"\x00" * 32
ONE = 10**18


@pytest.fixture()
def env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = json.load(open(ARTIFACTS))["artifacts"]
    owner, alice = w3.eth.accounts[0], w3.eth.accounts[1]

    def deploy(name, *a):
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        r = w3.eth.wait_for_transaction_receipt(c.constructor(*a).transact({"from": owner}))
        return w3.eth.contract(address=r.contractAddress, abi=art[name]["abi"])

    args = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))
    stock = deploy("MockStockToken")
    feed = deploy("MockEthUsdFeed", ETH_USD)
    equity_feed = deploy("MockEthUsdFeed", 100_00000000)  # $100 a share

    # the collection's ticker 0 points at our mock licensed stock token
    tokens = list(args["tokens"])
    tokens[0] = stock.address
    pos = deploy("SuwappuPositions", args["caps"], tokens, "https://x/", owner)

    oracle = deploy("RobinhoodChainlinkOracle", owner)
    oracle.functions.setFeeds([stock.address], [equity_feed.address]).transact({"from": owner})

    pos.functions.sealRegistry().transact({"from": owner})
    pos.functions.setEthUsdFeed(feed.address).transact({"from": owner})
    pos.functions.setOracle(oracle.address).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 50, 0, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, oracle, stock, equity_feed, owner, alice


def _mint(w3, pos, who, qty=1):
    cost = pos.functions.quote(PUBLIC, qty).call()
    r = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": who,
                "to": pos.address,
                "value": cost,
                "gas": 2_000_000,
                "data": pos.encode_abi("mint", args=[PUBLIC, 0, qty, 0, []]),
            }
        )
    )
    assert r.status == 1
    return pos.functions.totalSupply().call()


def test_the_oracle_reports_the_multiplier_and_never_reverts(env):
    w3, pos, oracle, stock, ef, owner, alice = env
    assert oracle.functions.multiplierOf(stock.address).call() == ONE
    stock.functions.split(10).transact({"from": owner})
    assert oracle.functions.multiplierOf(stock.address).call() == 10 * ONE
    # an address that publishes no multiplier is reported as unadjusted, not 0 —
    # every downstream ratio must degrade to a no-op, never a division by zero
    assert oracle.functions.multiplierOf(pos.address).call() == ONE
    # and a malfunctioning token cannot rebase a stored basis into nonsense
    stock.functions.setMultiplier(10**30).transact({"from": owner})
    assert oracle.functions.multiplierOf(stock.address).call() == ONE


def test_a_split_does_not_fabricate_a_catastrophic_loss(env):
    """The bug this exists to prevent. Mint at $100, the equity does a 10:1
    split, the feed now quotes $10 on the new basis. Naively that is -90%; the
    holder did nothing but hold."""
    w3, pos, oracle, stock, ef, owner, alice = env
    tid = _mint(w3, pos, alice)

    bps, priced = pos.functions.returnBps(tid).call()
    assert priced and abs(bps) < 50, f"flat position should read ~0, got {bps}"
    assert pos.functions.adjustedEntry(tid).call() == 100 * ONE

    # 10:1 split — multiplier moves, and the feed re-quotes on the new basis
    stock.functions.split(10).transact({"from": owner})
    ef.functions.set(10_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})

    bps_after, priced_after = pos.functions.returnBps(tid).call()
    assert priced_after
    assert abs(bps_after) < 50, f"split fabricated a {bps_after / 100:.1f}% move"
    # the basis travelled with the price rather than staying on the old one
    assert pos.functions.adjustedEntry(tid).call() == 10 * ONE


def test_a_real_gain_still_reads_as_a_gain_through_a_split(env):
    """The adjustment must not flatten genuine performance — only remove the
    part that is an artefact of the basis changing."""
    w3, pos, oracle, stock, ef, owner, alice = env
    tid = _mint(w3, pos, alice)
    # 10:1 split, and the shares are ALSO up 50% on the new basis ($15 vs $10)
    stock.functions.split(10).transact({"from": owner})
    ef.functions.set(15_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    bps, priced = pos.functions.returnBps(tid).call()
    assert priced
    assert 4_900 < bps < 5_100, f"expected ~+50%, got {bps / 100:.1f}%"


def test_surviving_a_corporate_action_is_status_that_cannot_be_bought(env):
    """The only status in this collection that cannot be minted for: you had to
    have been holding when a licensed equity actually split."""
    w3, pos, oracle, stock, ef, owner, alice = env
    held_through = _mint(w3, pos, alice)

    survived, at_mint, current = pos.functions.corporateAction(held_through).call()
    assert not survived and at_mint == current == ONE

    stock.functions.split(4).transact({"from": owner})
    ef.functions.set(25_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})

    survived, at_mint, current = pos.functions.corporateAction(held_through).call()
    assert survived, "a position held through a split does not show it"
    assert at_mint == ONE and current == 4 * ONE

    # someone minting AFTER the action cannot claim it, however much they pay
    minted_after = _mint(w3, pos, alice)
    survived_after, _, _ = pos.functions.corporateAction(minted_after).call()
    assert not survived_after, "the status was buyable after the fact"


def test_a_paused_oracle_is_not_reported_as_a_price(env):
    """Robinhood pauses the oracle across a corporate action. A card must go
    unpriced for that window rather than print a number from a stale basis."""
    w3, pos, oracle, stock, ef, owner, alice = env
    tid = _mint(w3, pos, alice)
    assert pos.functions.returnBps(tid).call()[1] is True

    stock.functions.setPaused(True).transact({"from": owner})
    bps, priced = pos.functions.returnBps(tid).call()
    assert priced is False and bps == 0
    assert oracle.functions.priceOf(stock.address).call() == 0

    stock.functions.setPaused(False).transact({"from": owner})
    assert pos.functions.returnBps(tid).call()[1] is True


def test_the_multiplier_is_stamped_in_the_position_itself(env):
    """Stored on the token, not recomputed — the whole point is that it records
    what was true at mint. It completes the packed slot exactly."""
    w3, pos, oracle, stock, ef, owner, alice = env
    stock.functions.split(2).transact({"from": owner})
    ef.functions.set(50_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    tid = _mint(w3, pos, alice)
    p = pos.functions.positionOf(tid).call()
    assert p[4] == 2 * ONE, f"entryMultiplier not stamped: {p}"
