"""Adversarial tests — attempts to actually steal, executed on real bytecode.

Everything here tries to break the contracts rather than assert that they look
correct. A passing test means the attack FAILED. Written after noticing that
most of this feature's coverage asserted on source strings, which cannot catch a
reentrancy or an ordering bug.
"""

import json
import os

import pytest

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")

PUBLIC = 3
CENTS = 2000  # $20
ETH_USD = 2000_00000000
ZERO_ROOT = b"\x00" * 32
NO_PROOF: list = []
PRO, ENTERPRISE = 1, 3
PRO_PRICE, ENTERPRISE_PRICE = 9_990_000, 99_990_000


def _art():
    with open(ARTIFACTS) as f:
        return json.load(f)["artifacts"]


@pytest.fixture()
def pos_env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = _art()
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
    # wallet cap 2 — the attacker's goal is to exceed it
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 2, 0, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, feed, owner, alice, art


# ── attack 1: reentrancy through the two windows in mint() ───────────────────


def _deploy_attacker(w3, art, pos, owner):
    c = w3.eth.contract(
        abi=art["MaliciousMinter"]["abi"], bytecode=art["MaliciousMinter"]["bytecode"]
    )
    r = w3.eth.wait_for_transaction_receipt(c.constructor(pos.address).transact({"from": owner}))
    return w3.eth.contract(address=r.contractAddress, abi=art["MaliciousMinter"]["abi"])


@pytest.mark.parametrize(
    "on_receive,on_erc721,label",
    [(True, False, "refund call"), (False, True, "onERC721Received"), (True, True, "both")],
)
def test_reentrancy_cannot_exceed_the_wallet_cap(pos_env, on_receive, on_erc721, label):
    """mint() refunds with a raw call AFTER _safeMint hands control to the
    receiver, so there are two reentrancy windows. Neither may mint past the cap."""
    w3, pos, feed, owner, alice, art = pos_env
    atk = _deploy_attacker(w3, art, pos, owner)
    atk.functions.arm(PUBLIC, 0, on_receive, on_erc721).transact({"from": owner})

    cost = pos.functions.quote(PUBLIC, 2).call()
    # fund it generously so a successful reentry would actually be affordable
    w3.eth.send_transaction({"from": alice, "to": atk.address, "value": cost * 5})

    rcpt = w3.eth.wait_for_transaction_receipt(
        atk.functions.attack(2).transact({"from": alice, "value": cost, "gas": 3_000_000})
    )
    assert rcpt.status == 1, f"the honest mint itself failed ({label})"

    minted = pos.functions.balanceOf(atk.address).call()
    assert minted == 2, f"reentrancy via {label} minted {minted}, cap is 2"
    assert atk.functions.reentrySuccesses().call() == 0, f"reentry succeeded via {label}"
    assert pos.functions.totalSupply().call() == 2


def test_refund_cannot_drain_more_than_was_overpaid(pos_env):
    w3, pos, feed, owner, alice, art = pos_env
    atk = _deploy_attacker(w3, art, pos, owner)
    atk.functions.arm(PUBLIC, 0, True, True).transact({"from": owner})

    cost = pos.functions.quote(PUBLIC, 1).call()
    seed = cost * 4
    w3.eth.send_transaction({"from": alice, "to": atk.address, "value": seed})
    before_contract = w3.eth.get_balance(pos.address)

    # overpay 3x on a 1-card mint. NOTE both the seed AND this msg.value are
    # inflow to the attacker contract — the conservation check below accounts
    # for both, which is what makes it exact rather than approximate.
    sent = cost * 3
    atk.functions.attack(1).transact({"from": alice, "value": sent, "gas": 3_000_000})

    # the collection keeps exactly the cost of what was actually minted
    minted = pos.functions.balanceOf(atk.address).call()
    assert w3.eth.get_balance(pos.address) == before_contract + cost * minted

    # exact conservation: every wei in is accounted for. A refund bug in either
    # direction (over-refunding, or pocketing the excess) breaks this equality.
    assert w3.eth.get_balance(atk.address) == seed + sent - cost * minted


# ── attack 2: payment/cap ordering — no free cards ───────────────────────────


def test_cap_rejection_never_keeps_the_money(pos_env):
    """Cost is computed before the cap checks. A mint that busts the cap must
    revert entirely, not take payment and mint nothing."""
    w3, pos, feed, owner, alice, art = pos_env
    cost = pos.functions.quote(PUBLIC, 3).call()
    before = w3.eth.get_balance(pos.address)
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": alice,
                "to": pos.address,
                "value": cost,
                "gas": 900_000,
                "data": pos.encode_abi("mint", args=[PUBLIC, 0, 3, 0, NO_PROOF]),
            }
        )
    )
    assert rcpt.status == 0, "minting past the wallet cap must revert"
    assert w3.eth.get_balance(pos.address) == before, "kept payment on a reverted mint"
    assert pos.functions.totalSupply().call() == 0


