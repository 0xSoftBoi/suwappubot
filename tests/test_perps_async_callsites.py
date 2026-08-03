"""Regression tests for the async perps call-site contract. MONEY-PATH.

`get_positions` / `get_position` became coroutines when they started syncing
with HyperLiquid before returning. Every caller has to await them — a missed
await hands the caller a coroutine object instead of positions, which silently
empties the Telegram /perps listing, both WhatsApp flows and the terminal
positions route rather than raising anywhere obvious.

These tests pin the contract in both directions: the methods stay coroutines,
and no caller forgets the await.
"""

import ast
import inspect
from decimal import Decimal
from pathlib import Path

import pytest
from unittest.mock import MagicMock, patch

from bot.models.perps import PerpPosition
from bot.services.perps_service import PerpsService

REPO_ROOT = Path(__file__).resolve().parent.parent

AWAITED_METHODS = {"get_positions", "get_position"}

# Scanned rather than listed: a hardcoded list of known callers would not guard
# the case this test exists for — a *new* caller that forgets the await.
SCANNED_TREES = ["bot", "api"]


def _python_files():
    for tree in SCANNED_TREES:
        yield from sorted((REPO_ROOT / tree).rglob("*.py"))


def _capturing_session():
    """A session whose queries return the PerpPosition that was actually inserted.

    Asserting against a detached mock would let open_position write a level onto
    the real row without the test noticing.
    """
    session = MagicMock()
    added = []
    session.add.side_effect = added.append

    def _first():
        for obj in added:
            if isinstance(obj, PerpPosition):
                return obj
        return None

    session.query.return_value.filter_by.return_value.first.side_effect = _first
    return session, _first


def _session_ctx(session):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


def _unawaited_calls(path: Path) -> list[str]:
    """Return `perps_service.<method>(...)` calls in `path` that lack an await."""
    tree = ast.parse(path.read_text())

    awaited = {
        id(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Await) and isinstance(node.value, ast.Call)
    }

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr not in AWAITED_METHODS:
            continue
        if not (isinstance(func.value, ast.Name) and func.value.id == "perps_service"):
            continue
        if id(node) not in awaited:
            offenders.append(f"{path.name}:{node.lineno} perps_service.{func.attr}(...)")
    return offenders


def test_position_reads_are_awaited():
    """A missed await returns a coroutine, so the caller silently shows nothing."""
    offenders = []
    for path in _python_files():
        offenders.extend(_unawaited_calls(path))
    assert offenders == [], "un-awaited position reads: " + ", ".join(offenders)


def test_the_scan_actually_reaches_the_known_callers():
    """A scan that silently matched nothing would make the test above meaningless."""
    seen = set()
    for path in _python_files():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in AWAITED_METHODS
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "perps_service"
            ):
                seen.add(path.name)

    assert "perps.py" in seen and "terminal.py" in seen, f"scan found only {sorted(seen)}"


def test_position_readers_are_coroutines():
    """If these stop being async the test above would pass while meaning nothing."""
    for name in AWAITED_METHODS:
        assert inspect.iscoroutinefunction(
            getattr(PerpsService, name)
        ), f"PerpsService.{name} is expected to be async"


@pytest.mark.asyncio
async def test_open_position_survives_a_rejected_tp_order():
    """The position is already live on-chain — a rejected trigger must not abort the open.

    Raising here would skip the points award and report failure for a trade the
    user really holds.
    """
    service = PerpsService()
    account = MagicMock(hl_address="0x123abc", user_id=123)

    with patch.object(service, "_decrypt_credentials", return_value=("key", "secret")):
        with patch.object(service._client, "place_order", return_value=None):
            placed = await service._place_tp_sl(
                user_id=123,
                account=account,
                market="ETH-USD",
                side="long",
                size=1.5,
                order_type="take_profit",
                price=2500.0,
                position_id=1,
                raise_on_error=False,
            )

    assert placed is False


