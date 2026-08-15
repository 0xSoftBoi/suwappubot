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
        pos.functions.mint(PUBLIC, 0, 2, 0, NO_PROOF, True).transact(
            {"from": alice, "value": cost * 2}
        )
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
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": cost - 1}
        )


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
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": 10**17}
        )


def test_close_forever_stops_the_owner_too(env):
    """'10,000 max' is a claim; a one-way close is proof."""
    w3, pos, feed, owner, alice = env
    pos.functions.closeMintingForever().transact({"from": owner})
    assert pos.functions.mintingClosedForever().call() is True
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": 10**17}
        )
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})


def test_pause_and_royalties(env):
    w3, pos, feed, owner, alice = env
    pos.functions.setPaused(True).transact({"from": owner})
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": 10**17}
        )
    pos.functions.setPaused(False).transact({"from": owner})
    pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact({"from": alice, "value": 10**17})

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


def test_mint_state_is_one_call(env):
    """Parity item: their eligibilityOf returns 13 values in a single call, so
    the whole mint page loads in one round-trip. Ours previously needed six or
    seven reads."""
    w3, pos, feed, owner, alice = env
    st = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    (
        live,
        requires_proof,
        price_cents,
        price_wei,
        priced_by_feed,
        starts_at,
        ends_at,
        wallet_cap,
        allocation,
        phase_minted,
        wallet_minted,
        wallet_remaining,
        ticker_remaining,
        minted,
        supply_remaining,
        is_paused,
        ended,
        closed,
    ) = st

    assert live is True and requires_proof is False
    assert price_cents == CENTS
    assert price_wei == pos.functions.quote(PUBLIC, 1).call()
    assert priced_by_feed is True
    assert wallet_cap == 50 and wallet_minted == 0 and wallet_remaining == 50
    assert ticker_remaining > 0 and minted == 0 and supply_remaining == 10_000
    assert (is_paused, ended, closed) == (False, False, False)

    # it tracks reality after a mint
    pos.functions.mint(PUBLIC, 0, 2, 0, NO_PROOF, True).transact(
        {"from": alice, "value": pos.functions.quote(PUBLIC, 2).call()}
    )
    st2 = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    assert st2[10] == 2 and st2[11] == 48  # walletMinted / walletRemaining
    assert st2[13] == 2 and st2[14] == 9_998  # minted / supplyRemaining
    assert st2[12] == ticker_remaining - 2

    # and reflects lifecycle without extra calls
    pos.functions.setPaused(True).transact({"from": owner})
    st3 = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    assert st3[15] is True and st3[0] is False  # isPaused, live


def test_mint_state_works_logged_out_and_on_fallback_pricing(env):
    w3, pos, feed, owner, alice = env
    zero = "0x" + "00" * 20
    st = pos.functions.mintState(zero, PUBLIC, 0, 0).call()
    assert st[10] == 0 and st[11] == 0  # no wallet figures, no revert

    now = w3.eth.get_block("latest").timestamp
    feed.functions.set(1_00000000, now).transact({"from": owner})  # out of band
    pos.functions.setFallbackWeiPerUsdCent(10**13).transact({"from": owner})
    st2 = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    assert st2[4] is False, "must report that the fallback is pricing the mint"
    assert st2[3] == CENTS * 10**13


# ── review follow-ups: the oracle must degrade, not brick or mis-sell ────────


