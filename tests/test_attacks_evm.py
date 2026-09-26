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
    from positions_helpers import wire_payments

    usdg = wire_payments(w3, art, pos, owner, owner, alice, deploy)
    now = w3.eth.get_block("latest").timestamp
    # wallet cap 2 — the attacker's goal is to exceed it. allocation 4_444
    # (== MAX_SUPPLY), not 0: an open (no-merkle-root) priced phase now
    # requires both bounds — see OpenPhaseUnbounded in configurePhase.
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 2, 4_444, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, feed, owner, alice, art, usdg


# ── attacks on the EIP-3009 mint path ────────────────────────────────────────
#
# The ETH attack surface is GONE, not merely untested. `mint()` no longer takes
# `msg.value` and no longer refunds with a raw call, so the refund-reentrancy
# window, the underpay-by-one-wei case and the feed-band pricing edges are not
# reachable — they were tests of machinery this contract no longer contains.
# Deleting them is the honest move; what replaces them attacks the new path.
#
# Note the shape change: a contract CANNOT be the payer any more, because it
# cannot produce an EIP-712 signature. A hostile contract can only be the
# SUBMITTER, which is exactly the role we are handing to strangers on purpose.


def test_the_submitter_cannot_redirect_a_paid_card_to_itself(pos_env):
    """The relayer pays the gas and touches the payer's money. If it could take
    the card, the whole gasless design would be a theft primitive."""
    from eth_account import Account

    from positions_helpers import authorized_mint

    w3, pos, feed, owner, alice, art, usdg = pos_env
    payer = Account.create()
    usdg.functions.mint(payer.address, 1000 * 10**6).transact({"from": owner})

    authorized_mint(w3, pos, usdg, payer, PUBLIC, 0, 1, submitter=alice)

    assert pos.functions.balanceOf(payer.address).call() == 1
    assert pos.functions.balanceOf(alice).call() == 0, "the relayer took the card"


def test_an_authorization_cannot_be_settled_twice(pos_env):
    """Replay is the classic signed-payment failure: settle once, keep the
    signature, settle again."""
    from eth_account import Account

    from positions_helpers import sign_authorization

    w3, pos, feed, owner, alice, art, usdg = pos_env
    payer = Account.create()
    usdg.functions.mint(payer.address, 1000 * 10**6).transact({"from": owner})

    cost = pos.functions.quote(PUBLIC, 1).call()
    seq = pos.functions.mintSeq(payer.address).call()
    nonce = pos.functions.mintNonce(payer.address, PUBLIC, 0, 1, seq).call()
    va, vb, v, r, s_ = sign_authorization(w3, usdg, payer, pos.address, cost, nonce)
    auth = (payer.address, cost, va, vb, nonce, v, r, s_)

    ok = pos.functions.mintWithAuthorization(PUBLIC, 0, 1, 0, [], True, auth).transact(
        {"from": alice, "gas": 4_000_000}
    )
    assert w3.eth.wait_for_transaction_receipt(ok).status == 1

    replay = pos.functions.mintWithAuthorization(PUBLIC, 0, 1, 0, [], True, auth).transact(
        {"from": alice, "gas": 4_000_000}
    )
    assert w3.eth.wait_for_transaction_receipt(replay).status == 0, "authorization replayed"
    assert pos.functions.balanceOf(payer.address).call() == 1


def test_a_signature_for_one_order_cannot_settle_a_bigger_one(pos_env):
    """The nonce binds quantity. Without that, a signature for one card could be
    presented as an order for five and the payer would be charged for one."""
    from eth_account import Account

    from positions_helpers import sign_authorization

    w3, pos, feed, owner, alice, art, usdg = pos_env
    payer = Account.create()
    usdg.functions.mint(payer.address, 1000 * 10**6).transact({"from": owner})

    cost1 = pos.functions.quote(PUBLIC, 1).call()
    seq = pos.functions.mintSeq(payer.address).call()
    nonce = pos.functions.mintNonce(payer.address, PUBLIC, 0, 1, seq).call()
    va, vb, v, r, s_ = sign_authorization(w3, usdg, payer, pos.address, cost1, nonce)
    auth = (payer.address, cost1, va, vb, nonce, v, r, s_)

    bad = pos.functions.mintWithAuthorization(PUBLIC, 0, 5, 0, [], True, auth).transact(
        {"from": alice, "gas": 4_000_000}
    )
    assert w3.eth.wait_for_transaction_receipt(bad).status == 0
    assert pos.functions.balanceOf(payer.address).call() == 0


