"""Suwappu Positions — collection integrity + fee/perk wiring.

The failure that would matter most in production: the contract stores a ticker
INDEX, and position_cards_service resolves a symbol to an index independently. If
those two orderings ever diverge, every card silently points at the wrong
company. That is asserted here against the deploy args themselves.
"""

import ast
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import time

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POS = os.path.join(REPO, "nft", "position-cards")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


render = _load("positions_render", os.path.join(POS, "render.py"))
deploy_args = _load("positions_args", os.path.join(POS, "build_deploy_args.py"))


def registry():
    src = open(os.path.join(REPO, "bot", "config", "tokens.py")).read()
    m = re.search(
        r"ROBINHOOD_EQUITIES: dict\[str, tuple\[str, int, str\]\] = (\{.*?\n\})", src, re.S
    )
    return ast.literal_eval(m.group(1))


# ── 1. the collection tracks the canonical registry ───────────────────────────


def feeds():
    return json.load(open(os.path.join(POS, "feeds.json")))["feeds"]


def test_caps_cover_priced_tickers_and_sum_to_supply():
    cfg = render.load_config()
    caps = cfg["ticker_caps"]
    assert sorted(caps) == sorted(feeds()), "caps must cover exactly the priced tickers"
    assert sum(caps.values()) == cfg["collection"]["supply"] == 4_444
    assert min(caps.values()) > 0, "a ticker with cap 0 could never be minted"


def test_every_collection_ticker_has_a_verified_feed():
    """A position on an unpriced ticker could never show a return."""
    reg, fd = registry(), feeds()
    assert len(fd) == 35
    for t, f in fd.items():
        assert t in reg, f"{t} has a feed but is not in ROBINHOOD_EQUITIES"
        assert f["token"].lower() == reg[t][0].lower(), f"{t} feed points at the wrong ERC-20"
        assert f["aggregator"].startswith("0x") and len(f["aggregator"]) == 42
        assert f["feed_decimals"] == 8
        assert f["heartbeat_s"] > 0
        # description() was read on-chain and must name the ticker
        norm = f["description"].upper().replace("ROBINHOOD", "").replace("RH", "")
        norm = norm.replace("/", "").replace("-", "").replace(" ", "")
        assert norm.startswith(t.upper()), f"{t} feed describes itself as {f['description']}"


def test_sectors_cover_priced_tickers_exactly():
    cfg = render.load_config()
    mapped = [t for v in cfg["sectors"].values() for t in v]
    assert sorted(mapped) == sorted(feeds())
    assert len(mapped) == len(set(mapped))
    assert set(cfg["sectors"]) == set(cfg["sector_colors"])


def test_renderer_reads_the_live_registry():
    assert render.load_registry() == registry()


# ── 2. the ordering the whole system depends on ───────────────────────────────


def test_deploy_args_match_priced_order():
    tickers, caps, tokens, total, aggs = deploy_args.build()
    reg, fd = registry(), feeds()
    assert tickers == sorted(fd)
    assert total == 4_444
    assert len(caps) == len(tokens) == len(aggs) == 35
    for i, t in enumerate(tickers):
        assert tokens[i] == reg[t][0], f"{t} mapped to the wrong ERC-20"
        assert aggs[i] == fd[t]["aggregator"], f"{t} mapped to the wrong Chainlink feed"


def test_service_ticker_index_matches_deploy_args_exactly():
    """The index the bot resolves MUST equal the contract's array index.

    This is the highest-consequence invariant in the collection: if the two
    orderings diverge, every card silently points at the wrong company.
    """
    from bot.services.position_cards_service import PRICED_TICKERS, position_cards_service

    tickers, _caps, _tokens, _total, _aggs = deploy_args.build()
    assert PRICED_TICKERS == tickers, "service ticker order has drifted from deploy args"
    for i, symbol in enumerate(tickers):
        assert position_cards_service.ticker_index(symbol) == i
    assert position_cards_service.ticker_index("NOTATICKER") is None
    # an unpriced equity must NOT resolve — it is not in the collection
    assert position_cards_service.ticker_index("AAOI") is None


@pytest.mark.skipif(
    not os.path.exists(os.path.join(POS, "deploy_args.json")),
    reason="deploy_args.json not built",
)
def test_committed_deploy_args_are_fresh():
    tickers, caps, tokens, _total, aggs = deploy_args.build()
    on_disk = json.load(open(os.path.join(POS, "deploy_args.json")))
    assert on_disk["ticker_order"] == tickers, "run build_deploy_args.py — args are stale"
    assert on_disk["caps"] == caps
    assert on_disk["tokens"] == tokens
    assert on_disk["aggregators"] == aggs


