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
    m.functions.subscribe(PRO, 2, 2**200).transact({"from": alice})
    assert usdg.functions.balanceOf(treasury).call() == 2 * PRO_PRICE
    tier, _, paid = expiry_of(m, alice)
    assert tier == PRO and paid == PRO_PRICE
    assert m.functions.tierOf(alice).call()[0] == PRO


def test_tier_switch_is_value_neutral_round_trip(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    # Buy 12 periods of PRO (~360 days of PRO value)
    m.functions.subscribe(PRO, 12, 2**200).transact({"from": alice})
    _, expiry0, _ = expiry_of(m, alice)
    now = w3.eth.get_block("latest").timestamp
    # Switch up to ENTERPRISE (+1 period), then immediately back down to PRO (+1)
    m.functions.subscribe(ENTERPRISE, 1, 2**200).transact({"from": alice})
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})
    _, expiry1, _ = expiry_of(m, alice)
    # Value bought: 12+1 periods of PRO + 1 period of ENTERPRISE (in PRO-seconds)
    ent_in_pro = PERIOD * ENTERPRISE_PRICE // PRO_PRICE
    expected = now + 13 * PERIOD + ent_in_pro
    tol = 6 * (ENTERPRISE_PRICE // PRO_PRICE) + 6
    assert abs(expiry1 - expected) <= tol, "round-trip lost more than rounding dust"


def test_reprice_cannot_be_front_run_into_cheap_enterprise(env):
    """Review HIGH-3: stack PRO cheap, wait for reprice, convert ~1:1. Dead now."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})  # 720d of PRO @ 9.99
    # Owner reprices PRO to ENTERPRISE's price — the old exploit precondition.
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(ENTERPRISE, 1, 2**200).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    # Remaining PRO time must convert at its PAID price (9.99), not the new one:
    # 720d * 9.99/99.99 ≈ 71.9d of ENTERPRISE — NOT 720d.
    converted = 24 * PERIOD * PRO_PRICE // ENTERPRISE_PRICE
    assert abs(expiry - (now + converted + PERIOD)) <= 12
    assert expiry - now < 110 * DAY, "front-run yielded outsized ENTERPRISE time"


def test_price_cut_does_not_confiscate_existing_value(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(ENTERPRISE, 2, 2**200).transact({"from": alice})  # 60d @ 99.99
    m.functions.setPrice(ENTERPRISE, PRO_PRICE).transact({"from": owner})  # huge cut
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})
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
    m.functions.subscribe(ENTERPRISE, 10, 2**200).transact({"from": alice})  # 300d
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
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})
    travel(w3, PERIOD + DAY)
    assert m.functions.tierOf(alice).call()[0] == 0  # Free
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PREMIUM, 1, 2**200).transact({"from": alice})
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
        m.functions.subscribe(PRO, 1, 2**200).transact({"from": broke})
    assert m.functions.tokenOf(broke).call() == 0


def test_admin_bounds(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    with pytest.raises(Exception):
        m.functions.subscribe(PRO, 25, 2**200).transact({"from": alice})  # > MAX_PERIODS
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
    m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})  # 720d @ 9.99
    _, before, _ = expiry_of(m, alice)
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})  # 10x rise
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})  # renew 30d at new price
    _, after, _ = expiry_of(m, alice)
    assert after >= before, "existing paid time was destroyed by a price rise"
    assert abs(after - (before + PERIOD)) <= 12, "renewal should simply extend"


def test_laundering_cheap_time_through_a_renewal_does_not_beat_the_price(env):
    """The resurrection of the front-run: stack cheap PRO, reprice, renew once at
    the new price to reset the snapshot, then convert 1:1. The value-weighted
    snapshot must make this value-neutral."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})  # 720d, 239.76 USDG
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})  # +30d, 99.99 USDG
    now = w3.eth.get_block("latest").timestamp
    m.functions.subscribe(ENTERPRISE, 1, 2**200).transact({"from": alice})  # +30d, 99.99
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
    m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})
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

    m.functions.subscribe(PRO, 3, 2**200).transact({"from": alice})
    now = w3.eth.get_block("latest").timestamp
    _credit_mirror(sim, PRO, 3 * PERIOD, PRO_PRICE, now)

    m.functions.subscribe(ENTERPRISE, 2, 2**200).transact({"from": alice})
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
        sub = "test" if rel.startswith("Mock") else ""
        path = os.path.join(REPO, "contracts", sub, rel)
        actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
        assert actual == expected, f"{rel} changed — rerun the artifact build script"


