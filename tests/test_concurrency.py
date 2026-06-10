"""Tests for PerUserSerializingProcessor (per-user serialized update processing)."""

import asyncio
from types import SimpleNamespace

import pytest

from bot.utils.update_processor import PerUserSerializingProcessor


def _make_update(user_id=None, chat_id=None):
    """Build a minimal Update-like object. isinstance(Update) is bypassed by
    constructing a real telegram.Update where possible; here we monkey the type."""
    from telegram import Update, User, Chat

    update = Update(update_id=1)
    if user_id is not None:
        object.__setattr__(
            update, "_effective_user", User(id=user_id, first_name="t", is_bot=False)
        )
    if chat_id is not None:
        object.__setattr__(update, "_effective_chat", Chat(id=chat_id, type="private"))
    return update


def _probe(events, label, delay=0.05):
    async def coro():
        events.append(f"{label}:enter")
        await asyncio.sleep(delay)
        events.append(f"{label}:exit")

    return coro()


@pytest.mark.asyncio
async def test_same_user_updates_are_serialized():
    processor = PerUserSerializingProcessor(max_concurrent_updates=16)
    events = []
    u1 = _make_update(user_id=111)
    u2 = _make_update(user_id=111)

    await asyncio.gather(
        processor.do_process_update(u1, _probe(events, "a")),
        processor.do_process_update(u2, _probe(events, "b")),
    )

    # Strictly serialized: first coroutine fully exits before second enters.
    assert events == ["a:enter", "a:exit", "b:enter", "b:exit"]


@pytest.mark.asyncio
async def test_different_users_run_concurrently():
    processor = PerUserSerializingProcessor(max_concurrent_updates=16)
    events = []
    u1 = _make_update(user_id=111)
    u2 = _make_update(user_id=222)

    await asyncio.gather(
        processor.do_process_update(u1, _probe(events, "a")),
        processor.do_process_update(u2, _probe(events, "b")),
    )

    # Interleaved: both enter before either exits.
    assert events[:2] == ["a:enter", "b:enter"]


@pytest.mark.asyncio
async def test_chat_id_fallback_serializes():
    processor = PerUserSerializingProcessor(max_concurrent_updates=16)
    events = []
    u1 = _make_update(chat_id=-100)
    u2 = _make_update(chat_id=-100)

    await asyncio.gather(
        processor.do_process_update(u1, _probe(events, "a")),
        processor.do_process_update(u2, _probe(events, "b")),
    )

    assert events == ["a:enter", "a:exit", "b:enter", "b:exit"]


@pytest.mark.asyncio
async def test_no_user_or_chat_runs_without_lock():
    processor = PerUserSerializingProcessor(max_concurrent_updates=16)
    events = []
    u1 = _make_update()
    u2 = _make_update()

    await asyncio.gather(
        processor.do_process_update(u1, _probe(events, "a")),
        processor.do_process_update(u2, _probe(events, "b")),
    )

    assert events[:2] == ["a:enter", "b:enter"]
    assert len(processor._locks) == 0


@pytest.mark.asyncio
async def test_non_update_object_processed_without_lock():
    processor = PerUserSerializingProcessor(max_concurrent_updates=16)
    events = []
    await processor.do_process_update(SimpleNamespace(), _probe(events, "a", delay=0))
    assert events == ["a:enter", "a:exit"]
    assert len(processor._locks) == 0