def test_contract_ticker_count_matches_collection():
    """SuwappuPositions hardcodes array sizes; they must match the priced set."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    n = len(feeds())
    assert f"TICKER_COUNT = {n};" in sol
    assert f"uint16[{n}] public tickerCap;" in sol
    assert f"address[{n}] public tickerToken;" in sol


# ── 3. the card renders real state, never invented state ──────────────────────


def test_return_and_grade_track_real_prices():
    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 1, "NVDA", entry=100.0, price=200.0, rank=7)
    assert "+100.0%" in svg
    # The grade is STRUCK INTO THE SEAL, so it is set in caps. Compare
    # case-insensitively: the durable property is that the card states its
    # grade, not which case the seal happens to use.
    assert "multiple" in svg.lower()  # 10,000 bps
    down = render.render_card(cfg, reg, 2, "NVDA", entry=100.0, price=50.0, rank=8)
    assert "−50.0%" in down
    assert "underwater" in down.lower()


def test_unpriced_card_claims_no_return():
    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 3, "TSLA", entry=None, price=None, rank=99)
    assert "unpriced" in svg.lower()
    assert "RETURN SINCE ENTRY" not in svg, "unpriced card must not show a return figure"
    # No basis was stamped, so the plate must say so rather than imply a flat 0%.
    assert "NO BASIS STAMPED" in svg
    # Look for a RENDERED figure, not any '%' anywhere: startOffset="50%" is an
    # SVG attribute and matched the naive check, which is a false positive, not
    # a leak. Percentages only ever appear as the hero numeral's text node.
    import re

    assert not re.search(r">[+\u2212-]?\d+(\.\d+)?%<", svg), "a return figure leaked"
    priced = render.render_card(cfg, reg, 4, "TSLA", entry=100.0, price=130.0, rank=99)
    assert re.search(r">[+\u2212-]?\d+(\.\d+)?%<", priced), "the check cannot detect a figure"
    meta = render.build_metadata(cfg, reg, 3, "TSLA", None, None, 99)
    assert meta["name"].endswith("Unpriced")
    assert all(a["trait_type"] != "Return %" for a in meta["attributes"])


def test_metadata_never_claims_equity_or_payout():
    cfg, reg = render.load_config(), render.load_registry()
    meta = render.build_metadata(cfg, reg, 1, "AAPL", 100.0, 130.0, 12)
    d = meta["properties"]["disclaimer"]
    for phrase in ("NOT equity", "NOT a security", "pays nothing"):
        assert phrase.lower() in d.lower(), phrase
    assert meta["properties"]["chain_id"] == 4663
    assert meta["properties"]["underlying_erc20"] == reg["AAPL"][0]


def test_early_mint_badges_are_rank_ordered():
    """Rescaled to 4,444 supply — economics.early_mint_badge_ranks: Founder 222,
    Early 888 (same 5% / 20% proportions as the old 500/2000 thresholds)."""
    cfg = render.load_config()
    assert render.badge_for(cfg, 1) == "Founder"
    assert render.badge_for(cfg, 222) == "Founder"
    assert render.badge_for(cfg, 223) == "Early"
    assert render.badge_for(cfg, 888) == "Early"
    assert render.badge_for(cfg, 889) is None


# ── 4. the fee wiring ─────────────────────────────────────────────────────────


def test_positions_discount_stacks_and_respects_the_floor(monkeypatch):
    from bot.models.subscription import SubscriptionTier
    from bot.services.fee_service import ABSOLUTE_FLOOR, MIN_EFFECTIVE_FEE_RATE, FeeService

    svc = FeeService()
    monkeypatch.setattr(svc, "_active_fee_discount_fraction", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: 0.0)
    base = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)

    # 40% proportional discount off the FREE rate (100bps -> 60bps)
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: 0.40)
    discounted = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert discounted == pytest.approx(base * 0.60)
    assert discounted > 0

    # An absurd fraction must still floor. FREE is a self-serve tier, so it
    # floors at the contracted-pricing floor (the ENTERPRISE rate) — a consumer
    # perk may match what an ENTERPRISE customer negotiated but never beat it.
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: 99.0)
    floored = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert floored == MIN_EFFECTIVE_FEE_RATE
    assert svc.get_fee_bps(SubscriptionTier.FREE, user_id=1) > 0

    # ABSOLUTE_FLOOR sits below that and is, by design, currently UNREACHABLE:
    # every self-serve path stops at MIN_EFFECTIVE_FEE_RATE, and the only route
    # under it (ENTERPRISE + referee rebate) lands at 9bps. It is kept as
    # defence-in-depth — the guarantee that no future multiplicative perk, or
    # corrupt cached value, can drive the charged fee to zero and silently zero
    # the referral fee-share and treasury split with it. Asserted as an ordering
    # invariant rather than a reachable value, so it cannot rot into a lie.
    assert ABSOLUTE_FLOOR < MIN_EFFECTIVE_FEE_RATE
    assert floored > ABSOLUTE_FLOOR


def test_discount_is_zero_when_unconfigured(monkeypatch):
    from bot.services.position_cards_service import position_cards_service

    monkeypatch.setattr(
        type(position_cards_service), "contract_address", property(lambda self: None)
    )
    assert position_cards_service.enabled is False
    assert position_cards_service.get_cached_discount_fraction_for_user(1) == 0.0


def test_cached_discount_is_clamped_and_expires(monkeypatch):
    import time as _t

    from bot.services import position_cards_service as mod

    svc = mod.PositionCardsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    # A absurd cached fraction (a free swap) must be clamped, not honoured.
    svc._user_discount[7] = (_t.time(), 9.99)
    assert svc.get_cached_discount_fraction_for_user(7) == mod.MAX_CARD_DISCOUNT_FRACTION

    svc._user_discount[8] = (_t.time() - 10_000, 0.40)  # expired
    assert svc.get_cached_discount_fraction_for_user(8) == 0.0


def _positions_src():
    return open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()


def test_config_contract_and_backstop_all_agree_on_the_discount():
    """config.json, the contract default, and the service clamp must not drift.

    Three files independently encode this one number and each is easy to edit
    alone: nft/position-cards/config.json (the documented perk), the on-chain
    default in SuwappuPositions.sol, and the Python clamp that bounds whatever
    the contract reports. Editing any one without the others silently changes
    what holders are charged, so pin them together here.

    Note the on-chain unit: holdDiscountFractionBps is basis points OF THE TIER
    RATE (4000 == 40% off the rate), NOT basis points of the swap. That
    distinction is the bug this whole change fixed — see
    fee_service.get_fee_decimal.
    """
    import re

    from bot.services.position_cards_service import MAX_CARD_DISCOUNT_FRACTION

    cfg_fraction = render.load_config()["economics"]["hold_discount_fraction"]

    src = _positions_src()
    m = re.search(r"uint16\s+public\s+holdDiscountFractionBps\s*=\s*(\d+)\s*;", src)
    assert m, "holdDiscountFractionBps default not found in SuwappuPositions.sol"
    on_chain_fraction = int(m.group(1)) / 10_000.0

    cap = re.search(
        r"uint16\s+public\s+constant\s+MAX_HOLD_DISCOUNT_FRACTION_BPS\s*=\s*(\d+)\s*;", src
    )
    assert cap, "MAX_HOLD_DISCOUNT_FRACTION_BPS not found in SuwappuPositions.sol"
    on_chain_cap = int(cap.group(1)) / 10_000.0

    assert cfg_fraction == on_chain_fraction == 0.40
    # The clamp must bound the perk, and must agree with the on-chain cap — if the
    # two caps diverge, one of them is silently doing nothing.
    assert cfg_fraction <= MAX_CARD_DISCOUNT_FRACTION
    assert on_chain_cap == MAX_CARD_DISCOUNT_FRACTION


def test_config_contract_and_backstop_all_agree_on_the_gold_discount():
    """Same three-way pin as the base rate, for Founders' Gold: config.json,
    the on-chain default, and the service clamp must not drift independently."""
    import re

    from bot.services.position_cards_service import MAX_CARD_DISCOUNT_FRACTION

    cfg_fraction = render.load_config()["economics"]["gold_discount_fraction"]

    src = _positions_src()
    m = re.search(r"uint16\s+public\s+goldDiscountFractionBps\s*=\s*(\d+)\s*;", src)
    assert m, "goldDiscountFractionBps default not found in SuwappuPositions.sol"
    on_chain_fraction = int(m.group(1)) / 10_000.0

    assert cfg_fraction == on_chain_fraction == 0.55
    # Gold must beat base but stay inside the same ceiling as the base rate —
    # a Gold discount above MAX_HOLD_DISCOUNT_FRACTION_BPS would let an owner
    # exceed the bound the base rate is held to.
    hold_fraction = render.load_config()["economics"]["hold_discount_fraction"]
    assert hold_fraction < cfg_fraction <= MAX_CARD_DISCOUNT_FRACTION
    cap = re.search(
        r"uint16\s+public\s+constant\s+MAX_HOLD_DISCOUNT_FRACTION_BPS\s*=\s*(\d+)\s*;", src
    )
    assert int(cap.group(1)) / 10_000.0 >= on_chain_fraction


# ── 5. the oracle ─────────────────────────────────────────────────────────────


def _oracle_src():
    return open(os.path.join(REPO, "contracts", "RobinhoodChainlinkOracle.sol")).read()


def test_oracle_never_reverts_on_failure_paths():
    """SuwappuPositions treats 0 as 'unpriced'; a reverting oracle would brick minting."""
    src = _oracle_src()
    # every external aggregator/token call must be wrapped
    assert src.count("try ") >= 4, "external calls must be inside try/catch"
    assert "catch {\n            return 0;" in src or "} catch {" in src
    # priceOf must be a view that returns a uint, not something that can revert loudly
    assert "function priceOf(address token) external view returns (uint256)" in src
    for guard in (
        "if (f.aggregator == address(0)) return 0;",
        "if (!sequencerOk()) return 0;",
        "if (answer <= 0 || updatedAt == 0) return 0;",
    ):
        assert guard in src, guard


def test_oracle_normalises_decimals_to_1e18():
    src = _oracle_src()
    assert "if (f.decimals < 18) return price * (10 ** (18 - f.decimals));" in src
    assert "if (f.decimals > 18) return price / (10 ** (f.decimals - 18));" in src
    # decimals must be read from the feed, never hardcoded
    assert "AggregatorV3Interface(aggregators[i]).decimals()" in src


def test_oracle_does_not_double_apply_the_multiplier():
    """Chainlink already reports total-return value, so scaling a PRICE by
    uiMultiplier would inflate every quote.

    The oracle now reads the multiplier deliberately — `multiplierOf` exposes it
    so a stored entry price can be restated when a licensed equity splits — so
    the check is no longer "the identifier must not appear". It is the precise
    invariant: `priceOf` must never multiply by it. A blunt source grep could
    not tell the two apart, and would have blocked the corporate-action work
    while still passing on a real double-apply written a line lower.
    """
    src = _oracle_src()
    start = src.index("function priceOf(")
    # priceOf only — multiplierOf now sits between it and debugPrice, so slicing
    # to debugPrice would swallow the very function this is allowed to have.
    body = src[start : src.index("\n    function ", start + 10)]  # noqa: E203
    assert "uiMultiplier" not in body, "priceOf must not touch the multiplier"
    assert "multiplierOf" not in body, "priceOf must not touch the multiplier"
    # ...and it is still available to callers that need the basis, not the price
    assert "function multiplierOf(address token)" in src
    # uint96, not uint64: the oracle clamps to 1e21 and uint64 tops out at
    # ~1.845e19, so the old return type silently wrapped a 20:1 split.
    assert "returns (uint96)" in src
    assert "SafeCast.toUint96(m)" in src, "the narrowing cast must be checked, not raw"


def test_oracle_staleness_window_covers_a_weekend():
    """24/5 equity feeds go quiet over weekends; a tight bound blanks every card."""
    src = _oracle_src()
    assert "DEFAULT_MAX_AGE = 3 days" in src
    assert "DISPLAY ORACLE" in src.upper(), "the display-only limitation must stay documented"


def test_feeds_json_records_no_sequencer_feed_available():
    doc = json.load(open(os.path.join(POS, "feeds.json")))
    assert doc["_sequencer_uptime_feed"].startswith("NONE")
    assert "sequencerUptimeFeed" in _oracle_src(), "the hook must still exist for when one ships"


def test_prices_are_quoted_in_usd_not_usdg():
    """All Robinhood equity feeds are <TICKER>/USD; labelling them USDG is wrong."""
    doc = json.load(open(os.path.join(POS, "feeds.json")))
    assert "USD" in doc["_quote"]
    cfg, reg = render.load_config(), render.load_registry()
    meta = render.build_metadata(cfg, reg, 1, "NVDA", 92.11, 219.32, 1)
    assert "USDG" not in meta["description"]
    svg = render.render_card(cfg, reg, 1, "NVDA", 92.11, 219.32, 1)
    assert "USDG" not in svg


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_CHAIN_TESTS") != "1",
    reason="set RUN_LIVE_CHAIN_TESTS=1 to hit Robinhood Chain RPC",
)
def test_committed_feeds_are_live_on_chain():
    """Full live re-verification. Opt-in so CI stays hermetic."""
    rc = subprocess.run(
        [sys.executable, os.path.join(POS, "verify_feeds.py")],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, rc.stdout + rc.stderr


# ── 6. the allowlist ──────────────────────────────────────────────────────────

merkle = _load("positions_merkle", os.path.join(POS, "merkle.py"))
allowlist = _load("positions_allowlist", os.path.join(POS, "build_allowlist.py"))


def test_keccak_and_leaf_encoding_are_pinned():
    """Any drift here invalidates every proof on-chain. Vectors cross-checked
    against js-sha3 and against the contract's own encoding."""
    assert (
        merkle.keccak256(b"").hex()
        == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )
    leaf = merkle.leaf_for("0x" + "11" * 20, 3)
    assert "0x" + leaf.hex() == "0x1c3da2d94786e8c2ec61d770e9d5e6131d7b311970ef5d64dc882d2c11be0f02"
    pair = merkle._hash_pair(leaf, merkle.leaf_for("0x" + "22" * 20, 2))
    assert "0x" + pair.hex() == "0x35e58ada13797da3efb195f169aae08513a8df0a33e9d9cfd2c143d2832abaea"


