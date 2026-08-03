"""Regression tests for the async perps call-site contract.

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
from pathlib import Path

import pytest
from unittest.mock import MagicMock, patch

from bot.services.perps_service import PerpsService

REPO_ROOT = Path(__file__).resolve().parent.parent

# Every module that reads positions through the service.
CALLER_MODULES = [
    "api/routes/terminal.py",
    "bot/handlers/positions.py",
    "bot/handlers/perps.py",
    "bot/services/whatsapp_flows/perps_flow.py",
    "bot/services/whatsapp_flows/positions_flow.py",
]

AWAITED_METHODS = {"get_positions", "get_position"}


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


@pytest.mark.parametrize("module", CALLER_MODULES)
def test_position_reads_are_awaited(module):
    """A missed await returns a coroutine, so the caller silently shows nothing."""
    offenders = _unawaited_calls(REPO_ROOT / module)
    assert offenders == [], "un-awaited position reads: " + ", ".join(offenders)


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