@pytest.mark.asyncio
async def test_rejected_trigger_leaves_no_stored_level():
    """MONEY-PATH. A stored level with no resting order says "protected" when nothing is.

    open_position inserts the row with no levels and writes each one back only
    after the exchange accepts that trigger, so a refusal must leave the column
    untouched — there is no window in which the row advertises a phantom stop.
    """
    service = PerpsService()
    session, inserted = _capturing_session()
    ctx = _session_ctx(session)

    fill = MagicMock(order_id="o1", status="filled", fill_price=2000.0)

    with (
        patch.object(service._client, "get_market_max_leverage", return_value=20),
        patch.object(service, "get_account", return_value=MagicMock(hl_address="0xabc")),
        patch.object(service, "_decrypt_credentials", return_value=("k", "s")),
        patch.object(service, "ensure_builder_approved", return_value=None),
        patch.object(service, "ensure_referrer", return_value=None),
        patch.object(service._client, "place_order", return_value=fill),
        patch.object(service._client, "get_mark_price", return_value=2000.0),
        patch.object(service, "_award_xp", return_value=None),
        patch("bot.services.perps_service.get_session", return_value=ctx),
        # HyperLiquid refuses both protective triggers.
        patch.object(service, "_place_tp_sl", return_value=False),
    ):
        await service.open_position(
            user_id=123,
            market="ETH-USD",
            side="long",
            size=1.5,
            leverage=2,
            tp_price=2500.0,
            sl_price=1500.0,
        )

    row = inserted()
    assert row.tp_price is None, "refused take profit must never reach the inserted row"
    assert row.sl_price is None, "refused stop loss must never reach the inserted row"


@pytest.mark.asyncio
async def test_accepted_trigger_is_written_back_to_the_row():
    """MONEY-PATH. The mirror of the test above, so neither can pass vacuously.

    A row that starts empty and stays empty proves nothing unless an accepted
    trigger demonstrably fills it in.
    """
    service = PerpsService()
    session, inserted = _capturing_session()
    ctx = _session_ctx(session)

    fill = MagicMock(order_id="o1", status="filled", fill_price=2000.0)

    with (
        patch.object(service._client, "get_market_max_leverage", return_value=20),
        patch.object(service, "get_account", return_value=MagicMock(hl_address="0xabc")),
        patch.object(service, "_decrypt_credentials", return_value=("k", "s")),
        patch.object(service, "ensure_builder_approved", return_value=None),
        patch.object(service, "ensure_referrer", return_value=None),
        patch.object(service._client, "place_order", return_value=fill),
        patch.object(service._client, "get_mark_price", return_value=2000.0),
        patch.object(service, "_award_xp", return_value=None),
        patch("bot.services.perps_service.get_session", return_value=ctx),
        # HyperLiquid accepts both protective triggers.
        patch.object(service, "_place_tp_sl", return_value=True),
    ):
        await service.open_position(
            user_id=123,
            market="ETH-USD",
            side="long",
            size=1.5,
            leverage=2,
            tp_price=2500.0,
            sl_price=1500.0,
        )

    row = inserted()
    assert row.tp_price == Decimal("2500.0")
    assert row.sl_price == Decimal("1500.0")


@pytest.mark.asyncio
async def test_place_tp_sl_still_raises_by_default():
    """Editing protection must fail loudly — the caller needs to know it did not land."""
    service = PerpsService()
    account = MagicMock(hl_address="0x123abc", user_id=123)

    with patch.object(service, "_decrypt_credentials", return_value=("key", "secret")):
        with patch.object(service._client, "place_order", return_value=None):
            with pytest.raises(Exception, match="Failed to place"):
                await service._place_tp_sl(
                    user_id=123,
                    account=account,
                    market="ETH-USD",
                    side="long",
                    size=1.5,
                    order_type="take_profit",
                    price=2500.0,
                    position_id=1,
                )