def test_a_feed_whose_decimals_reverts_cannot_brick_the_mint(env):
    """M1: `feed.decimals()` sat in the SUCCESS BODY of the try, not in the
    tried call, so its revert propagated out of ethUsd() → _weiForCents →
    mint()/quote()/mintState(). That defeated the entire point of the bounded
    fallback. decimals() is now read once at setEthUsdFeed and cached."""
    w3, pos, feed, owner, alice = env

    # a feed that cannot answer decimals() is refused outright
    bad = w3.eth.contract(
        abi=json.load(open(ARTIFACTS))["artifacts"]["MockEthUsdFeed"]["abi"],
        bytecode=json.load(open(ARTIFACTS))["artifacts"]["MockEthUsdFeed"]["bytecode"],
    )
    r = w3.eth.wait_for_transaction_receipt(bad.constructor(ETH_USD).transact({"from": owner}))
    bad = w3.eth.contract(address=r.contractAddress, abi=bad.abi)
    bad.functions.setFailDecimals(True).transact({"from": owner})
    with pytest.raises(Exception):
        pos.functions.setEthUsdFeed(bad.address).transact({"from": owner})
    assert pos.functions.ethUsdFeed().call() == feed.address, "a bad feed was installed"

    # and an installed feed that turns bad LATER degrades instead of reverting
    feed.functions.setFailDecimals(True).transact({"from": owner})
    price, from_feed = pos.functions.ethUsd().call()
    assert from_feed is True and price == ETH_USD, "cached decimals were not used"
    assert pos.functions.quote(PUBLIC, 1).call() > 0
    pos.functions.mintState(alice, PUBLIC, 0, 0).call()  # must not revert


def test_an_outage_prices_off_the_last_real_price_not_a_stale_constant(env):
    """M2: the flat fallback is only correct at the ETH price it was set for,
    and it engaged precisely when ETH had MOVED. Set for $2,000 and with ETH at
    $150, a feed outage sold $20 cards for pennies — the remaining supply
    sweeping for a fraction of intended."""
    w3, pos, feed, owner, alice = env

    # a fallback configured for $2,000/ETH
    fb = 10**18 * 10**8 // (ETH_USD * 100)
    pos.functions.setFallbackWeiPerUsdCent(fb).transact({"from": owner})

    # ETH collapses to $150 and the mint records that price
    feed.functions.set(150_00000000, w3.eth.get_block("latest").timestamp).transact({"from": owner})
    cost = pos.functions.quote(PUBLIC, 1).call()
    w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": alice,
                "to": pos.address,
                "value": cost,
                "gas": 900_000,
                "data": pos.encode_abi("mint", args=[PUBLIC, 0, 1, 0, [], True]),
            }
        )
    )
    assert pos.functions.lastGoodEthUsd8dp().call() == 150_00000000

    # now the feed goes stale — pricing must follow the $150 print, not $2,000
    feed.functions.set(150_00000000, 1).transact({"from": owner})
    price, from_feed = pos.functions.ethUsd().call()
    assert from_feed is False, "stale feed still reported as live"

    effective, source = pos.functions.effectiveEthUsd().call()
    assert source == 1 and effective == 150_00000000
    outage_cost = pos.functions.quote(PUBLIC, 1).call()
    assert outage_cost == cost, "an outage repriced the card"
    # the old flat fallback would have charged the $2,000-era number
    assert outage_cost != CENTS * fb
    # and mintState still quotes a price while flagging it as not feed-priced
    st = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    assert st[3] == outage_cost, st  # priceWei
    assert st[4] is False, "degraded pricing was reported as feed-priced"


def test_a_phase_cannot_be_configured_free_by_omission(env):
    """M3: price is the 3rd of 7 positional args. At 0 the phase minted its whole
    allocation for nothing, with no burn, no claw-back, and mintState.priceWei
    reading 0 so the UI showed nothing wrong."""
    w3, pos, feed, owner, alice = env
    now = w3.eth.get_block("latest").timestamp
    with pytest.raises(Exception):
        pos.functions.configurePhase(PUBLIC, ZERO_ROOT, 0, 50, 0, now - 1, 0).transact(
            {"from": owner}
        )


def test_ownership_cannot_be_renounced(env):
    """M4: Ownable.renounceOwnership is one unguarded call. This contract holds
    every wei of mint revenue (withdraw is onlyOwner) and owns the only levers
    that pause the mint or repoint a broken feed."""
    w3, pos, feed, owner, alice = env
    with pytest.raises(Exception):
        pos.functions.renounceOwnership().transact({"from": owner})
    assert pos.functions.owner().call() == owner


def test_owner_mint_honours_the_announced_end_and_the_pause(env):
    """M5: ownerMint checked only mintingClosedForever, so after the announced
    end the owner could still airdrop 200 reserve cards — which is not what
    "minting ends on X" means."""
    w3, pos, feed, owner, alice = env

    pos.functions.setPaused(True).transact({"from": owner})
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})
    pos.functions.setPaused(False).transact({"from": owner})
    pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})  # sanity

    end = w3.eth.get_block("latest").timestamp + 60
    pos.functions.announceEnd(end).transact({"from": owner})
    w3.provider.ethereum_tester.time_travel(end + 60)
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})


