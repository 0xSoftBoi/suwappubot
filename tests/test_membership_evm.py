"""SuwappuMembership — EXECUTABLE behaviour tests on a real EVM (eth-tester/py-evm).

The money-path review's core demand: a contract that pulls USDG and does ratio
arithmetic must not ship with only source-grep tests. These deploy the actual
compiled bytecode and exercise the arithmetic:

  - tier-switch conversion is value-neutral (round-trip loses at most rounding dust)
  - setPrice CANNOT revalue outstanding time (the front-run exploit from review
    finding HIGH-3 is dead: time is valued at its purchase-price snapshot)
  - grantTime converts instead of destroying paid time (HIGH-2)
  - soulbound: transfers and approvals revert; one membership per wallet
  - subscribe on an expired token starts fresh from now
  - payment precedes minting (a failed transferFrom leaves no token behind)
"""

import json
import os

import pytest

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")

DAY = 86400
PERIOD = 30 * DAY
PRO, PREMIUM, ENTERPRISE = 1, 2, 3
PRO_PRICE, PREMIUM_PRICE, ENTERPRISE_PRICE = 9_990_000, 29_990_000, 99_990_000


@pytest.fixture()
def env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = json.load(open(ARTIFACTS))["artifacts"]
    owner, treasury, alice, bob = w3.eth.accounts[:4]

    def deploy(name, *args, frm=owner):
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        tx = c.constructor(*args).transact({"from": frm})
        rcpt = w3.eth.wait_for_transaction_receipt(tx)
        return w3.eth.contract(address=rcpt.contractAddress, abi=art[name]["abi"])

    usdg = deploy("MockUSDG")
    m = deploy("SuwappuMembership", usdg.address, treasury, owner)
    for who in (alice, bob):
        usdg.functions.mint(who, 100_000_000_000).transact({"from": owner})  # 100k USDG
        usdg.functions.approve(m.address, 2**200).transact({"from": who})
    return w3, usdg, m, owner, treasury, alice, bob


def expiry_of(m, who):
    tid = m.functions.tokenOf(who).call()
    return m.functions.membershipOf(tid).call()


def travel(w3, seconds):
    w3.provider.ethereum_tester.time_travel(w3.eth.get_block("latest").timestamp + seconds)
    w3.provider.ethereum_tester.mine_block()


# ── economics ────────────────────────────────────────────────────────────────


def test_subscribe_charges_exact_price_to_treasury(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 2).transact({"from": alice})
    assert usdg.functions.balanceOf(treasury).call() == 2 * PRO_PRICE
    tier, _, paid = expiry_of(m, alice)
    assert tier == PRO and paid == PRO_PRICE
    assert m.functions.tierOf(alice).call()[0] == PRO