def test_grant_of_a_different_tier_cannot_shrink_the_term(env):
    """Review H1: comping 7 days of ENTERPRISE onto 720 days of PRO conserved
    dollars but cut the member from 720 days to 79. Must now revert."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})  # 720d
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
    """Review M1: setPrice(PRO, 1) converted 720d of ENTERPRISE into ~2 billion
    years of PRO, with no claw-back."""
    w3, usdg, m, owner, treasury, alice, _ = env
    with pytest.raises(Exception):
        m.functions.setPrice(PRO, 1).transact({"from": owner})  # below MIN_PRICE


def test_paid_subscribe_reverts_rather_than_charging_for_undeliverable_days(env):
    """Review HIGH-3: subscribe() pulls USDG before _creditTime and used to clamp
    silently at MAX_TERM, so a member pinned at the cap could pay $239.76 for
    zero additional days, repeatedly, with no revert and no refund."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.subscribe(ENTERPRISE, 13, 2**200).transact({"from": alice})  # 390d
    m.functions.setPrice(PRO, PRO_PRICE).transact({"from": owner})
    spent_before = usdg.functions.balanceOf(treasury).call()
    # converting 390d of ENTERPRISE into PRO would exceed the 3650d cap
    with pytest.raises(Exception):
        m.functions.subscribe(PRO, 1, 2**200).transact({"from": alice})
    assert usdg.functions.balanceOf(treasury).call() == spent_before, "charged anyway"
    _, expiry, _ = expiry_of(m, alice)
    assert expiry > 0  # membership untouched


def test_stacking_into_the_cap_reverts_instead_of_destroying_days(env):
    w3, usdg, m, owner, treasury, alice, _ = env
    for _ in range(5):
        m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})  # 3600d
    with pytest.raises(Exception):  # the 6th would truncate 4320d -> 3650d
        m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})
    _, expiry, _ = expiry_of(m, alice)
    now = w3.eth.get_block("latest").timestamp
    assert 3590 * DAY < expiry - now <= 3650 * DAY


def test_grant_time_may_still_clamp_and_stays_value_coherent(env):
    """A goodwill grant must not revert on the operator, so grantTime clamps —
    but the value is scaled with the seconds so pricePaidPerPeriod cannot exceed
    MAX_PRICE and encode value no conversion could ever realise."""
    w3, usdg, m, owner, treasury, alice, _ = env
    for _ in range(5):
        m.functions.subscribe(PRO, 24, 2**200).transact({"from": alice})
    m.functions.grantTime(alice, PRO, 365 * DAY).transact({"from": owner})
    _, expiry, snap = expiry_of(m, alice)
    now = w3.eth.get_block("latest").timestamp
    assert expiry - now <= 3650 * DAY + 2, "cap not enforced"
    assert snap <= MAX_PRICE, "clamped value inflated the snapshot past MAX_PRICE"


def test_subscribe_price_bound_blocks_a_reprice_front_run(env):
    """Review HIGH-4: subscription flows use unlimited approvals, so a reprice
    landing first could pull MAX_PRICE * periods instead of the quoted amount."""
    w3, usdg, m, owner, treasury, alice, _ = env
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    before = usdg.functions.balanceOf(alice).call()
    with pytest.raises(Exception):  # caller quoted PRO_PRICE
        m.functions.subscribe(PRO, 24, PRO_PRICE).transact({"from": alice})
    assert usdg.functions.balanceOf(alice).call() == before, "funds pulled past the bound"
    # at the true price it succeeds
    m.functions.subscribe(PRO, 1, ENTERPRISE_PRICE).transact({"from": alice})
    assert usdg.functions.balanceOf(alice).call() == before - ENTERPRISE_PRICE


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