def test_contract_rebuilds_the_leaf_from_the_authenticated_minter():
    """The one rule that makes an allowlist safe: a proof must be useless to
    anyone but its owner, so the leaf cannot be built from attacker calldata.

    The leaf is built from `minter`, which is `msg.sender` on the free path and
    `auth.from` on the paid one. `auth.from` LOOKS like calldata and is not: USDG
    recovers the EIP-712 signature inside `receiveWithAuthorization` and reverts
    unless it was signed by that exact address, and the USDG is debited from that
    address's balance. A relayer therefore cannot name a victim as the minter.

    Nor can it escalate an honest payer's grant: the leaf commits to (minter,
    maxQty) together, so presenting a larger `maxQty` needs a valid proof for
    that larger grant, which exists only if the allowlist actually issued it.
    """
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    assert "keccak256(bytes.concat(keccak256(abi.encode(minter, maxQty))))" in sol
    assert "MerkleProof.verify(proof, cfg.merkleRoot, leaf)" in sol
    # the payer, never the submitter, is the minter on the paid path
    assert "_mintChecked(auth.from," in sol


def test_proofs_verify_and_do_not_transfer_between_wallets():
    entries = [("0x" + f"{i:040x}", (i % 3) + 1) for i in range(1, 60)]
    leaves = [merkle.leaf_for(a, q) for a, q in entries]
    layers = merkle.build_tree(leaves)
    root = merkle.root_of(layers)

    for addr, qty in entries:
        leaf = merkle.leaf_for(addr, qty)
        assert merkle.verify(merkle.proof_for(layers, leaf), root, leaf)

    # same proof, different wallet -> must fail
    proof = merkle.proof_for(layers, leaves[0])
    assert not merkle.verify(proof, root, merkle.leaf_for(entries[1][0], entries[0][1]))
    # same wallet, inflated grant -> must fail
    assert not merkle.verify(proof, root, merkle.leaf_for(entries[0][0], 99))


def test_builder_refuses_an_allowlist_larger_than_its_allocation():
    """An allowlist bigger than the supply behind it is a race dressed as a
    guarantee — the classic 2021-22 gas-war setup."""
    entries = [("0x" + f"{i:040x}", 3) for i in range(1, 101)]  # 300 grants
    with pytest.raises(SystemExit) as e:
        allowlist.build_phase("Founder", entries, allocation=100, oversubscribe=False)
    assert "race, not a guarantee" in str(e.value)
    # explicit opt-in still works
    art = allowlist.build_phase("Founder", entries, allocation=100, oversubscribe=True)
    assert art["granted_cards"] == 300 and art["allocation"] == 100


