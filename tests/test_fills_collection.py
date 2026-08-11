"""Suwappu Fills — collection integrity + fee/perk wiring.

Covers the three things that can silently rot:
  1. the collection's ticker universe drifting from ROBINHOOD_EQUITIES,
  2. the on-chain traits commitment not matching the generated collection,
  3. the NFT fee discount escaping the floor in fee_service.
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
FILLS = os.path.join(REPO, "nft", "fills")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


generate = _load("fills_generate", os.path.join(FILLS, "generate.py"))
pack_traits = _load("fills_pack", os.path.join(FILLS, "pack_traits.py"))


def registry():
    src = open(os.path.join(REPO, "bot", "config", "tokens.py")).read()
    m = re.search(
        r"ROBINHOOD_EQUITIES: dict\[str, tuple\[str, int, str\]\] = (\{.*?\n\})", src, re.S
    )
    return ast.literal_eval(m.group(1))


# ── 1. the collection tracks the canonical registry ───────────────────────────


def test_bands_cover_registry_exactly():
    cfg = generate.load_config()
    banded = [t for k, v in cfg["ticker_bands"].items() if k != "_comment" for t in v["tickers"]]
    assert sorted(banded) == sorted(registry())
    assert len(banded) == len(set(banded)), "a ticker is in two bands"


def test_sectors_cover_registry_exactly():
    cfg = generate.load_config()
    mapped = [t for v in cfg["sectors"].values() for t in v]
    assert sorted(mapped) == sorted(registry())
    assert len(mapped) == len(set(mapped)), "a ticker is in two sectors"


def test_every_sector_has_a_colour():
    cfg = generate.load_config()
    assert set(cfg["sectors"]) == set(cfg["sector_colors"])


def test_generator_reads_the_live_registry():
    """The generator must parse tokens.py, not carry its own ticker copy."""
    assert generate.load_registry() == registry()


# ── 2. determinism + the on-chain traits commitment ───────────────────────────


def test_generation_is_deterministic(tmp_path):
    out = str(tmp_path / "a")
    for _ in range(2):
        subprocess.run(
            [sys.executable, os.path.join(FILLS, "generate.py"), "--limit", "24", "--out", out],
            check=True,
            cwd=REPO,
            capture_output=True,
        )
        first = open(os.path.join(out, "images", "7.svg")).read()
        meta = json.load(open(os.path.join(out, "metadata", "7")))
    subprocess.run(
        [
            sys.executable,
            os.path.join(FILLS, "generate.py"),
            "--limit",
            "24",
            "--out",
            str(tmp_path / "b"),
        ],
        check=True,
        cwd=REPO,
        capture_output=True,
    )
    assert open(os.path.join(str(tmp_path / "b"), "images", "7.svg")).read() == first
    assert json.load(open(os.path.join(str(tmp_path / "b"), "metadata", "7"))) == meta


def test_keccak256_matches_known_vectors():
    assert (
        pack_traits.keccak256(b"").hex()
        == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )
    assert (
        pack_traits.keccak256(b"abc").hex()
        == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    )


@pytest.mark.skipif(
    not os.path.exists(os.path.join(FILLS, "collection.json")),
    reason="collection.json not generated",
)
def test_traits_blob_matches_committed_collection():
    cfg, tickers, desks, blob = pack_traits.build_blob()
    assert len(blob) == cfg["collection"]["supply"] * 2
    assert tickers == sorted(registry())

    commitment = "0x" + pack_traits.keccak256(blob).hex()
    committed = open(os.path.join(FILLS, "traits_commitment.txt")).read().strip()
    assert commitment == committed, "run pack_traits.py — commitment is stale"

    # every packed pair must be in range for the contract's tables
    for i in range(0, len(blob), 2):
        assert 0 <= blob[i] < len(tickers)
        assert 0 <= blob[i + 1] < len(desks)


@pytest.mark.skipif(
    not os.path.exists(os.path.join(FILLS, "collection.json")),
    reason="collection.json not generated",
)
def test_metadata_never_claims_equity():
    collection = json.load(open(os.path.join(FILLS, "collection.json")))
    assert len(collection) == 10_000
    for meta in collection[:200]:
        assert "Not equity" in meta["properties"]["disclaimer"]
        assert meta["properties"]["chain_id"] == 4663
        assert meta["properties"]["underlying_erc20"].startswith("0x")


# ── 3. the fee wiring ─────────────────────────────────────────────────────────


def test_ticker_index_matches_packed_order():
    """fills_service must index tickers the same way the contract blob does."""
    from bot.services.fills_service import fills_service

    tickers = sorted(registry())
    for symbol in ("AAPL", "NVDA", "SPY", "ZS"):
        assert fills_service.ticker_index(symbol) == tickers.index(symbol)
    assert fills_service.ticker_index("NOTATICKER") is None


def test_fills_discount_stacks_and_respects_the_floor(monkeypatch):
    from bot.models.subscription import SubscriptionTier
    from bot.services.fee_service import MIN_EFFECTIVE_FEE_RATE, FeeService

    svc = FeeService()
    monkeypatch.setattr(svc, "_active_fee_discount_decimal", lambda uid: 0.0)
    monkeypatch.setattr(svc, "_active_referee_rebate_applies", lambda uid: False)

    monkeypatch.setattr(svc, "_fills_discount_decimal", lambda uid: 0.0)
    base = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)

    # House desk = 50 bps = 0.005
    monkeypatch.setattr(svc, "_fills_discount_decimal", lambda uid: 0.005)
    discounted = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert discounted == pytest.approx(base - 0.005)
    assert discounted > 0

    # an absurd discount must still floor, never zero or go negative
    monkeypatch.setattr(svc, "_fills_discount_decimal", lambda uid: 99.0)
    floored = svc.get_fee_decimal(SubscriptionTier.FREE, user_id=1)
    assert floored == MIN_EFFECTIVE_FEE_RATE
    assert svc.get_fee_bps(SubscriptionTier.FREE, user_id=1) > 0


def test_fills_discount_is_zero_when_unconfigured(monkeypatch):
    from bot.services.fills_service import fills_service

    monkeypatch.setattr(type(fills_service), "contract_address", property(lambda self: None))
    assert fills_service.enabled is False
    assert fills_service.get_cached_discount_bps_for_user(1) == 0


def test_cached_discount_is_clamped(monkeypatch):
    import time as _t

    from bot.services import fills_service as mod

    svc = mod.FillsService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    svc._user_discount[7] = (_t.time(), 9_999)
    assert svc.get_cached_discount_bps_for_user(7) == mod.MAX_FILL_DISCOUNT_BPS

    svc._user_discount[8] = (_t.time() - 10_000, 50)  # expired
    assert svc.get_cached_discount_bps_for_user(8) == 0
