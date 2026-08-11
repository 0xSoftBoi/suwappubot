"""SuwappuPositions — USD pricing, refunds and mint lifecycle, on a real EVM.

Modelled on what a collection that actually minted out gets right: the mint is
quoted in dollars and converted at purchase time, overpayment is refunded rather
than reverted, the feed is sanity-banded with a bounded fallback, and the end of
the mint is a promise the contract keeps.
"""

import json
import os

import pytest

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")

PUBLIC = 3
CENTS = 2000  # $20.00 a card
ETH_USD = 2000_00000000  # $2,000, 8dp
NO_PROOF: list = []
ZERO_ROOT = b"\x00" * 32


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
    pos = deploy("SuwappuPositions", args["caps"], args["tokens"], "https://x/", owner)
    feed = deploy("MockEthUsdFeed", ETH_USD)
    pos.functions.sealRegistry().transact({"from": owner})
    pos.functions.setEthUsdFeed(feed.address).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 50, 0, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, feed, owner, alice


def test_price_is_quoted_in_dollars_not_wei(env):
    """A wei price silently reprices the whole mint when ETH moves. $20 must stay
    $20 across a 50% rally."""
    w3, pos, feed, owner, alice = env
    q1 = pos.functions.quote(PUBLIC, 1).call()
    assert q1 == 10**18 * CENTS * 10**8 // (ETH_USD * 100)
    assert abs(q1 - 10**16) < 10**12  # $20 at $2,000/ETH == 0.01 ETH

    feed.functions.set(3000_00000000, w3.eth.get_block("latest").timestamp).transact(
        {"from": owner}
    )
    q2 = pos.functions.quote(PUBLIC, 1).call()
    # ETH up 50% -> the card still costs $20, so it costs a third less ETH
    assert abs(q2 - (q1 * 2 // 3)) < q1 // 100


def test_overpayment_is_refunded_not_reverted(env):
    """Requiring an exact wei amount against a moving feed reverts most mints on
    a price tick between quoting and mining."""
    w3, pos, feed, owner, alice = env
    cost = pos.functions.quote(PUBLIC, 2).call()
    rcpt = w3.eth.wait_for_transaction_receipt(
        pos.functions.mint(PUBLIC, 0, 2, 0, NO_PROOF).transact({"from": alice, "value": cost * 2})
    )
    assert rcpt.status == 1
    assert pos.functions.balanceOf(alice).call() == 2
    # The contract keeps exactly the cost; the 100% overpayment went back.
    # (Balance-delta arithmetic would be muddied by EIP-1559 gas.)
    assert w3.eth.get_balance(pos.address) == cost


def test_underpayment_still_reverts(env):
    w3, pos, feed, owner, alice = env
    cost = pos.functions.quote(PUBLIC, 1).call()
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF).transact({"from": alice, "value": cost - 1})


def test_out_of_band_or_stale_feed_falls_back_and_never_sells_for_dust(env):
    """A compromised aggregator reporting $0.01 must not let the collection be
    bought for nothing, and a stale one must not brick the mint."""
    w3, pos, feed, owner, alice = env
    now = w3.eth.get_block("latest").timestamp

    feed.functions.set(1_00000000, now).transact({"from": owner})  # $1 — below band
    assert pos.functions.ethUsd().call()[1] is False
    with pytest.raises(Exception):  # no fallback configured yet
        pos.functions.quote(PUBLIC, 1).call()

    pos.functions.setFallbackWeiPerUsdCent(10**13).transact({"from": owner})
    assert pos.functions.quote(PUBLIC, 1).call() == CENTS * 10**13

    feed.functions.set(ETH_USD, now - 4 * 3600).transact({"from": owner})  # stale
    assert pos.functions.ethUsd().call()[1] is False
    assert pos.functions.quote(PUBLIC, 1).call() == CENTS * 10**13

    with pytest.raises(Exception):  # fallback is bounded
        pos.functions.setFallbackWeiPerUsdCent(10**16).transact({"from": owner})


def test_mint_end_is_a_promise_the_contract_keeps(env):
    w3, pos, feed, owner, alice = env
    now = w3.eth.get_block("latest").timestamp
    pos.functions.announceEnd(now + 100).transact({"from": owner})
    with pytest.raises(Exception):  # cannot be extended
        pos.functions.announceEnd(now + 100000).transact({"from": owner})
    w3.provider.ethereum_tester.time_travel(now + 200)
    w3.provider.ethereum_tester.mine_block()
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF).transact({"from": alice, "value": 10**17})


def test_close_forever_stops_the_owner_too(env):
    """'10,000 max' is a claim; a one-way close is proof."""
    w3, pos, feed, owner, alice = env
    pos.functions.closeMintingForever().transact({"from": owner})
    assert pos.functions.mintingClosedForever().call() is True
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF).transact({"from": alice, "value": 10**17})
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})


def test_pause_and_royalties(env):
    w3, pos, feed, owner, alice = env
    pos.functions.setPaused(True).transact({"from": owner})
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF).transact({"from": alice, "value": 10**17})
    pos.functions.setPaused(False).transact({"from": owner})
    pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF).transact({"from": alice, "value": 10**17})

    pos.functions.setDefaultRoyalty(owner, 500).transact({"from": owner})  # 5%
    receiver, amount = pos.functions.royaltyInfo(1, 10**18).call()
    assert receiver == owner and amount == 5 * 10**16
    assert pos.functions.supportsInterface(bytes.fromhex("2a55205a")).call() is True  # ERC2981


def test_ownership_transfer_is_two_step(env):
    """A typo'd single-step transferOwnership bricks the contract permanently."""
    w3, pos, feed, owner, alice = env
    pos.functions.transferOwnership(alice).transact({"from": owner})
    assert pos.functions.owner().call() == owner  # not yet
    assert pos.functions.pendingOwner().call() == alice
    pos.functions.acceptOwnership().transact({"from": alice})
    assert pos.functions.owner().call() == alice