def test_builder_dedupes_and_keeps_the_largest_grant():
    entries = [("0x" + "11" * 20, 1), ("0x" + "11" * 20, 3), ("0x" + "22" * 20, 2)]
    art = allowlist.build_phase("Allowlist", entries, allocation=100, oversubscribe=False)
    assert art["addresses"] == 2
    assert art["granted_cards"] == 5  # 3 + 2, not 1 + 3 + 2


def test_phase_allocations_fit_the_supply():
    cfg = render.load_config()
    mint = cfg["mint"]
    total = sum(p["allocation"] for p in mint["phases"].values()) + mint["team_reserve"]
    assert total == cfg["collection"]["supply"] == 4_444


def test_team_reserve_is_bounded_on_chain():
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    cfg = render.load_config()
    assert f"RESERVE_MAX = {cfg['mint']['team_reserve']};" in sol
    assert "if (reserveMinted + quantity > RESERVE_MAX) revert ReserveExhausted();" in sol


def test_supply_and_reserve_constants_match_config():
    import re

    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    cfg = render.load_config()
    m = re.search(r"MAX_SUPPLY = ([\d_]+);", sol)
    assert m, "MAX_SUPPLY not found in SuwappuPositions.sol"
    assert int(m.group(1).replace("_", "")) == cfg["collection"]["supply"] == 4444
    assert "RESERVE_MAX = 45;" in sol
    # scaled down from 50 for the smaller supply — the widest single-phase
    # grant (Public, walletCap 5) plus headroom for minting across phases
    assert "MAX_PER_WALLET = 20;" in sol


def test_gold_phase_is_appended_at_the_end_of_the_enum():
    """Founder/Allowlist/Public must keep their existing indices (1/2/3) —
    config.json's phase `index` values are the contract enum ordinals, and
    latecomers to an already-configured phase would be silently redirected if
    the enum were reordered instead of appended to."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    assert "enum Phase { Closed, Founder, Allowlist, Public, Gold }" in sol
    cfg = render.load_config()["mint"]["phases"]
    assert (cfg["Founder"]["index"], cfg["Allowlist"]["index"], cfg["Public"]["index"]) == (
        1,
        2,
        3,
    )
    assert cfg["Gold"]["index"] == 4


def test_gold_is_stamped_at_mint_and_tracked_per_holder():
    """Gold is earned by minting in Phase.Gold, never by transferring a card in
    — struct field, `goldBalance` mapping, and the `_update` hook that keeps it
    live across mint/transfer/burn must all exist together."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    assert "bool isGold;" in sol
    assert "function isGold(uint256 tokenId) public view returns (bool)" in sol
    assert "mapping(address => uint256) public goldBalance;" in sol
    assert "function _update(address to, uint256 tokenId, address auth)" in sol
    assert "if (from != address(0)) goldBalance[from] -= 1;" in sol
    assert "if (to != address(0)) goldBalance[to] += 1;" in sol
    # stamped from the phase the mint actually ran in, not trusted from calldata
    assert "phase == Phase.Gold" in sol


def test_discount_for_prefers_gold_and_needs_no_token_ids():
    """The bot's discount lookup now calls discountFor(address) directly —
    goldBalance/balanceOf are native ERC-721 state, so a stale indexer can no
    longer under-count a Gold holder's perk."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    assert "function discountFor(address holder) external view returns (uint16)" in sol
    assert "if (goldBalance[holder] > 0) return goldDiscountFractionBps;" in sol
    assert "if (balanceOf(holder) > 0) return holdDiscountFractionBps;" in sol

    src = open(os.path.join(REPO, "bot", "services", "position_cards_service.py")).read()
    assert "discountFor" in src
    assert "discountFractionBpsFor" not in src, "service must not still call the old ABI"


def test_royalty_is_set_by_default_in_the_constructor():
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    cfg = render.load_config()
    assert f"_setDefaultRoyalty(initialOwner, {cfg['economics']['royalty_bps']});" in sol


def test_no_tx_origin_bot_gate():
    """tx.origin locks out Safe and every AA wallet and stops no real bot."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    body = sol.split("contract SuwappuPositions", 1)[1]
    code = "\n".join(ln for ln in body.split("\n") if not ln.strip().startswith("///"))
    assert "tx.origin" not in code


def test_bot_eligibility_matches_the_snapshot_classifier():
    """If the bot's thresholds drift from the builder's, users are promised a
    spot the contract then denies."""
    from bot.services import position_cards_service as mod

    cases = [
        ({"xp_level": "gold", "total_volume_usd": 0, "total_swaps": 0, "referrals": 0}, "Founder"),
        (
            {"xp_level": "bronze", "total_volume_usd": 60000, "total_swaps": 0, "referrals": 0},
            "Founder",
        ),
        (
            {"xp_level": "bronze", "total_volume_usd": 0, "total_swaps": 0, "referrals": 6},
            "Founder",
        ),
        (
            {"xp_level": "bronze", "total_volume_usd": 0, "total_swaps": 9, "referrals": 0},
            "Allowlist",
        ),
        (
            {"xp_level": "bronze", "total_volume_usd": 2500, "total_swaps": 0, "referrals": 0},
            "Allowlist",
        ),
        ({"xp_level": "bronze", "total_volume_usd": 10, "total_swaps": 1, "referrals": 0}, None),
    ]
    for row, expected in cases:
        assert allowlist.classify(row) == expected, row

    assert mod.FOUNDER_LEVELS == ("gold", "platinum", "diamond")
    assert mod.FOUNDER_VOLUME_USD == 50_000
    assert mod.FOUNDER_REFERRALS == 5
    assert mod.ALLOWLIST_SWAPS == 5
    assert mod.ALLOWLIST_VOLUME_USD == 1_000
    assert mod.ALLOWLIST_REFERRALS == 1


# ── 8. the perk actually fires ────────────────────────────────────────────────


def test_ticker_xp_boost_is_applied_to_awarded_points():
    """The card art prints '+25% XP' and the metadata promises it. Before this,
    get_ticker_xp_boost_bps had ZERO call sites — the utility was advertised and
    never applied."""
    from bot.services.points_service import PointsService

    svc = PointsService()
    # $1,000 swap -> 100 base points; a 2500 bps boost must add 25.
    assert svc.MAX_TICKER_BOOST_BPS == 3500

    src = open(os.path.join(REPO, "bot", "services", "points_service.py")).read()
    assert "base_points += (base_points * boost) // 10_000" in src
    # clamped and floored, so a bad read cannot mint XP
    assert "boost = max(0, min(int(ticker_boost_bps or 0), self.MAX_TICKER_BOOST_BPS))" in src
    # the streak bonus must NOT be multiplied
    idx_boost = src.index("base_points += (base_points * boost)")
    idx_streak = src.index('total_points += POINT_ACTIONS["first_swap_daily"]["points"]')
    assert idx_boost < idx_streak, "boost must apply to volume points only"