# ── x402 rail: EIP-3009 subscription (no approve, gasless-capable) ────────────


def _sign_authorization(w3, acct, usdg, to, value, nonce, valid_after=0, valid_before=None):
    """Sign an EIP-3009 TransferWithAuthorization exactly as a wallet would."""
    from eth_account.messages import encode_typed_data

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
        # Mirrors x402Networks.ts for chain 4663 — USDG's real domain.
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
            "validAfter": valid_after,
            "validBefore": valid_before,
            "nonce": nonce,
        },
    }
    signed = acct.sign_typed_data(full_message=typed)
    # eth_account returns r/s as ints; the ABI wants bytes32.
    r = signed.r.to_bytes(32, "big") if isinstance(signed.r, int) else signed.r
    s_ = signed.s.to_bytes(32, "big") if isinstance(signed.s, int) else signed.s
    return valid_after, valid_before, signed.v, r, s_


def test_subscribe_with_authorization_needs_no_approve_and_credits_the_signer(env):
    """The whole point: one signature, no approve, and a RELAYER submits it — so
    the payer needs no gas. Credit must land on the signer, not the sender."""
    w3, usdg, m, owner, treasury, alice, relayer = env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 1_000_000_000).transact({"from": owner})
    # deliberately NO approve() from payer

    periods = 2
    value = PRO_PRICE * periods
    nonce = m.functions.subscriptionNonce(payer.address, PRO, periods).call()
    va, vb, v, r, s = _sign_authorization(w3, payer, usdg, treasury, value, nonce)

    assert usdg.functions.allowance(payer.address, m.address).call() == 0
    m.functions.subscribeWithAuthorization(
        PRO,
        periods,
        2**200,
        (payer.address, value, va, vb, nonce, v, r, s),
    ).transact(
        {"from": relayer}
    )  # relayer pays gas, not the payer

    assert usdg.functions.balanceOf(treasury).call() == value
    tier, expiry, _ = expiry_of(m, payer.address)
    assert tier == PRO and expiry > w3.eth.get_block("latest").timestamp
    assert m.functions.tokenOf(relayer).call() == 0, "credited the relayer instead of the signer"


def test_authorization_intent_is_bound_into_the_nonce(env):
    """EIP-3009 signs no tier/periods field, so a relayer holding a 99.99 USDG
    authorization could otherwise hand the payer ten months of PRO instead of one
    month of ENTERPRISE. The nonce commits to the intent."""
    w3, usdg, m, owner, treasury, alice, relayer = env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 1_000_000_000).transact({"from": owner})

    value = ENTERPRISE_PRICE  # 1 period of ENTERPRISE
    nonce = m.functions.subscriptionNonce(payer.address, ENTERPRISE, 1).call()
    va, vb, v, r, s = _sign_authorization(w3, payer, usdg, treasury, value, nonce)
    auth = (payer.address, value, va, vb, nonce, v, r, s)

    # same money, relayer tries to redirect it to 10 periods of PRO
    with pytest.raises(Exception):
        m.functions.subscribeWithAuthorization(PRO, 10, 2**200, auth).transact({"from": relayer})
    # and the honest call still works
    m.functions.subscribeWithAuthorization(ENTERPRISE, 1, 2**200, auth).transact({"from": relayer})
    tier, _, _ = expiry_of(m, payer.address)
    assert tier == ENTERPRISE


