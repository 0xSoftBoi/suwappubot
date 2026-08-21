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

from positions_helpers import authorized_mint, signer_for, wire_payments

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
    usdg = wire_payments(w3, art, pos, owner, owner, alice, deploy)
    pos.functions.setOracle(oracle.address).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 50, 0, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, oracle, stock, equity_feed, owner, alice, usdg


def _mint(w3, pos, usdg, who, qty=1):
    """Paid mint via EIP-3009. `who` signs; the OWNER account submits and pays
    the gas — which is the point: the payer needs no ETH."""
    authorized_mint(
        w3,
        pos,
        usdg,
        signer_for(w3, who),
        PUBLIC,
        0,
        qty,
        submitter=w3.eth.accounts[0],
        allow_unpriced=False,
    )
    return pos.functions.totalSupply().call()


def test_the_oracle_reports_the_multiplier_and_never_reverts(env):
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    assert oracle.functions.multiplierOf(stock.address).call() == ONE
    stock.functions.split(10).transact({"from": owner})
    assert oracle.functions.multiplierOf(stock.address).call() == 10 * ONE
    # an address that publishes no multiplier is reported as unadjusted, not 0 —
    # every downstream ratio must degrade to a no-op, never a division by zero
    assert oracle.functions.multiplierOf(pos.address).call() == ONE
    # and a malfunctioning token cannot rebase a stored basis into nonsense
    stock.functions.setMultiplier(10**30).transact({"from": owner})
    assert oracle.functions.multiplierOf(stock.address).call() == ONE


def test_a_split_does_not_move_the_return_at_all(env):
    """A split must be a non-event for return, because the feed is already
    multiplier-adjusted.

    Robinhood's integration guide: "The Chainlink price already includes the
    corporate-action multiplier (dividends, splits) ... don't apply the
    multiplier yourself." So after a 10:1 split the per-SHARE price falls
    tenfold while shares-per-token rises tenfold, and the TOKEN price the feed
    publishes is unchanged. The earlier version of this test re-quoted the feed
    to $10, which models a raw share-price feed Robinhood does not publish, and
    it pinned a basis adjustment that fabricated a +900% return.
    """
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    tid = _mint(w3, pos, usdg, alice)

    bps, priced = pos.functions.returnBps(tid).call()
    assert priced and abs(bps) < 50, f"flat position should read ~0, got {bps}"
    assert pos.functions.entryBasis(tid).call() == 100 * ONE
    assert pos.functions.sharesPerToken(tid).call() == ONE

    # 10:1 split. Multiplier moves; the multiplier-adjusted feed does NOT.
    stock.functions.split(10).transact({"from": owner})

    bps_after, priced_after = pos.functions.returnBps(tid).call()
    assert priced_after
    assert abs(bps_after) < 50, f"split fabricated a {bps_after / 100:.1f}% move"
    # The stamped basis is used as-is — no rebasing, in either direction.
    assert pos.functions.entryBasis(tid).call() == 100 * ONE
    # The quantity change is where the multiplier belongs: 1 token now backs 10x.
    assert pos.functions.sharesPerToken(tid).call() == 10 * ONE