def test_boost_is_wired_on_both_swap_paths():
    """A perk that only fires on single swaps gets reported as broken."""
    for handler in ("swap.py", "bulk_swap.py"):
        src = open(os.path.join(REPO, "bot", "handlers", handler)).read()
        assert "position_cards_service.swap_xp_boost_bps(" in src, handler
        assert "ticker_boost_bps=ticker_boost" in src, handler


def test_boost_checks_both_sides_of_the_trade():
    """Buying AAPL with USDG and selling it back are both 'swapping AAPL'."""
    import inspect

    from bot.services.position_cards_service import PositionCardsService

    src = inspect.getsource(PositionCardsService.swap_xp_boost_bps)
    assert "for symbol in (from_symbol, to_symbol):" in src
    # non-card tickers must not cost an RPC
    assert "if self.ticker_index(symbol) is None:" in src


def test_fee_discount_reaches_the_charged_bps_end_to_end(monkeypatch):
    """The perk is only real if it changes the number the swap actually charges.
    Walks the whole chain: cached discount -> get_fee_decimal -> get_fee_bps,
    which is what is passed on-chain as platformFeeBps."""
    import time as _t

    from bot.models.subscription import SubscriptionTier
    from bot.services import position_cards_service as mod
    from bot.services.fee_service import MIN_EFFECTIVE_FEE_RATE, FeeService

    svc = FeeService()
    monkeypatch.setattr(svc, "_active_fee_discount_fraction", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    monkeypatch.setattr(
        type(mod.position_cards_service),
        "contract_address",
        property(lambda self: "0x" + "11" * 20),
    )
    # 0.40 == 40% off the tier rate (a FRACTION, not bps of the swap).
    mod.position_cards_service._user_discount[321] = (_t.time(), 0.40)

    base_bps = 0
    monkeypatch.setattr(svc, "_positions_discount_fraction", lambda uid: 0.0)
    base_bps = svc.get_fee_bps(SubscriptionTier.FREE, user_id=321)

    # now with the real cached value flowing through the real resolver
    with_card_bps = svc.get_fee_bps(SubscriptionTier.FREE, user_id=321)
    assert with_card_bps == base_bps  # sanity: patched resolver still zero

    # unpatch the resolver so the cache is genuinely consulted
    svc2 = FeeService()
    monkeypatch.setattr(svc2, "_active_fee_discount_fraction", lambda uid: 0.0)
    monkeypatch.setattr(svc2, "_active_referee_rebate_applies", lambda uid: False)
    real_bps = svc2.get_fee_bps(SubscriptionTier.FREE, user_id=321)
    assert real_bps == base_bps - 40, f"card discount did not reach the charged bps: {real_bps}"
    assert (
        real_bps > 0
        and svc2.get_fee_decimal(SubscriptionTier.FREE, user_id=321) >= MIN_EFFECTIVE_FEE_RATE
    )

    # $10,000 swap: 100 bps -> 60 bps is $40 of real money
    assert (base_bps - real_bps) / 10_000 * 10_000 == 40

    # And the same cached perk must NOT flatten a paid tier onto the ENTERPRISE
    # rate — that collapse (PRO and PREMIUM both landing on 10 bps, identical to
    # a $99.99/mo ENTERPRISE seat) is the bug this discount was reshaped to fix.
    pro_bps = svc2.get_fee_bps(SubscriptionTier.PRO, user_id=321)
    premium_bps = svc2.get_fee_bps(SubscriptionTier.PREMIUM, user_id=321)
    ent_bps = svc2.get_fee_bps(SubscriptionTier.ENTERPRISE, user_id=321)
    # ENTERPRISE is 10, NOT 6 — the card perk is not offered on contracted
    # pricing, so the cached discount must not touch it.
    assert (pro_bps, premium_bps, ent_bps) == (30, 18, 10)
    assert real_bps > pro_bps > premium_bps > ent_bps > 0


# ── perks come from wallets the user actually controls ───────────────────────


def test_watch_only_wallets_never_source_the_position_perk(tmp_db):
    """Review HIGH: `evm_address_for_user` read the first row of
    `get_user_wallets`, which includes wallet_provider='watch' rows — addresses a
    user merely pasted into /import, proving no ownership at all. Anyone could
    watch a known card holder's address and inherit their fee discount and XP
    boost. This is the same hole already closed on the membership side; the
    Position-card path still had it.

    Real DB, real rows: the watch wallet is created FIRST so an unordered or
    unfiltered query would return it."""
    from bot.models.user import User, Wallet
    from bot.services.position_cards_service import position_cards_service
    from database.db import get_session

    whale = "0x" + "aa" * 20
    mine = "0x" + "bb" * 20

    with get_session() as session:
        session.add(User(id=90210, telegram_id=90210, username="freeloader"))
        session.flush()
        session.add(
            Wallet(
                user_id=90210,
                address=whale,
                chain_type="evm",
                wallet_provider="watch",
                is_active=True,
            )
        )
        session.flush()  # lower Wallet.id than the real one
        session.add(
            Wallet(
                user_id=90210,
                address=mine,
                chain_type="evm",
                wallet_provider="local",
                is_active=True,
            )
        )

    resolved = position_cards_service.evm_address_for_user(90210)
    assert resolved != whale, "watch-only address sourced a perk"
    assert resolved == mine


def test_inactive_key_wallets_are_skipped(tmp_db):
    """A deactivated wallet is not a wallet. Without the is_active filter a
    user could keep perks flowing through a row they had already removed."""
    from bot.models.user import User, Wallet
    from bot.services.position_cards_service import position_cards_service
    from database.db import get_session

    dead = "0x" + "cc" * 20
    live = "0x" + "dd" * 20
    with get_session() as session:
        session.add(User(id=90211, telegram_id=90211, username="rotator"))
        session.flush()
        session.add(
            Wallet(
                user_id=90211,
                address=dead,
                chain_type="evm",
                wallet_provider="local",
                is_active=False,
            )
        )
        session.flush()
        session.add(
            Wallet(
                user_id=90211,
                address=live,
                chain_type="evm",
                wallet_provider="local",
                is_active=True,
            )
        )

    assert position_cards_service.evm_address_for_user(90211) == live


def test_no_key_controlled_wallet_means_no_perk(tmp_db):
    """A user with only watch rows gets None, not a fallback to the watch
    address."""
    from bot.models.user import User, Wallet
    from bot.services.position_cards_service import position_cards_service
    from database.db import get_session

    with get_session() as session:
        session.add(User(id=90212, telegram_id=90212, username="watcher"))
        session.flush()
        session.add(
            Wallet(
                user_id=90212,
                address="0x" + "ee" * 20,
                chain_type="evm",
                wallet_provider="watch",
                is_active=True,
            )
        )

    assert position_cards_service.evm_address_for_user(90212) is None


# ── perk reads must never stall the event loop ───────────────────────────────


@pytest.mark.asyncio
async def test_perk_reads_do_not_block_the_event_loop(monkeypatch):
    """Review HIGH: every eth_call ran inline inside `async def`. web3's
    HTTPProvider is blocking, so a slow Robinhood RPC froze the whole loop — and
    a bulk swap issued one such call PER LEG. Here a read that sleeps 0.4s must
    not stop a concurrent heartbeat from ticking."""
    import bot.services.position_cards_service as mod

    svc = mod.PositionCardsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))

    async def fake_ids(address):
        return [1]

    monkeypatch.setattr(svc, "_token_ids", fake_ids)

    class _Fn:
        def call(self):
            time.sleep(0.4)
            return True

    class _Functions:
        @staticmethod
        def holdsTicker(*a):
            return _Fn()

    class _Contract:
        functions = _Functions

        class w3:
            @staticmethod
            def to_checksum_address(a):
                return a

    monkeypatch.setattr(svc, "_contract", lambda: _Contract)
    monkeypatch.setattr(mod, "_RPC_TIMEOUT", 5.0)

    async def heartbeat():
        for _ in range(20):
            await asyncio.sleep(0.02)

    started = time.monotonic()
    boost, _ = await asyncio.gather(
        svc.get_ticker_xp_boost_bps("0x" + "ab" * 20, mod.PRICED_TICKERS[0]), heartbeat()
    )
    elapsed = time.monotonic() - started

    assert boost == 2500
    # Concurrent: the 0.4s read and the 0.4s of heartbeat overlap (~0.4s total).
    # Blocked: they serialise (~0.8s). Counting ticks would NOT catch this —
    # gather still awaits the heartbeat afterwards, so every tick lands either
    # way. Wall clock is what actually distinguishes the two.
    assert elapsed < 0.65, f"event loop was blocked during the RPC ({elapsed:.2f}s)"