def test_a_priced_phase_cannot_be_minted_for_free(pos_env):
    """mint() is the free door. If it accepted a priced phase the payment path
    would be bypassable outright."""
    w3, pos, feed, owner, alice, art, usdg = pos_env
    r = pos.functions.mint(PUBLIC, 0, 1, 0, [], True).transact({"from": alice, "gas": 2_000_000})
    assert w3.eth.wait_for_transaction_receipt(r).status == 0
    assert pos.functions.totalSupply().call() == 0


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
            "ReceiveWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "ReceiveWithAuthorization",
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
    nonce = m.functions.nextSubscriptionNonce(payer.address, PRO, 1).call()
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


def test_treasury_rotation_cannot_be_forced_or_strand_a_payer(mem_env):
    """Two separate properties, both about the treasury the payer never signs.

    The payer authorises `to = the membership contract`, and the contract reads
    `treasury` from its own storage at settlement. So (a) a non-owner cannot
    point that anywhere, and (b) an owner rotation mid-flight routes the payment
    to the new treasury and still credits the term — the earlier design, which
    signed the treasury into the authorization, silently bricked every in-flight
    authorization whenever the treasury moved."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    from eth_account import Account

    payer = Account.create()
    new_treasury = w3.eth.accounts[4]
    usdg.functions.mint(payer.address, 10**12).transact({"from": owner})
    nonce = m.functions.nextSubscriptionNonce(payer.address, PRO, 1).call()
    auth = _sign_auth(w3, payer, usdg, m.address, PRO_PRICE, nonce)

    # (a) a relayer cannot redirect the funds
    with pytest.raises(Exception):
        m.functions.setTreasury(relayer).transact({"from": relayer})

    # (b) an owner rotation does not strand the payer
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
    assert rcpt.status == 1, "treasury rotation stranded an in-flight authorization"
    assert usdg.functions.balanceOf(new_treasury).call() == PRO_PRICE
    assert usdg.functions.balanceOf(treasury).call() == 0
    assert usdg.functions.balanceOf(m.address).call() == 0, "contract retained funds"
    assert m.functions.tokenOf(payer.address).call() != 0, "payer paid and got nothing"


def test_one_authorization_cannot_buy_two_tiers(mem_env):
    """The nonce commits to (subscriber, tier, periods). A relayer must not be
    able to spend an ENTERPRISE authorization on ten months of PRO, nor replay
    it after a successful settle."""
    w3, usdg, m, owner, treasury, relayer = mem_env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 10**12).transact({"from": owner})
    nonce = m.functions.nextSubscriptionNonce(payer.address, ENTERPRISE, 1).call()
    auth = _sign_auth(w3, payer, usdg, m.address, ENTERPRISE_PRICE, nonce)

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
    # replay is dead, but the plan itself is repurchasable: a FRESH nonce at the
    # advanced seq settles. (The first cut of this made the two indistinguishable
    # and silently made renewal impossible forever.)
    nonce2 = m.functions.nextSubscriptionNonce(payer.address, ENTERPRISE, 1).call()
    assert nonce2 != nonce
    auth = _sign_auth(w3, payer, usdg, m.address, ENTERPRISE_PRICE, nonce2)
    assert send(ENTERPRISE, 1) == 1, "renewal of the same plan must be possible"
    assert usdg.functions.balanceOf(treasury).call() == ENTERPRISE_PRICE * 2


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