def test_tier_switch_is_value_neutral_round_trip(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    # Buy 12 periods of PRO (~360 days of PRO value)
    m.functions.subscribe(PRO, 12).transact({"from": alice})
    _, expiry0, _ = expiry_of(m, alice)
    now = w3.eth.get_block("latest").timestamp
    # Switch up to ENTERPRISE (+1 period), then immediately back down to PRO (+1)
    m.functions.subscribe(ENTERPRISE, 1).transact({"from": alice})
    m.functions.subscribe(PRO, 1).transact({"from": alice})
    _, expiry1, _ = expiry_of(m, alice)
    # Value bought: 12+1 periods of PRO + 1 period of ENTERPRISE (in PRO-seconds)
    ent_in_pro = PERIOD * ENTERPRISE_PRICE // PRO_PRICE
    expected = now + 13 * PERIOD + ent_in_pro
    tol = 6 * (ENTERPRISE_PRICE // PRO_PRICE) + 6
    assert abs(expiry1 - expected) <= tol, "round-trip lost more than rounding dust"


def test_reprice_cannot_be_front_run_into_cheap_enterprise(env):
    """Review HIGH-3: stack PRO cheap, wait for reprice, convert ~1:1. Dead now."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24).transact({"from": alice})  # 720d of PRO @ 9.99
    # Owner reprices PRO to ENTERPRISE's price — the old exploit precondition.
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(ENTERPRISE, 1).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    # Remaining PRO time must convert at its PAID price (9.99), not the new one:
    # 720d * 9.99/99.99 ≈ 71.9d of ENTERPRISE — NOT 720d.
    converted = 24 * PERIOD * PRO_PRICE // ENTERPRISE_PRICE
    assert abs(expiry - (now + converted + PERIOD)) <= 12
    assert expiry - now < 110 * DAY, "front-run yielded outsized ENTERPRISE time"


def test_price_cut_does_not_confiscate_existing_value(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(ENTERPRISE, 2).transact({"from": alice})  # 60d @ 99.99
    m.functions.setPrice(ENTERPRISE, PRO_PRICE).transact({"from": owner})  # huge cut
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PRO, 1).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    # 60d valued at 99.99 → PRO at 9.99 ≈ 600d, + 30d bought.
    converted = 2 * PERIOD * ENTERPRISE_PRICE // PRO_PRICE
    # Each mined block advances time ~1s; that drift is multiplied by the price
    # ratio in the conversion, so the tolerance scales with it.
    tol = 6 * (ENTERPRISE_PRICE // PRO_PRICE) + 6
    assert abs(expiry - (now + converted + PERIOD)) <= tol


def test_grant_time_converts_instead_of_destroying_paid_time(env):
    """Review HIGH-2: comping 7d of PRO onto 300d of paid ENTERPRISE must not
    burn the ENTERPRISE value."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(ENTERPRISE, 10).transact({"from": alice})  # 300d
    now = w3.eth.get_block("latest").timestamp
    m.functions.grantTime(alice, PRO, 7 * DAY).transact({"from": owner})
    tier, expiry, _ = expiry_of(m, alice)
    assert tier == PRO
    converted = 10 * PERIOD * ENTERPRISE_PRICE // PRO_PRICE  # ≈ 3000d of PRO
    tol = 6 * (ENTERPRISE_PRICE // PRO_PRICE) + 6  # timestamp drift × price ratio
    assert abs(expiry - (now + converted + 7 * DAY)) <= tol
    assert expiry - now > 2900 * DAY, "paid ENTERPRISE time was destroyed"


def test_expired_subscription_reads_free_and_resubscribe_starts_fresh(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 1).transact({"from": alice})
    travel(w3, PERIOD + DAY)
    assert m.functions.tierOf(alice).call()[0] == 0  # Free
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PREMIUM, 1).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    assert abs(expiry - (now + PERIOD)) <= 12, "expired time must not carry over"


# ── access + soulbound ───────────────────────────────────────────────────────


def test_free_mint_once_per_wallet_and_soulbound(env):
    w3, usdg, m, owner, treasury, alice, bob = env
    m.functions.mintFree().transact({"from": alice})
    assert tuple(m.functions.tierOf(alice).call()) == (0, 0)
    with pytest.raises(Exception):
        m.functions.mintFree().transact({"from": alice})  # AlreadyMember
    tid = m.functions.tokenOf(alice).call()
    with pytest.raises(Exception):
        m.functions.transferFrom(alice, bob, tid).transact({"from": alice})  # Soulbound
    with pytest.raises(Exception):
        m.functions.approve(bob, tid).transact({"from": alice})
    with pytest.raises(Exception):
        m.functions.setApprovalForAll(bob, True).transact({"from": alice})


def test_failed_payment_leaves_no_token_behind(env):
    """Payment precedes the auto-mint (CEI): a broke wallet gets nothing."""
    w3, usdg, m, owner, treasury, alice, bob = env
    broke = w3.eth.accounts[5]
    usdg.functions.approve(m.address, 2**200).transact({"from": broke})
    with pytest.raises(Exception):
        m.functions.subscribe(PRO, 1).transact({"from": broke})
    assert m.functions.tokenOf(broke).call() == 0


def test_admin_bounds(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    with pytest.raises(Exception):
        m.functions.subscribe(PRO, 25).transact({"from": alice})  # > MAX_PERIODS
    with pytest.raises(Exception):
        m.functions.grantTime(alice, PRO, 366 * DAY).transact({"from": owner})  # > MAX_GRANT
    with pytest.raises(Exception):
        m.functions.setPrice(PRO, 0).transact({"from": owner})
    with pytest.raises(Exception):
        m.functions.renounceOwnership().transact({"from": owner})
    with pytest.raises(Exception):
        m.functions.setPrice(PRO, 1).transact({"from": alice})  # not owner


# ── regressions for bugs found in the FIX itself ─────────────────────────────


def test_same_tier_renewal_after_price_rise_does_not_shrink_paid_time(env):
    """A price increase must never shorten a subscription somebody already paid
    for. The first snapshot-pricing fix converted on same-tier renewals too,
    which collapsed 720 paid days into 72."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24).transact({"from": alice})  # 720d @ 9.99
    _, before, _ = expiry_of(m, alice)
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})  # 10x rise
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PRO, 1).transact({"from": alice})  # renew 30d at new price
    _, after, _ = expiry_of(m, alice)
    assert after >= before, "existing paid time was destroyed by a price rise"
    assert abs(after - (before + PERIOD)) <= 12, "renewal should simply extend"


def test_laundering_cheap_time_through_a_renewal_does_not_beat_the_price(env):
    """The resurrection of the front-run: stack cheap PRO, reprice, renew once at
    the new price to reset the snapshot, then convert 1:1. The value-weighted
    snapshot must make this value-neutral."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24).transact({"from": alice})  # 720d, 239.76 USDG
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    m.functions.subscribe(PRO, 1).transact({"from": alice})  # +30d, 99.99 USDG
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(ENTERPRISE, 1).transact({"from": alice})  # +30d, 99.99
    _, expiry, _ = expiry_of(m, alice)

    spent = usdg.functions.balanceOf(treasury).call()
    ent_seconds = expiry - now
    # Service received, priced at ENTERPRISE list, must not exceed what was paid.
    fair_value = ent_seconds * ENTERPRISE_PRICE // PERIOD
    assert fair_value <= spent + PRO_PRICE, (
        f"got {ent_seconds / DAY:.1f}d of ENTERPRISE (worth {fair_value / 1e6:.2f} USDG) "
        f"for {spent / 1e6:.2f} USDG"
    )
    # Analytic expectation: 750d carried at the weighted 13.59 converts to
    # 750*13.59/99.99 = 101.9d, plus the 30d just bought = ~131.9d. Anything
    # materially above that means the snapshot failed to blend.
    assert ent_seconds < 135 * DAY, f"laundering yielded {ent_seconds / DAY:.1f}d"
    assert ent_seconds > 125 * DAY, "conversion confiscated legitimately paid time"


def test_weighted_snapshot_lands_between_the_two_prices(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24).transact({"from": alice})
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    m.functions.subscribe(PRO, 1).transact({"from": alice})
    _, _, snapshot = expiry_of(m, alice)
    assert PRO_PRICE < snapshot < ENTERPRISE_PRICE, snapshot
    # 720d @9.99 + 30d @99.99 over 750d -> ~13.59 USDG
    assert abs(snapshot - 13_590_000) < 200_000, snapshot


# ── property test: the conversion must never mint value ──────────────────────


MAX_TERM = 3650 * DAY
MIN_PRICE, MAX_PRICE = 100_000, 100_000_000_000


def _credit_mirror(m, tier, duration, new_price, now):
    """Pure-Python mirror of SuwappuMembership._creditTime, integer floors and
    all. Cross-checked against the deployed bytecode in
    test_mirror_matches_the_contract below, so the property test below is
    exercising the real algorithm rather than a wish."""
    rs = rv = 0
    if m["tier"] != 0 and m["exp"] > now:
        remaining = m["exp"] - now
        old = m["snap"] or new_price
        if m["tier"] == tier:
            rs, rv = remaining, remaining * old
        else:
            rs = (remaining * old) // new_price
            rv = rs * new_price
    total = rs + duration
    if total > MAX_TERM:  # mirrors the contract's horizon cap
        total = MAX_TERM
    m.update(
        tier=tier,
        exp=now + total,
        snap=(rv + duration * new_price) // total,
    )
    return m


def test_mirror_matches_the_contract(env):
    """Guards the property test: run the same sequence on-chain and in the
    mirror and require identical expiry + snapshot."""
    w3, usdg, m, owner, treasury, alice, _ = env
    sim = {"tier": 0, "exp": 0, "snap": 0}

    m.functions.subscribe(PRO, 3).transact({"from": alice})
    now = w3.eth.get_block("latest").timestamp
    _credit_mirror(sim, PRO, 3 * PERIOD, PRO_PRICE, now)

    m.functions.subscribe(ENTERPRISE, 2).transact({"from": alice})
    now2 = w3.eth.get_block("latest").timestamp
    _credit_mirror(sim, ENTERPRISE, 2 * PERIOD, ENTERPRISE_PRICE, now2)

    tier, expiry, snap = expiry_of(m, alice)
    assert tier == ENTERPRISE
    assert abs(expiry - sim["exp"]) <= 6, (expiry, sim["exp"])
    assert abs(snap - sim["snap"]) <= 50_000, (snap, sim["snap"])


def test_conversion_never_mints_value():
    """Over thousands of random subscribe/reprice sequences, the value a holder
    carries (seconds × their price snapshot) must never exceed the USDG they
    paid. Ratio > 1 would mean the tier-conversion arithmetic creates service
    out of nothing — the failure mode that both earlier bugs shared."""
    import random

    random.seed(3)
    base = {PRO: PRO_PRICE, PREMIUM: PREMIUM_PRICE, ENTERPRISE: ENTERPRISE_PRICE}
    worst = 0.0
    for _ in range(3000):
        prices = dict(base)
        sim = {"tier": 0, "exp": 0, "snap": 0}
        now, paid = 1_000_000, 0
        for _ in range(random.randint(1, 8)):
            if random.random() < 0.18:  # owner reprices
                t = random.choice([PRO, PREMIUM, ENTERPRISE])
                # only prices setPrice would actually accept
                prices[t] = random.choice(
                    [MIN_PRICE, PRO_PRICE, PREMIUM_PRICE, ENTERPRISE_PRICE, MAX_PRICE]
                )
            else:
                t = random.choice([PRO, PREMIUM, ENTERPRISE])
                n = random.randint(1, 24)
                paid += prices[t] * n
                _credit_mirror(sim, t, n * PERIOD, prices[t], now)
                now += random.randint(0, 5 * DAY)
        held = max(0, sim["exp"] - now)
        if paid:
            worst = max(worst, (held * sim["snap"] // PERIOD) / paid)
    assert worst <= 1.001, f"conversion minted value: held/paid = {worst:.4f}"


def test_max_term_truncation_is_value_neutral():
    """Truncating totalSeconds at MAX_TERM keeps the FULL value in the snapshot
    numerator, so seconds x snapshot is preserved — the cap compresses cheap time
    into fewer, dearer seconds rather than confiscating or minting it."""
    now = 1_000_000
    sim = {"tier": 0, "exp": 0, "snap": 0}
    paid = MAX_PRICE * 24
    _credit_mirror(sim, PRO, 24 * PERIOD, MAX_PRICE, now)
    paid += MIN_PRICE
    _credit_mirror(sim, PREMIUM, PERIOD, MIN_PRICE, now)  # forces truncation
    assert sim["exp"] - now == MAX_TERM, "cap did not engage"
    held_value = (sim["exp"] - now) * sim["snap"] // PERIOD
    assert held_value <= paid, "truncation minted value"
    assert held_value > paid * 0.98, "truncation confiscated value"


def test_artifacts_match_current_sources():
    """The EVM tests deploy a committed bytecode blob. If it drifts from the
    .sol sources the whole suite goes green against stale code, so pin it:
    rebuild with `node scripts/build_contract_test_artifacts.js`."""
    import hashlib

    doc = json.load(open(ARTIFACTS))
    for rel, expected in doc["sourceHashes"].items():
        path = os.path.join(REPO, "contracts", "test" if rel == "MockUSDG.sol" else "", rel)
        actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
        assert actual == expected, f"{rel} changed — rerun the artifact build script"


def test_grant_of_a_different_tier_cannot_shrink_the_term(env):
    """Review H1: comping 7 days of ENTERPRISE onto 720 days of PRO conserved
    dollars but cut the member from 720 days to 79. Must now revert."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24).transact({"from": alice})  # 720d
    _, before, _ = expiry_of(m, alice)
    with pytest.raises(Exception):
        m.functions.grantTime(alice, ENTERPRISE, 7 * DAY).transact({"from": owner})
    _, after, _ = expiry_of(m, alice)
    assert after == before, "a goodwill grant must never shorten the term"
    # same-tier goodwill still works and extends
    m.functions.grantTime(alice, PRO, 7 * DAY).transact({"from": owner})
    _, extended, _ = expiry_of(m, alice)
    assert extended > before


def test_price_floor_blocks_the_infinite_term_window(env):
    """Review M1: setPrice(PRO, 1) for one block converted 720d of ENTERPRISE
    into ~2 billion years of PRO, with no claw-back."""
    w3, usdg, m, owner, treasury, alice, _ = env
    with pytest.raises(Exception):
        m.functions.setPrice(PRO, 1).transact({"from": owner})
    m.functions.subscribe(ENTERPRISE, 24).transact({"from": alice})
    m.functions.setPrice(PRO, 100_000).transact({"from": owner})  # the legal floor
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PRO, 1).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    # +2s tolerance: `now` is read before the tx, so the block timestamp the
    # contract caps against is a second or two later.
    assert expiry - now <= 3650 * DAY + 2, "MAX_TERM horizon not enforced"
    # and the cap is genuinely load-bearing: without it this would be ~1,970 years
    assert expiry - now > 3000 * DAY


def test_mint_does_not_require_erc721_receiver(env):
    """Review M2: _safeMint would lock out any ERC-4337 smart account missing
    onERC721Received — the exact wallet class this targets."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuMembership.sol")).read()
    code = "\n".join(ln for ln in sol.split("\n") if not ln.strip().startswith(("//", "///", "*")))
    assert "_mint(to, tokenId);" in code
    assert "_safeMint" not in code


def test_conversion_never_confiscates_beyond_the_price_ratio():
    """Companion to the value-creation bound: a regression that zeroed retained
    time would pass that test but fail this one."""
    now = 1_000_000
    sim = {"tier": 0, "exp": 0, "snap": 0}
    _credit_mirror(sim, PRO, 24 * PERIOD, PRO_PRICE, now)
    held_before = sim["exp"] - now
    _credit_mirror(sim, ENTERPRISE, PERIOD, ENTERPRISE_PRICE, now)
    retained = sim["exp"] - now - PERIOD
    expected = held_before * PRO_PRICE // ENTERPRISE_PRICE
    assert retained >= expected - 2, "retained time was confiscated"