def test_a_real_gain_still_reads_as_a_gain_through_a_split(env):
    """A corporate action must not mask genuine performance."""
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    tid = _mint(w3, pos, usdg, alice)
    # 10:1 split AND the position is genuinely up 50%: per-share is $15 against
    # a post-split $10, so the multiplier-adjusted token price is $150.
    stock.functions.split(10).transact({"from": owner})
    ef.functions.set(150_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    bps, priced = pos.functions.returnBps(tid).call()
    assert priced
    assert 4_900 < bps < 5_100, f"expected ~+50%, got {bps / 100:.1f}%"


def test_a_reinvested_dividend_reads_as_a_gain_not_a_wash(env):
    """Cash dividends on chain 4663 are reinvested by raising the multiplier —
    AAPL sits at 1.000566 and ORCL at 1.002210 live today. The token is worth
    more because it backs more shares, so the holder is genuinely up and the
    feed says so. Dividing the basis by the multiplier would have erased exactly
    that gain.
    """
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    tid = _mint(w3, pos, usdg, alice)
    # multiplier 1.0 -> 1.05 (a 5% reinvestment), token price up the same 5%
    stock.functions.setMultiplier(ONE * 105 // 100).transact({"from": owner})
    ef.functions.set(105_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    bps, priced = pos.functions.returnBps(tid).call()
    assert priced
    assert 490 < bps < 510, f"reinvested dividend should read ~+5%, got {bps / 100:.1f}%"


def test_surviving_a_corporate_action_is_status_that_cannot_be_bought(env):
    """The only status in this collection that cannot be minted for: you had to
    have been holding when a licensed equity actually split."""
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    held_through = _mint(w3, pos, usdg, alice)

    survived, at_mint, current = pos.functions.corporateAction(held_through).call()
    assert not survived and at_mint == current == ONE

    stock.functions.split(4).transact({"from": owner})
    ef.functions.set(25_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})

    survived, at_mint, current = pos.functions.corporateAction(held_through).call()
    assert survived, "a position held through a split does not show it"
    assert at_mint == ONE and current == 4 * ONE

    # someone minting AFTER the action cannot claim it, however much they pay
    minted_after = _mint(w3, pos, usdg, alice)
    survived_after, _, _ = pos.functions.corporateAction(minted_after).call()
    assert not survived_after, "the status was buyable after the fact"


def test_a_paused_oracle_is_not_reported_as_a_price(env):
    """Robinhood pauses the oracle across a corporate action. A card must go
    unpriced for that window rather than print a number from a stale basis."""
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    tid = _mint(w3, pos, usdg, alice)
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
    w3, pos, oracle, stock, ef, owner, alice, usdg = env
    stock.functions.split(2).transact({"from": owner})
    ef.functions.set(50_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    tid = _mint(w3, pos, usdg, alice)
    p = pos.functions.positionOf(tid).call()
    assert p[4] == 2 * ONE, f"entryMultiplier not stamped: {p}"


def test_a_large_split_cannot_truncate_the_stamped_multiplier(env):
    """BLOCKER from review: the oracle clamps the multiplier to 1e21 but the
    field was uint64, which tops out at ~1.845e19 — so the top 54x of the
    permitted band was unrepresentable and the narrowing cast wrapped it in
    SILENCE. A single 20:1 split (20e18) became 1.553e18, a 12.9x error in the
    wrong direction, and the wrapped value was stamped into an immutable field
    with no restamp path. Every pre-split card of that ticker would print a
    fabricated return forever."""
    w3, pos, oracle, stock, ef, owner, alice, usdg = env

    for ratio, label in ((20, "20:1"), (40, "4:1 then 10:1 cumulative")):
        stock.functions.setMultiplier(ratio * ONE).transact({"from": owner})
        reported = oracle.functions.multiplierOf(stock.address).call()
        assert reported == ratio * ONE, f"{label} truncated to {reported}"
        assert reported > 2**64 - 1 or ratio * ONE <= 2**64 - 1

    # and it survives the round trip into storage, which is what actually gets
    # stamped forever
    stock.functions.setMultiplier(20 * ONE).transact({"from": owner})
    ef.functions.set(5_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    tid = _mint(w3, pos, usdg, alice)
    assert pos.functions.positionOf(tid).call()[4] == 20 * ONE


def test_the_position_struct_still_packs_into_one_slot():
    """The widening must not have quietly cost a storage slot: 8 + 96 + 40 + 16
    + 96 = 256 bits exactly."""
    src = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    struct = src[src.index("struct Position {") : src.index("}", src.index("struct Position {"))]
    bits = sum(int(w) for w in __import__("re").findall(r"uint(\d+)\s+\w+;", struct))
    assert bits == 256, f"Position is {bits} bits — no longer one slot"


def test_a_paid_mint_will_not_sell_a_permanently_unpriced_card(env):
    """BLOCKER from review: entryPrice is written once with no restamp, so a
    card stamped 0 reports (0, false) forever. priceOf returns 0 whenever the
    sequencer is down, the token's oracle is paused, or the round is older than
    maxAge — and maxAge is 3 days against a 24/5 feed, so a long weekend plus a
    market holiday clears it for all 35 tickers at once. Not bricking the mint
    is right; selling a defective card at full price is not."""
    w3, pos, oracle, stock, ef, owner, alice, usdg = env

    stock.functions.setPaused(True).transact({"from": owner})
    assert oracle.functions.priceOf(stock.address).call() == 0

    def send(allow):
        try:
            r = authorized_mint(
                w3,
                pos,
                usdg,
                signer_for(w3, alice),
                PUBLIC,
                0,
                1,
                submitter=w3.eth.accounts[0],
                allow_unpriced=allow,
            )
            return r.status
        except Exception:
            # a revert during estimation surfaces as an exception, not status 0
            return 0

    assert send(False) == 0, "sold a permanently unpriced card at full price"
    # the buyer can still opt in deliberately
    assert send(True) == 1
    tid = pos.functions.totalSupply().call()
    assert pos.functions.positionOf(tid).call()[1] == 0  # entryPrice, opted in

    # and once the oracle recovers the guard stops firing
    stock.functions.setPaused(False).transact({"from": owner})
    assert send(False) == 1
