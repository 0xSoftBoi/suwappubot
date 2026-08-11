"""Suwappu Positions — collection integrity + fee/perk wiring.

The failure that would matter most in production: the contract stores a ticker
INDEX, and position_cards_service resolves a symbol to an index independently. If
those two orderings ever diverge, every card silently points at the wrong
company. That is asserted here against the deploy args themselves.
"""

import ast
import importlib.util
import json
import os
import re
import subprocess
import sys

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
    assert sum(caps.values()) == cfg["collection"]["supply"] == 10_000
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
    assert total == 10_000
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
    assert "Multiple" in svg  # 10,000 bps
    down = render.render_card(cfg, reg, 2, "NVDA", entry=100.0, price=50.0, rank=8)
    assert "−50.0%" in down
    assert "Underwater" in down


def test_unpriced_card_claims_no_return():
    cfg, reg = render.load_config(), render.load_registry()
    svg = render.render_card(cfg, reg, 3, "TSLA", entry=None, price=None, rank=99)
    assert "UNPRICED" in svg
    assert "RETURN SINCE ENTRY" not in svg, "unpriced card must not show a return figure"
    assert "return not tracked" in svg
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
    cfg = render.load_config()
    assert render.badge_for(cfg, 1) == "Founder"
    assert render.badge_for(cfg, 500) == "Founder"
    assert render.badge_for(cfg, 501) == "Early"
    assert render.badge_for(cfg, 2000) == "Early"
    assert render.badge_for(cfg, 2001) is None


# ── 4. the fee wiring ─────────────────────────────────────────────────────────


def test_positions_discount_stacks_and_respects_the_floor(monkeypatch):
    from bot.models.subscription import SubscriptionTier
    from bot.services.fee_service import MIN_EFFECTIVE_FEE_RATE, FeeService

    svc = FeeService()
    monkeypatch.setattr(svc, "_active_fee_discount_decimal", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    monkeypatch.setattr(svc, "_positions_discount_decimal", lambda uid: 0.0)
    base = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)

    # 40 bps = 0.004
    monkeypatch.setattr(svc, "_positions_discount_decimal", lambda uid: 0.004)
    discounted = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert discounted == pytest.approx(base - 0.004)
    assert discounted > 0

    # an absurd discount must still floor, never zero or go negative
    monkeypatch.setattr(svc, "_positions_discount_decimal", lambda uid: 99.0)
    floored = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert floored == MIN_EFFECTIVE_FEE_RATE
    assert svc.get_fee_bps(SubscriptionTier.FREE, user_id=1) > 0


def test_discount_is_zero_when_unconfigured(monkeypatch):
    from bot.services.position_cards_service import position_cards_service

    monkeypatch.setattr(
        type(position_cards_service), "contract_address", property(lambda self: None)
    )
    assert position_cards_service.enabled is False
    assert position_cards_service.get_cached_discount_bps_for_user(1) == 0


def test_cached_discount_is_clamped_and_expires(monkeypatch):
    import time as _t

    from bot.services import position_cards_service as mod

    svc = mod.PositionCardsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    svc._user_discount[7] = (_t.time(), 9_999)
    assert svc.get_cached_discount_bps_for_user(7) == mod.MAX_CARD_DISCOUNT_BPS

    svc._user_discount[8] = (_t.time() - 10_000, 40)  # expired
    assert svc.get_cached_discount_bps_for_user(8) == 0


def test_config_discount_matches_service_backstop():
    """config.json is the source of truth; the service backstop must not be below it."""
    from bot.services.position_cards_service import MAX_CARD_DISCOUNT_BPS

    cfg = render.load_config()
    assert cfg["economics"]["hold_discount_bps"] <= MAX_CARD_DISCOUNT_BPS


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
    """Chainlink already reports total-return value; applying uiMultiplier again
    would inflate every price."""
    src = _oracle_src()
    assert "uiMultiplier" not in src.split("*/", 1)[1], "uiMultiplier must not be applied in code"


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


def test_contract_rebuilds_the_leaf_from_msg_sender():
    """The one rule that makes an allowlist safe: a proof must be useless to
    anyone but its owner, so the leaf cannot come from calldata."""
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    assert "keccak256(bytes.concat(keccak256(abi.encode(msg.sender, maxQty))))" in sol
    assert "MerkleProof.verify(proof, cfg.merkleRoot, leaf)" in sol


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
    assert total == cfg["collection"]["supply"] == 10_000


def test_team_reserve_is_bounded_on_chain():
    sol = open(os.path.join(REPO, "contracts", "SuwappuPositions.sol")).read()
    cfg = render.load_config()
    assert f"RESERVE_MAX = {cfg['mint']['team_reserve']};" in sol
    assert "if (reserveMinted + quantity > RESERVE_MAX) revert ReserveExhausted();" in sol


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
    monkeypatch.setattr(svc, "_active_fee_discount_decimal", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    monkeypatch.setattr(
        type(mod.position_cards_service),
        "contract_address",
        property(lambda self: "0x" + "11" * 20),
    )
    mod.position_cards_service._user_discount[321] = (_t.time(), 40)

    base_bps = 0
    monkeypatch.setattr(svc, "_positions_discount_decimal", lambda uid: 0.0)
    base_bps = svc.get_fee_bps(SubscriptionTier.FREE, user_id=321)

    # now with the real cached value flowing through the real resolver
    with_card_bps = svc.get_fee_bps(SubscriptionTier.FREE, user_id=321)
    assert with_card_bps == base_bps  # sanity: patched resolver still zero

    # unpatch the resolver so the cache is genuinely consulted
    svc2 = FeeService()
    monkeypatch.setattr(svc2, "_active_fee_discount_decimal", lambda uid: 0.0)
    monkeypatch.setattr(svc2, "_active_referee_rebate_applies", lambda uid: False)
    real_bps = svc2.get_fee_bps(SubscriptionTier.FREE, user_id=321)
    assert real_bps == base_bps - 40, f"card discount did not reach the charged bps: {real_bps}"
    assert (
        real_bps > 0
        and svc2.get_fee_decimal(SubscriptionTier.FREE, user_id=321) >= MIN_EFFECTIVE_FEE_RATE
    )

    # $10,000 swap: 100 bps -> 60 bps is $40 of real money
    assert (base_bps - real_bps) / 10_000 * 10_000 == 40
