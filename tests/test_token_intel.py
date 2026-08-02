"""Tests for Token Intel / Dev Tracking — session-mocked, no network.

Covers:
  (a) EVM report assembly from canned Blockscout JSON, incl. top10 pct math
      and flag derivation (HIGH_TOP10, BUNDLED, SNIPED, CLUSTERED)
  (b) bundle/snipe/serial-deployer/cluster flag-derivation edge cases
  (c) chain auto-detect (/intel's _resolve_chain)
  (d) DeployerWatch add/list/rm handler logic against a tmp sqlite DB
  (e) graceful degradation when a Blockscout call fails/errors
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.services.token_intel import evm_source
from bot.services.token_intel.intel_service import (
    HolderInfo,
    TokenIntelReport,
    TokenIntelService,
)
from bot.handlers.intel import _resolve_chain

TOKEN = "0xTOKEN00000000000000000000000000000000"
DEPLOYER = "0xDEPLOYER0000000000000000000000000000"
H1 = "0xH1000000000000000000000000000000000000"
H2 = "0xH2000000000000000000000000000000000000"
H3 = "0xH3000000000000000000000000000000000000"
FUNDER = "0xFUNDER000000000000000000000000000000"


# ---------------------------------------------------------------------------
# Fake aiohttp session — routes GET requests to canned JSON by URL pattern.
# ---------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, status=200, json_data=None):
        self.status = status
        self._json = json_data or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._json


class _RoutedSession:
    """Dispatches GET requests to a router callable: (url) -> _FakeResp."""

    def __init__(self, router):
        self._router = router

    def get(self, url, params=None, headers=None):
        return self._router(url)


def _patch_evm_session(router):
    session = _RoutedSession(router)
    return (
        patch("bot.services.token_intel.evm_source.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.token_intel.evm_source.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
    )


def _full_router(url: str) -> _FakeResp:
    """Canned Blockscout responses producing a "bad" token: high concentration,
    a bundled + sniped launch, and two clustered top holders.
    """
    if url.endswith(f"/tokens/{TOKEN}/holders"):
        return _FakeResp(
            200,
            {
                "items": [
                    {"address": {"hash": H1}, "value": "300000"},
                    {"address": {"hash": H2}, "value": "200000"},
                    {"address": {"hash": H3}, "value": "100000"},
                ]
            },
        )
    if url.endswith(f"/tokens/{TOKEN}/transfers"):
        return _FakeResp(
            200,
            {
                "items": [
                    {
                        "block_number": 100,
                        "timestamp": "2024-01-01T00:00:00.000000Z",
                        "to": {"hash": H1},
                    },
                    {
                        "block_number": 100,
                        "timestamp": "2024-01-01T00:00:05.000000Z",
                        "to": {"hash": H2},
                    },
                    {
                        "block_number": 100,
                        "timestamp": "2024-01-01T00:00:10.000000Z",
                        "to": {"hash": H3},
                    },
                    {
                        "block_number": 101,
                        "timestamp": "2024-01-01T00:00:30.000000Z",
                        "to": {"hash": "0xLATE00000000000000000000000000000000"},
                    },
                ],
                "next_page_params": None,
            },
        )
    if url.endswith(f"/tokens/{TOKEN}"):
        return _FakeResp(200, {"name": "Test Token", "symbol": "TT", "total_supply": "1000000"})
    if url.endswith(f"/addresses/{DEPLOYER}/transactions"):
        return _FakeResp(200, {"items": [], "next_page_params": None})
    if url.endswith(f"/addresses/{TOKEN}"):
        return _FakeResp(200, {"creator_address_hash": DEPLOYER})
    if url.endswith(f"/addresses/{H1}/transactions") or url.endswith(
        f"/addresses/{H2}/transactions"
    ):
        return _FakeResp(
            200, {"items": [{"to": {"hash": H1 if "H1" in url else H2}, "from": {"hash": FUNDER}}]}
        )
    if url.endswith(f"/addresses/{H3}/transactions"):
        return _FakeResp(
            200,
            {
                "items": [
                    {"to": {"hash": H3}, "from": {"hash": "0xOTHERFUNDER0000000000000000000000000"}}
                ]
            },
        )
    return _FakeResp(404, {})


# ---------------------------------------------------------------------------
# (a) EVM report assembly + top10 pct math + full flag derivation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evm_report_assembly_and_flags():
    patches = _patch_evm_session(_full_router)
    with patches[0], patches[1]:
        report = TokenIntelReport(token_address=TOKEN, chain="ethereum")
        await evm_source.enrich_report(report, "ethereum")

    assert report.name == "Test Token"
    assert report.symbol == "TT"
    assert report.deployer == DEPLOYER
    assert report.deployer_prior_deploys == 0

    # top10 pct math: 300000+200000+100000 over 1,000,000 supply = 60%
    assert report.top10_pct == pytest.approx(60.0)
    assert len(report.top_holders) == 3
    assert report.top_holders[0].pct == pytest.approx(30.0)

    # bundle: 3 distinct recipients in block 100 (the earliest block)
    assert report.bundle_buyer_count == 3
    # snipe: all 4 buys (incl. the block-101 latecomer at +30s) fall within
    # the 60s snipe window — snipe count can exceed bundle count.
    assert report.snipe_buyer_count == 4

    # cluster: H1 and H2 share a funder, H3 does not
    assert [sorted(g) for g in report.cluster_groups] == [sorted([H1, H2])]

    service = TokenIntelService()
    service._derive_flags(report)
    assert "HIGH_TOP10" in report.flags
    assert "BUNDLED" in report.flags
    assert "SNIPED" in report.flags
    assert "CLUSTERED" in report.flags
    assert "SERIAL_DEPLOYER" not in report.flags


# ---------------------------------------------------------------------------
# (b) Bundle/snipe/serial-deployer/cluster flag-derivation edge cases
# ---------------------------------------------------------------------------


def _blank_report():
    return TokenIntelReport(token_address=TOKEN, chain="ethereum")


@pytest.mark.parametrize(
    "top10_pct,expected",
    [(49.9, False), (50.0, True), (None, False)],
)
def test_flag_high_top10_boundary(top10_pct, expected):
    report = _blank_report()
    report.top10_pct = top10_pct
    TokenIntelService()._derive_flags(report)
    assert ("HIGH_TOP10" in report.flags) is expected


@pytest.mark.parametrize("count,expected", [(2, False), (3, True), (None, False)])
def test_flag_bundled_boundary(count, expected):
    report = _blank_report()
    report.bundle_buyer_count = count
    TokenIntelService()._derive_flags(report)
    assert ("BUNDLED" in report.flags) is expected


@pytest.mark.parametrize("count,expected", [(2, False), (3, True), (None, False)])
def test_flag_sniped_boundary(count, expected):
    report = _blank_report()
    report.snipe_buyer_count = count
    TokenIntelService()._derive_flags(report)
    assert ("SNIPED" in report.flags) is expected


@pytest.mark.parametrize("dead,expected", [(1, False), (2, True), (None, False)])
def test_flag_serial_deployer_boundary(dead, expected):
    report = _blank_report()
    report.deployer_dead_deploys = dead
    TokenIntelService()._derive_flags(report)
    assert ("SERIAL_DEPLOYER" in report.flags) is expected


@pytest.mark.parametrize(
    "groups,expected",
    [([["a"]], False), ([["a", "b"]], True), ([], False)],
)
def test_flag_clustered_boundary(groups, expected):
    report = _blank_report()
    report.cluster_groups = groups
    TokenIntelService()._derive_flags(report)
    assert ("CLUSTERED" in report.flags) is expected


def test_set_top_holders_pct_math_with_missing_pct():
    report = _blank_report()
    report.set_top_holders(
        [
            {"address": H1, "balance": 10.0, "pct": 40.0},
            {"address": H2, "balance": 5.0, "pct": None},
        ]
    )
    # None pcts are skipped, not treated as zero-and-summed incorrectly.
    assert report.top10_pct == pytest.approx(40.0)
    assert len(report.top_holders) == 2


# ---------------------------------------------------------------------------
# (c) Chain auto-detect
# ---------------------------------------------------------------------------


def test_resolve_chain_evm_defaults_to_ethereum():
    assert _resolve_chain("evm", None) == "ethereum"


def test_resolve_chain_solana_defaults_to_solana():
    assert _resolve_chain("solana", None) == "solana"


def test_resolve_chain_explicit_arg_wins_and_resolves_alias():
    assert _resolve_chain("evm", "arb") == "arbitrum"
    assert _resolve_chain("evm", "base") == "base"


def test_resolve_chain_unsupported_family_returns_none():
    assert _resolve_chain("tron", None) is None
    assert _resolve_chain("starknet", None) is None


# ---------------------------------------------------------------------------
# (d) DeployerWatch add/list/rm handler logic against a tmp sqlite DB
# ---------------------------------------------------------------------------


def _make_update_and_context(telegram_id, args):
    update = MagicMock()
    update.effective_user = MagicMock(id=telegram_id)
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


DEPLOYER_HEX = "0x1234567890123456789012345678901234567890"


@pytest.mark.asyncio
async def test_devwatch_add_list_remove_roundtrip(tmp_db):
    from bot.handlers.intel import devwatch_command
    from bot.models.intel import DeployerWatch
    from bot.models.user import User
    from database.db import SessionLocal

    tg_id = 555111
    with SessionLocal() as s:
        s.add(User(telegram_id=tg_id))
        s.commit()

    # add
    update, context = _make_update_and_context(
        tg_id, ["add", DEPLOYER_HEX, "ethereum", "Sus", "Dev"]
    )
    await devwatch_command(update, context)
    update.message.reply_text.assert_awaited()
    assert "watching" in update.message.reply_text.call_args.args[0].lower()

    with SessionLocal() as s:
        watches = s.query(DeployerWatch).all()
        assert len(watches) == 1
        assert watches[0].deployer_address == DEPLOYER_HEX
        assert watches[0].chain == "ethereum"
        assert watches[0].label == "Sus Dev"

    # duplicate add is a no-op, not a second row
    update2, context2 = _make_update_and_context(tg_id, ["add", DEPLOYER_HEX, "ethereum"])
    await devwatch_command(update2, context2)
    with SessionLocal() as s:
        assert s.query(DeployerWatch).count() == 1

    # list
    update3, context3 = _make_update_and_context(tg_id, [])
    await devwatch_command(update3, context3)
    listed_text = update3.message.reply_text.call_args.args[0]
    assert "Sus Dev" in listed_text
    assert DEPLOYER_HEX[:6] in listed_text

    # remove by index
    update4, context4 = _make_update_and_context(tg_id, ["rm", "1"])
    await devwatch_command(update4, context4)
    with SessionLocal() as s:
        assert s.query(DeployerWatch).count() == 0


@pytest.mark.asyncio
async def test_devwatch_requires_start_first(tmp_db):
    from bot.handlers.intel import devwatch_command

    update, context = _make_update_and_context(999999999, [])
    await devwatch_command(update, context)
    update.message.reply_text.assert_awaited_once()
    assert "start" in update.message.reply_text.call_args.args[0].lower()


# ---------------------------------------------------------------------------
# (e) Graceful degradation when a Blockscout call fails
# ---------------------------------------------------------------------------


def _partial_failure_router(url: str) -> _FakeResp:
    """Holders endpoint 500s; everything else behaves normally."""
    if url.endswith(f"/tokens/{TOKEN}/holders"):
        return _FakeResp(500, {})
    if url.endswith(f"/tokens/{TOKEN}/transfers"):
        return _FakeResp(200, {"items": [], "next_page_params": None})
    if url.endswith(f"/tokens/{TOKEN}"):
        return _FakeResp(200, {"name": "Test Token", "symbol": "TT", "total_supply": "1000000"})
    if url.endswith(f"/addresses/{DEPLOYER}/transactions"):
        return _FakeResp(200, {"items": [], "next_page_params": None})
    if url.endswith(f"/addresses/{TOKEN}"):
        return _FakeResp(200, {"creator_address_hash": DEPLOYER})
    return _FakeResp(404, {})


@pytest.mark.asyncio
async def test_evm_graceful_degradation_on_holders_failure():
    patches = _patch_evm_session(_partial_failure_router)
    with patches[0], patches[1]:
        report = TokenIntelReport(token_address=TOKEN, chain="ethereum")
        await evm_source.enrich_report(report, "ethereum")

    # Holder-derived fields degrade to empty/None...
    assert report.top_holders == []
    assert report.top10_pct is None
    assert "evm_holders_unavailable" in report.notes

    # ...but unrelated fields still populate normally — one failing endpoint
    # never takes down the whole report.
    assert report.name == "Test Token"
    assert report.deployer == DEPLOYER

    # And flag derivation on a partially-degraded report never raises.
    TokenIntelService()._derive_flags(report)
    assert "HIGH_TOP10" not in report.flags


@pytest.mark.asyncio
async def test_evm_enrich_report_unknown_chain_notes_and_returns():
    report = TokenIntelReport(token_address=TOKEN, chain="not_a_real_chain")
    await evm_source.enrich_report(report, "not_a_real_chain")
    assert report.deployer is None
    assert any("no_blockscout_instance" in n for n in report.notes)


class _RaisingPostCtx:
    """Mimics aiohttp's ``session.post(...)`` async-context-manager shape, but
    raises on entry — the way a real connection failure would surface.
    """

    async def __aenter__(self):
        raise ConnectionError("rpc unreachable")

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_solana_source_never_raises_on_rpc_failure():
    """RPC errors must degrade per-field, never raise out of enrich_report."""
    from bot.services.token_intel import solana_source

    session = MagicMock()
    session.post = MagicMock(return_value=_RaisingPostCtx())

    with (
        patch(
            "bot.services.token_intel.solana_source.get_session", AsyncMock(return_value=session)
        ),
        patch(
            "bot.services.token_intel.solana_source.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
    ):
        report = TokenIntelReport(
            token_address="So1anaMintAddress11111111111111111111111", chain="solana"
        )
        await solana_source.enrich_report(report)

    assert report.top_holders == []
    assert report.deployer is None
    assert report.notes  # degradation notes were recorded, no exception raised