@pytest.mark.asyncio
async def test_bulk_swap_legs_reuse_one_ticker_read(monkeypatch):
    """A bulk swap checks the same ticker on every leg. Uncached that was one
    eth_call per leg per side; the boost is cached per (address, ticker)."""
    import bot.services.position_cards_service as mod

    svc = mod.PositionCardsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))

    async def fake_ids(address):
        return [1]

    monkeypatch.setattr(svc, "_token_ids", fake_ids)
    calls = {"n": 0}

    class _Fn:
        def call(self):
            calls["n"] += 1
            return True

    class _Functions:
        @staticmethod
        def holdsTicker(*a):
            return _Fn()

    class _Contract:
        functions = _Functions

        class w3:
            @staticmethod
            def to_checksum_address(a):
                return a

    monkeypatch.setattr(svc, "_contract", lambda: _Contract)

    addr = "0x" + "cd" * 20
    sym = mod.PRICED_TICKERS[0]
    for _ in range(8):  # eight legs of a bulk swap
        assert await svc.get_ticker_xp_boost_bps(addr, sym) == 2500
    assert calls["n"] == 1, f"one read per leg leaked through ({calls['n']} calls)"


@pytest.mark.asyncio
async def test_a_failed_read_is_not_cached_as_no_boost(monkeypatch):
    """A transient RPC failure must not pin `no perk` for the cache TTL — the
    holder would silently lose their boost for five minutes."""
    import bot.services.position_cards_service as mod

    svc = mod.PositionCardsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))

    async def fake_ids(address):
        return [1]

    monkeypatch.setattr(svc, "_token_ids", fake_ids)
    state = {"fail": True}

    class _Fn:
        def call(self):
            if state["fail"]:
                raise RuntimeError("rpc down")
            return True

    class _Functions:
        @staticmethod
        def holdsTicker(*a):
            return _Fn()

    class _Contract:
        functions = _Functions

        class w3:
            @staticmethod
            def to_checksum_address(a):
                return a

    monkeypatch.setattr(svc, "_contract", lambda: _Contract)

    addr = "0x" + "ef" * 20
    sym = mod.PRICED_TICKERS[1]
    assert await svc.get_ticker_xp_boost_bps(addr, sym) == 0
    state["fail"] = False
    assert await svc.get_ticker_xp_boost_bps(addr, sym) == 2500, "failure was cached"


# ── audit fixes ──────────────────────────────────────────────────────────────


def test_allowlist_snapshot_excludes_watch_only_wallets(tmp_db, monkeypatch):
    """Audit HIGH: rows_from_db picked the user's EVM wallet with an unfiltered,
    unordered .first(). A watch row is an address pasted into /import with no
    key and no signature — baking one into the on-chain Merkle root hands a free
    EARNED mint grant to whoever actually controls it."""
    import importlib.util

    from bot.models.points import UserPoints
    from bot.models.user import User, Wallet
    from database.db import get_session

    path = os.path.join(REPO, "nft", "position-cards", "build_allowlist.py")
    spec = importlib.util.spec_from_file_location("build_allowlist", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    whale = "0x" + "aa" * 20
    mine = "0x" + "bb" * 20
    with get_session() as s:
        s.add(User(id=7001, telegram_id=7001, username="freeloader"))
        s.flush()
        s.add(UserPoints(user_id=7001, total_swaps=9, total_volume_usd=2000))
        # watch row created FIRST, so an unordered query would surface it
        s.add(
            Wallet(
                user_id=7001,
                address=whale,
                chain_type="evm",
                wallet_provider="watch",
                is_active=True,
            )
        )
        s.flush()
        s.add(
            Wallet(
                user_id=7001,
                address=mine,
                chain_type="evm",
                wallet_provider="local",
                is_active=True,
            )
        )

    rows = mod.rows_from_db()
    got = {r["address"] for r in rows}
    assert whale not in got, "a watch-only address reached the allowlist snapshot"
    assert mine in got
    assert mod.classify(next(r for r in rows if r["address"] == mine)) == mod.ALLOWLIST


def test_allowlist_counts_only_verified_referrals(tmp_db):
    """Audit HIGH: referrals were counted with no verified_at filter, so five
    throwaway accounts bought the Founder phase. bot/models/referral.py states
    verified_at is NULL until a fraud check passes and only verified referrals
    count toward milestones."""
    import importlib.util
    from datetime import datetime, timezone

    from bot.models.referral import Referral
    from bot.models.user import User, Wallet
    from database.db import get_session

    path = os.path.join(REPO, "nft", "position-cards", "build_allowlist.py")
    spec = importlib.util.spec_from_file_location("build_allowlist", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    with get_session() as s:
        s.add(User(id=7100, telegram_id=7100, username="sybil"))
        s.flush()
        s.add(
            Wallet(
                user_id=7100,
                address="0x" + "cc" * 20,
                chain_type="evm",
                wallet_provider="local",
                is_active=True,
            )
        )
        for i in range(6):
            s.add(User(id=7200 + i, telegram_id=7200 + i, username=f"burner{i}"))
        s.flush()
        for i in range(6):  # six referrals, NONE verified
            s.add(
                Referral(
                    referrer_id=7100,
                    referee_id=7200 + i,
                    referral_code=f"SYBIL_{i}",
                )
            )

    row = next(r for r in mod.rows_from_db() if r["address"] == "0x" + "cc" * 20)
    assert row["referrals"] == 0, "unverified referrals counted"
    assert mod.classify(row) is None, "sybil reached a mint phase"

    # verify two of them and the count moves, but still short of Founder
    with get_session() as s:
        for r in s.query(Referral).filter(Referral.referrer_id == 7100).limit(2).all():
            r.verified_at = datetime.now(timezone.utc)
    row = next(r for r in mod.rows_from_db() if r["address"] == "0x" + "cc" * 20)
    assert row["referrals"] == 2
    assert mod.classify(row) == mod.ALLOWLIST


def test_service_and_snapshot_count_referrals_the_same_way(tmp_db):
    """Their docstrings say they must not drift: the bot tells a user they
    qualify using the number the snapshot uses to decide."""
    from datetime import datetime, timezone

    from bot.models.referral import Referral
    from bot.models.user import User
    from bot.services.position_cards_service import position_cards_service
    from database.db import get_session

    with get_session() as s:
        s.add(User(id=7300, telegram_id=7300, username="honest"))
        for i in range(4):
            s.add(User(id=7400 + i, telegram_id=7400 + i, username=f"ref{i}"))
        s.flush()
        for i in range(4):
            s.add(
                Referral(
                    referrer_id=7300,
                    referee_id=7400 + i,
                    referral_code=f"H_{i}",
                    verified_at=datetime.now(timezone.utc) if i < 3 else None,
                )
            )

    assert position_cards_service.allowlist_status(7300)["referrals"] == 3


def test_cards_command_is_rate_limited_and_quotes_the_real_ticker_count():
    """Audit: /cards had no rate limit while /bindwallet and /subscribe did, and
    advertised 96 tickers when only the 35 with a Chainlink feed are mintable."""
    src = open(os.path.join(REPO, "bot", "handlers", "position_cards.py")).read()
    assert "enforce_rate_limit_for_update(update, swap_limiter)" in src
    assert "96 tokenized equities" not in src
    assert "len(PRICED_TICKERS)" in src
    # no synchronous session left on the event loop
    assert "with get_session() as session:" not in src.split("def _load_user_id")[0]


# ── the engraving is evidence, not decoration ────────────────────────────────


def test_every_plate_is_distinct_even_at_identical_price_and_grade():
    """Sixty NVDA cards at the same entry, same live price and the same grade
    must still engrave differently — the rosette is seeded from the token's own
    identity, so two plates can only match if ticker, rank and basis all match."""
    import hashlib

    cfg, reg = render.load_config(), render.load_registry()
    seen = {
        hashlib.sha256(
            render.render_card(cfg, reg, tid, "NVDA", 100.0, 200.0, tid).encode()
        ).hexdigest()
        for tid in range(1, 61)
    }
    assert len(seen) == 60


def test_the_plate_carries_no_invented_price_history():
    """The card has exactly two real numbers — the basis stamped at mint and the
    live oracle. The previous collection drew a fake random-walk chart of a
    trade that never happened; nothing here may reintroduce one."""
    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 1, "NVDA", 92.11, 219.32, 1)
    assert "92.11" in svg and "219.32" in svg
    # a fabricated series would need many plotted points in a polyline
    assert "<polyline" not in svg
    assert svg.count("<path") <= 6, "unexpected path count — is something drawing a series?"


def test_no_external_resources_are_referenced():
    """A marketplace renders this under a strict CSP. Any remote font, image or
    stylesheet silently drops and the plate falls apart."""
    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 1, "AAPL", 100.0, 130.0, 42)
    # The xmlns declaration is an identifier, not a fetch — strip it before
    # looking for anything the renderer would actually try to load.
    body = svg.replace('xmlns="http://www.w3.org/2000/svg"', "")
    for bad in ("http://", "https://", "@import", "@font-face", "<image", "url(http", " src="):
        assert bad not in body, bad
    # internal refs only: every href must point at a #id defined in this document
    import re

    for ref in re.findall(r'href="([^"]+)"', body):
        assert ref.startswith("#"), ref
        assert f'id="{ref[1:]}"' in body, f"dangling ref {ref}"