def test_underpay_by_one_wei_is_rejected(pos_env):
    w3, pos, feed, owner, alice, art = pos_env
    cost = pos.functions.quote(PUBLIC, 1).call()
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": alice,
                "to": pos.address,
                "value": cost - 1,
                "gas": 900_000,
                "data": pos.encode_abi("mint", args=[PUBLIC, 0, 1, 0, NO_PROOF]),
            }
        )
    )
    assert rcpt.status == 0
    assert pos.functions.totalSupply().call() == 0


# ── attack 3: pricing at the feed band edges ─────────────────────────────────


def test_pricing_is_correct_at_both_band_edges(pos_env):
    """Inside the band the USD price must hold exactly; the band only bounds how
    far a compromised feed can move it."""
    w3, pos, feed, owner, alice, art = pos_env
    now = w3.eth.get_block("latest").timestamp

    for eth_usd in (100_00000000, 100_000_00000000):  # $100 and $100,000 — the edges
        feed.functions.set(eth_usd, w3.eth.get_block("latest").timestamp).transact({"from": owner})
        wei = pos.functions.quote(PUBLIC, 1).call()
        usd_paid = wei * (eth_usd / 1e8) / 1e18
        assert abs(usd_paid - 20.0) < 0.01, f"${usd_paid} at ETH=${eth_usd/1e8}"

    # one wei outside the band on either side -> fallback, never a free card
    feed.functions.set(99_99999999, now).transact({"from": owner})
    assert pos.functions.ethUsd().call()[1] is False
    feed.functions.set(100_000_00000001, now).transact({"from": owner})
    assert pos.functions.ethUsd().call()[1] is False


# ── attack 4: membership authorization abuse ─────────────────────────────────


@pytest.fixture()
def mem_env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = _art()
    owner, treasury, relayer = w3.eth.accounts[0], w3.eth.accounts[1], w3.eth.accounts[2]

    def deploy(name, *a):
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        r = w3.eth.wait_for_transaction_receipt(c.constructor(*a).transact({"from": owner}))
        return w3.eth.contract(address=r.contractAddress, abi=art[name]["abi"])

    usdg = deploy("MockUSDG")
    m = deploy("SuwappuMembership", usdg.address, treasury, owner)
    return w3, usdg, m, owner, treasury, relayer


def _sign_auth(w3, acct, usdg, to, value, nonce, valid_before=None):
    if valid_before is None:
        valid_before = w3.eth.get_block("latest").timestamp + 3600
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": "Global Dollar",
            "version": "1",
            "chainId": w3.eth.chain_id,
            "verifyingContract": usdg.address,
        },
        "message": {
            "from": acct.address,
            "to": to,
            "value": value,
            "validAfter": 0,
            "validBefore": valid_before,
            "nonce": nonce,
        },
    }
    s = acct.sign_typed_data(full_message=typed)
    r = s.r.to_bytes(32, "big") if isinstance(s.r, int) else s.r
    ss = s.s.to_bytes(32, "big") if isinstance(s.s, int) else s.s
    return (acct.address, value, 0, valid_before, nonce, s.v, r, ss)


def test_authorization_paying_an_attacker_address_is_rejected(mem_env):
    """A payer signing `to = attacker` must not buy a subscription: the contract
    forces `to = treasury`, so the signature will not validate."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    from eth_account import Account

    payer, attacker = Account.create(), Account.create()
    usdg.functions.mint(payer.address, 10**12).transact({"from": owner})
    nonce = m.functions.subscriptionNonce(payer.address, PRO, 1).call()
    auth = _sign_auth(w3, payer, usdg, attacker.address, PRO_PRICE, nonce)

    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": relayer,
                "to": m.address,
                "gas": 900_000,
                "data": m.encode_abi("subscribeWithAuthorization", args=[PRO, 1, 2**200, auth]),
            }
        )
    )
    assert rcpt.status == 0
    assert usdg.functions.balanceOf(attacker.address).call() == 0
    assert m.functions.tokenOf(payer.address).call() == 0


def test_treasury_change_between_signing_and_broadcast_reverts_safely(mem_env):
    """Owner rotating the treasury must invalidate in-flight authorizations
    rather than sending the payer's USDG somewhere they did not agree to."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    from eth_account import Account

    payer = Account.create()
    new_treasury = w3.eth.accounts[4]
    usdg.functions.mint(payer.address, 10**12).transact({"from": owner})
    nonce = m.functions.subscriptionNonce(payer.address, PRO, 1).call()
    auth = _sign_auth(w3, payer, usdg, treasury, PRO_PRICE, nonce)

    m.functions.setTreasury(new_treasury).transact({"from": owner})
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": relayer,
                "to": m.address,
                "gas": 900_000,
                "data": m.encode_abi("subscribeWithAuthorization", args=[PRO, 1, 2**200, auth]),
            }
        )
    )
    assert rcpt.status == 0, "stale-treasury authorization must not settle"
    assert usdg.functions.balanceOf(new_treasury).call() == 0
    assert usdg.functions.balanceOf(treasury).call() == 0