def test_authorization_cannot_be_replayed(env):
    w3, usdg, m, owner, treasury, alice, relayer = env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 1_000_000_000).transact({"from": owner})
    nonce = m.functions.subscriptionNonce(payer.address, PRO, 1).call()
    va, vb, v, r, s = _sign_authorization(w3, payer, usdg, treasury, PRO_PRICE, nonce)
    auth = (payer.address, PRO_PRICE, va, vb, nonce, v, r, s)

    m.functions.subscribeWithAuthorization(PRO, 1, 2**200, auth).transact({"from": relayer})
    with pytest.raises(Exception):  # EIP-3009 nonce is single-use
        m.functions.subscribeWithAuthorization(PRO, 1, 2**200, auth).transact({"from": relayer})


def test_authorization_respects_the_price_bound(env):
    w3, usdg, m, owner, treasury, alice, relayer = env
    from eth_account import Account

    payer = Account.create()
    usdg.functions.mint(payer.address, 10_000_000_000).transact({"from": owner})
    m.functions.setPrice(PRO, ENTERPRISE_PRICE).transact({"from": owner})
    nonce = m.functions.subscriptionNonce(payer.address, PRO, 1).call()
    va, vb, v, r, s = _sign_authorization(w3, payer, usdg, treasury, ENTERPRISE_PRICE, nonce)
    auth = (payer.address, ENTERPRISE_PRICE, va, vb, nonce, v, r, s)
    with pytest.raises(Exception):
        m.functions.subscribeWithAuthorization(PRO, 1, PRO_PRICE, auth).transact({"from": relayer})


def test_python_nonce_matches_the_contract_exactly(env):
    """membership_service builds the nonce off-chain so a wallet can sign before
    broadcasting. If it disagrees with subscriptionNonce by one byte, every
    gasless subscription reverts with IntentMismatch."""
    w3, usdg, m, owner, treasury, alice, _ = env
    from bot.services.membership_service import _subscription_nonce

    for tier_index, periods in ((1, 1), (2, 7), (3, 24)):
        onchain = m.functions.subscriptionNonce(alice, tier_index, periods).call()
        offchain = _subscription_nonce(alice, tier_index, periods)
        assert onchain == offchain, (tier_index, periods)


def test_python_built_authorization_settles_on_chain(env, monkeypatch):
    """End-to-end: the payload membership_service hands a wallet, signed as-is,
    is accepted by the contract. This is the whole x402 integration in one test."""
    w3, usdg, m, owner, treasury, alice, relayer = env
    from eth_account import Account

    import bot.services.membership_service as mod
    from bot.models.subscription import SubscriptionTier

    svc = mod.MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: m.address))
    monkeypatch.setattr(type(svc), "treasury_address", property(lambda self: treasury))

    payer = Account.create()
    usdg.functions.mint(payer.address, 1_000_000_000).transact({"from": owner})

    payload = svc.build_subscription_authorization(payer.address, SubscriptionTier.PRO, 2)
    assert payload is not None
    assert payload["value"] == PRO_PRICE * 2, "price drifted from TIER_LIMITS"

    typed = dict(payload["typed_data"])
    typed["domain"] = dict(typed["domain"], chainId=w3.eth.chain_id, verifyingContract=usdg.address)
    signed = payer.sign_typed_data(full_message=typed)
    r = signed.r.to_bytes(32, "big") if isinstance(signed.r, int) else signed.r
    s_ = signed.s.to_bytes(32, "big") if isinstance(signed.s, int) else signed.s

    m.functions.subscribeWithAuthorization(
        payload["tier_index"],
        payload["periods"],
        2**200,
        (
            payer.address,
            payload["value"],
            payload["valid_after"],
            payload["valid_before"],
            bytes.fromhex(payload["nonce"][2:]),
            signed.v,
            r,
            s_,
        ),
    ).transact({"from": relayer})

    tier, _, _ = expiry_of(m, payer.address)
    assert tier == PRO
    assert usdg.functions.balanceOf(treasury).call() == PRO_PRICE * 2