def test_the_engraving_survives_a_thumbnail():
    """Almost nobody meets an NFT at full size — they meet forty of them at
    ~190px on a marketplace wall. The first cut stroked the rosette at 0.7px on
    a 1000px plate, which resolves to 0.13px in a grid cell: the entire
    engraving vanished and every card read as a black rectangle with a word and
    a number on it."""
    import re

    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 1, "NVDA", 100.0, 200.0, 1)
    widths = [float(w) for w in re.findall(r'stroke-width="([\d.]+)"', svg)]
    engraving = [w for w in widths if w >= 1.5]
    assert engraving, "no stroke heavy enough to survive a 5x downscale"
    # a 190px cell is a 5.26x reduction; 1.5px is the floor that stays visible
    assert max(widths) >= 2.4


def test_the_field_colour_comes_from_the_sector():
    """Ten sectors give the collection ten families, so a wall of 10,000 sorts
    by eye instead of reading as one repeated black rectangle. Two tickers in
    different sectors at an IDENTICAL return must not share a plate colour."""
    cfg, reg = render.load_config(), render.load_registry()
    a = render.render_card(cfg, reg, 1, "NVDA", 100.0, 130.0, 1)  # Semiconductors
    b = render.render_card(cfg, reg, 1, "IONQ", 100.0, 130.0, 1)  # Quantum
    assert cfg["sector_colors"]["Semiconductors"] in a
    assert cfg["sector_colors"]["Quantum"] in b
    assert a.split('id="plate"')[1][:200] != b.split('id="plate"')[1][:200]


def test_the_output_space_is_structurally_combinatorial_not_one_recoloured_plate():
    """Long-form work has nowhere to hide: a collector sees the whole space, so
    one composition emitted 10,000 times reads as an edition that was too large.
    Every engraving family, composition and ink must actually appear, and no
    single mode may dominate its axis."""
    import collections
    import json

    cfg, reg = render.load_config(), render.load_registry()
    order = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))[
        "ticker_order"
    ]
    seen = collections.Counter()
    ratios = [0.3, 0.6, 0.9, 1.0, 1.1, 1.5, 2.5, 5.0, None]
    n = 3000
    for i in range(1, n + 1):
        r = ratios[i % len(ratios)]
        t = render.card_traits(
            cfg, reg, i, order[i % len(order)], 100.0 / r if r else None, 100.0 if r else None, i
        )
        seen[("eng", t["engraving"])] += 1
        seen[("comp", t["composition"])] += 1
        seen[("ink", t["ink"])] += 1
        seen[("proof", t["proof"])] += 1

    assert {k[1] for k in seen if k[0] == "eng"} == set(render.ENGRAVINGS)
    assert {k[1] for k in seen if k[0] == "comp"} == set(render.COMPOSITIONS)
    assert {k[1] for k in seen if k[0] == "ink"} == set(render.INKS)
    # no engraving family may run away with the collection
    for fam in render.ENGRAVINGS:
        share = seen[("eng", fam)] / n
        assert 0.10 < share < 0.25, f"{fam} is {share:.0%} of the space"
    # the proof plate must be rare but real
    assert 0.005 < seen[("proof", True)] / n < 0.08


def test_the_loudest_composition_has_to_be_earned():
    """Structure is drawn from what the token IS, and the position biases the
    draw — a losing plate cannot buy the full-bleed layout."""
    cfg, reg = render.load_config(), render.load_registry()
    for tid in range(1, 400):
        t = render.card_traits(cfg, reg, tid, "NVDA", 100.0, 60.0, tid)
        assert t["composition"] in ("medallion", "band"), t
    # and a flat position gets the quietest plate of all
    for tid in range(1, 200):
        assert render.card_traits(cfg, reg, tid, "NVDA", 100.0, 100.05, tid)["composition"] == (
            "medallion"
        )
    # while a real runner can reach every composition
    reached = {
        render.card_traits(cfg, reg, t, "NVDA", 100.0, 900.0, t)["composition"]
        for t in range(1, 400)
    }
    assert reached == set(render.COMPOSITIONS)


