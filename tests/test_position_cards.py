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