def test_one_authorization_cannot_buy_two_tiers(mem_env):
    """The nonce commits to (subscriber, tier, periods). A relayer must not be
    able to spend an ENTERPRISE authorization on ten months of PRO, nor replay
    it after a successful settle."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 10**12).transact({"from": owner})
    nonce = m.functions.subscriptionNonce(payer.address, ENTERPRISE, 1).call()
    auth = _sign_auth(w3, payer, usdg, treasury, ENTERPRISE_PRICE, nonce)

    def send(tier, periods):
        return w3.eth.wait_for_transaction_receipt(
            w3.eth.send_transaction(
                {
                    "from": relayer,
                    "to": m.address,
                    "gas": 900_000,
                    "data": m.encode_abi(
                        "subscribeWithAuthorization", args=[tier, periods, 2**200, auth]
                    ),
                }
            )
        ).status

    assert send(PRO, 10) == 0, "redirected an ENTERPRISE authorization to PRO"
    assert send(ENTERPRISE, 1) == 1, "the honest call should settle"
    assert send(ENTERPRISE, 1) == 0, "EIP-3009 nonce was replayable"
    assert usdg.functions.balanceOf(treasury).call() == ENTERPRISE_PRICE


# ── attack 5: driving the repacked storage to its limits ─────────────────────


def test_packed_price_snapshot_cannot_truncate(mem_env):
    """The gas work narrowed pricePaidPerPeriod from uint256 to uint96 and the
    price table to uint64[4]. Drive both to their legal extremes: values must
    round-trip exactly, because a silent truncation would corrupt every later
    tier conversion."""
    w3, usdg, m, owner, treasury, relayer = mem_env

    MIN_PRICE, MAX_PRICE = 100_000, 100_000_000_000
    assert m.functions.MIN_PRICE().call() == MIN_PRICE
    assert m.functions.MAX_PRICE().call() == MAX_PRICE

    m.functions.setPrice(ENTERPRISE, MAX_PRICE).transact({"from": owner})
    assert m.functions.pricePerPeriod(ENTERPRISE).call() == MAX_PRICE, "uint64 table truncated"
    m.functions.setPrice(PRO, MIN_PRICE).transact({"from": owner})
    assert m.functions.pricePerPeriod(PRO).call() == MIN_PRICE

    buyer = w3.eth.accounts[5]
    usdg.functions.mint(buyer, MAX_PRICE * 100).transact({"from": owner})
    usdg.functions.approve(m.address, 2**200).transact({"from": buyer})

    # buy 1 period at the maximum legal price
    m.functions.subscribe(ENTERPRISE, 1, 2**200).transact({"from": buyer})
    tid = m.functions.tokenOf(buyer).call()
    _tier, expiry, snap = m.functions.membershipOf(tid).call()
    assert snap == MAX_PRICE, f"uint96 snapshot truncated: {snap} != {MAX_PRICE}"
    assert snap < 2**96

    # A 1,000,000x downward conversion would blow past MAX_TERM. The contract
    # must REFUSE it (TermCapReached) rather than clamp and take the money —
    # a paid subscribe never buys days it cannot deliver.
    before_treasury = usdg.functions.balanceOf(treasury).call()
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": buyer,
                "to": m.address,
                "gas": 900_000,
                "data": m.encode_abi("subscribe", args=[PRO, 1, 2**200]),
            }
        )
    )
    assert rcpt.status == 0, "extreme conversion must revert, not truncate"
    assert usdg.functions.balanceOf(treasury).call() == before_treasury, "charged anyway"
    _t2, expiry2, snap2 = m.functions.membershipOf(tid).call()
    assert (expiry2, snap2) == (expiry, snap), "state moved on a reverted call"

    # A conversion that stays inside MAX_TERM must work and keep the snapshot
    # inside the legal price band — no truncation, no fabricated value.
    m.functions.setPrice(PRO, MAX_PRICE // 4).transact({"from": owner})
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": buyer})
    _t3, expiry3, snap3 = m.functions.membershipOf(tid).call()
    assert snap3 < 2**96
    assert MIN_PRICE <= snap3 <= MAX_PRICE, f"snapshot escaped the band: {snap3}"
    assert expiry3 > expiry, "a 4x cheaper tier should lengthen the term"


def test_total_supply_and_treasury_share_a_slot_without_aliasing(mem_env):
    """treasury (20 bytes) and totalSupply (8) were packed together. Writing one
    must not corrupt the other."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    assert m.functions.treasury().call() == treasury
    assert m.functions.totalSupply().call() == 0

    for i, who in enumerate(w3.eth.accounts[5:8], start=1):
        m.functions.mintFree().transact({"from": who})
        assert m.functions.totalSupply().call() == i
        assert m.functions.treasury().call() == treasury, "minting corrupted treasury"

    new_treasury = w3.eth.accounts[8]
    m.functions.setTreasury(new_treasury).transact({"from": owner})
    assert m.functions.treasury().call() == new_treasury
    assert m.functions.totalSupply().call() == 3, "setTreasury corrupted totalSupply"