def test_every_plate_clears_a_legibility_floor():
    """The other half of the long-form standard: consistent minimum quality
    across the ENTIRE output space, because the artist cannot cull the weak
    ones. A proof plate struck in a light accent measured 2.93:1 before this."""
    import json

    cfg, reg = render.load_config(), render.load_registry()
    order = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))[
        "ticker_order"
    ]
    ratios = [0.3, 0.6, 0.9, 1.0, 1.1, 1.5, 2.5, 5.0, None]
    worst_hero = worst_body = 99.0
    for i in range(1, 2500):
        r = ratios[i % len(ratios)]
        t = render.card_traits(
            cfg, reg, i, order[i % len(order)], 100.0 / r if r else None, 100.0 if r else None, i
        )
        worst_hero = min(worst_hero, t["hero_contrast"])
        worst_body = min(worst_body, t["body_contrast"])
    assert worst_hero >= 4.0, f"hero numeral fell to {worst_hero}:1"
    assert worst_body >= 4.5, f"ticker fell to {worst_body}:1"


def test_structure_is_derived_from_the_token_not_rolled():
    """Same ticker, rank and basis must always resolve to the same plate; change
    any one of them and the structure may move. This is what makes the engraving
    evidence rather than a trait roll."""
    cfg, reg = render.load_config(), render.load_registry()
    a = render.card_traits(cfg, reg, 42, "NVDA", 100.0, 300.0, 42)
    assert a == render.card_traits(cfg, reg, 42, "NVDA", 100.0, 300.0, 42)
    changed = {
        tuple(sorted(render.card_traits(cfg, reg, t, "NVDA", 100.0, 300.0, t).items()))
        for t in range(1, 60)
    }
    assert len(changed) > 12, "rank does not move the structure"


def test_the_engraving_never_climbs_into_the_masthead():
    """A big winner both rises and grows; unclamped the two compounded until the
    engraving ran up through the issuer line."""
    import re

    cfg, reg = render.load_config(), render.load_registry()
    for ratio in (0.2, 0.5, 1.0, 1.5, 3, 6, 12, 40):
        svg = render.render_card(cfg, reg, 1, "SPCX", 100.0, 100.0 * ratio, 1)
        clip = re.search(r'<clipPath id="cut">(.*?)</clipPath>', svg).group(1)
        for cy_, r_ in re.findall(r'<circle cx="[\d.-]+" cy="([\d.]+)" r="([\d.]+)"', clip):
            assert float(cy_) - float(r_) > 366, f"clip reached {float(cy_) - float(r_):.0f}"
        for y_, h_ in re.findall(r'<rect x="[\d.-]+" y="([\d.-]+)"[^/]*height="([\d.]+)"', clip):
            assert float(y_) > 60, f"band clip started at {y_}"


# ── the card is a brand surface, not a mood board ────────────────────────────


def test_the_plate_uses_the_real_brand_tokens_and_cannot_drift():
    """The collection is the most public artefact this project ships; it cannot
    be the one surface that ignores the brand.

    Now reads packages/design-tokens, which became the single canonical source
    when the repo's two competing design systems were reconciled. This test
    previously read showcase/tailwind.config.ts — which was itself one of the
    two competing systems, so the card was aligned by luck rather than decision.
    The full cross-surface check lives in tests/test_brand_tokens.py.
    """
    import re

    cfg = render.load_config()
    tokens = open(os.path.join(REPO, "packages", "design-tokens", "src", "tokens.ts")).read()
    start = tokens.index("  brand: {")
    block = tokens[start : tokens.index("  colors: {", start)]  # noqa: E203
    live = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block))
    assert live, "could not read the canonical brand"
    camel = {
        "surface2": "surface-2",
        "border2": "border-2",
        "text2": "text-2",
        "text3": "text-3",
        "accentHover": "accent-hover",
        "accentLight": "accent-light",
        "greenLight": "green-light",
        "darkSurface": "dark-surface",
    }
    for key, value in live.items():
        k = camel.get(key, key)
        assert cfg["brand"].get(k) == value, f"brand token {k} drifted from the package"


def test_the_default_plate_is_dark_and_the_gilt_proof_is_rare():
    """The collection is a luxury card in the Amex Centurion / Robinhood Gold
    lineage: the default plate is matte near-black with the sector anodised in,
    and the RARE state is the ivory Gilt proof struck in dark ink. (This is the
    second deliberate inversion of this axis — the light-default build read as
    stationery, not as a card you'd hand across a table.)"""
    cfg, reg = render.load_config(), render.load_registry()
    light = dark = 0
    for tid in range(1, 400):
        t = render.card_traits(cfg, reg, tid, "NVDA", 100.0, 130.0, tid)
        pal = render.palette(
            cfg, cfg["sector_colors"]["Semiconductors"], "#5da97f", 3000, True, t["proof"]
        )
        if render._lum(pal["field"]) > 0.5:
            light += 1
        else:
            dark += 1
    assert dark > light * 8, f"{light} light of {light + dark} — the dark plate is not the default"
    assert light > 0, "the Gilt proof never appears"


def test_the_metal_is_earned_by_rank_and_the_mark_stays_brand_pink():
    """Status is carried by struck metal — gold for Founder, platinum for
    Early, graphite otherwise — and the one saturated element on the plate is
    the small pink Suwappu mark."""
    cfg, reg = render.load_config(), render.load_registry()
    up = render.render_card(cfg, reg, 1, "NVDA", 100.0, 400.0, 1)
    assert cfg["brand"]["accent"] in up, "the Suwappu mark is not in brand pink"
    sector = cfg["sector_colors"]["Semiconductors"]
    assert render.metal_for("Founder", sector) == render.GOLD
    assert render.metal_for("Early", sector) == render.PLATINUM
    base = render.metal_for(None, sector)
    assert base not in (render.GOLD, render.PLATINUM)
    # the founder card is literally furnished in gold; a public one is not
    assert render.GOLD in render.render_card(cfg, reg, 1, "NVDA", 100.0, 400.0, 1)
    assert render.GOLD not in render.render_card(cfg, reg, 1, "NVDA", 100.0, 400.0, 9000)
    # and the gain numeral still clears the floor on the dark ground
    pal = render.palette(cfg, sector, "#59c19a", 30000, True, False)
    assert render.contrast(pal["hero"], pal["field"]) >= 4.0


def test_the_palette_has_exactly_one_implementation():
    """render_card and card_traits each computed the palette independently, so
    the quality gate was measuring colours the renderer had stopped using."""
    src = open(os.path.join(REPO, "nft", "position-cards", "render.py")).read()
    assert src.count("def palette(") == 1
    body = src[src.index("def card_traits(") : src.index("def render_card(")]  # noqa: E203
    assert "palette(cfg," in body, "card_traits does not use the shared palette"
    rc = src[src.index("def render_card(") :]  # noqa: E203
    assert "palette(cfg," in rc, "render_card does not use the shared palette"