def test_a_feed_stamped_in_the_future_is_not_treated_as_fresh(env):
    """L4: staleness was skipped entirely whenever updatedAt > block.timestamp,
    so a feed reporting future timestamps read fresh forever."""
    w3, pos, feed, owner, alice = env
    future = w3.eth.get_block("latest").timestamp + 365 * 86400
    feed.functions.set(ETH_USD, future).transact({"from": owner})
    _, from_feed = pos.functions.ethUsd().call()
    assert from_feed is False, "a future-stamped round was accepted as fresh"

    feed.functions.set(ETH_USD, 0).transact({"from": owner})
    assert pos.functions.ethUsd().call()[1] is False, "updatedAt == 0 was accepted"


def test_max_per_wallet_is_actually_enforced(env):
    """It was declared as a public constant and never read by mint(), so the
    contract documented a limit it did not have — and walletCap == 0 means "no
    cap", so a misconfigured phase was unbounded per wallet."""
    w3, pos, feed, owner, alice = env
    now = w3.eth.get_block("latest").timestamp
    # a phase with NO wallet cap and no allowlist: previously unbounded
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 0, 0, now - 1, 0).transact(
        {"from": owner}
    )
    cap = pos.functions.MAX_PER_WALLET().call()

    def mint(qty):
        cost = pos.functions.quote(PUBLIC, qty).call()
        return w3.eth.wait_for_transaction_receipt(
            w3.eth.send_transaction(
                {
                    "from": alice,
                    "to": pos.address,
                    "value": cost,
                    "gas": 6_000_000,
                    "data": pos.encode_abi("mint", args=[PUBLIC, 0, qty, 0, [], True]),
                }
            )
        ).status

    assert mint(cap) == 1, "the cap itself must be reachable"
    assert mint(1) == 0, f"minted past MAX_PER_WALLET ({cap})"


def test_a_free_phase_needs_the_door_marked_free(env):
    """The Founder phase is free by design, but price == 0 must stay impossible
    to reach by ACCIDENT — price is the 3rd of 7 positional args. configurePhase
    refuses a 0; configureFreePhase makes the giveaway explicit in the call the
    owner signs."""
    w3, pos, feed, owner, alice = env
    now = w3.eth.get_block("latest").timestamp

    with pytest.raises(Exception):  # a dropped argument stays loud
        pos.functions.configurePhase(1, ZERO_ROOT, 0, 3, 1500, now - 1, 0).transact({"from": owner})

    # an unbounded free phase is an open faucet for the whole allocation
    with pytest.raises(Exception):
        pos.functions.configureFreePhase(1, ZERO_ROOT, 0, 1500, now - 1, 0).transact(
            {"from": owner}
        )

    # bounded by a wallet cap: allowed, and it really does mint for nothing
    pos.functions.configureFreePhase(1, ZERO_ROOT, 3, 1500, now - 1, 0).transact({"from": owner})
    assert pos.functions.quote(1, 1).call() == 0
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": alice,
                "to": pos.address,
                "value": 0,
                "gas": 900_000,
                "data": pos.encode_abi("mint", args=[1, 0, 3, 0, [], True]),
            }
        )
    )
    assert rcpt.status == 1
    assert pos.functions.minted(alice).call() == 3


def test_config_prices_are_in_the_unit_the_contract_charges(env):
    """config.json said price_eth 0.004/0.008. The contract prices in USD CENTS
    and converts to wei at mint through the ETH/USD feed — fed to
    configurePhase() those values truncate to 0 cents, which now reverts."""
    cfg = json.load(open(os.path.join(REPO, "nft", "position-cards", "config.json")))
    for name, phase in cfg["mint"]["phases"].items():
        assert "price_eth" not in phase, f"{name} still priced in the wrong unit"
        cents = phase["price_usd_cents"]
        assert isinstance(cents, int), f"{name} price must be whole cents"
        assert phase["free"] == (cents == 0)
