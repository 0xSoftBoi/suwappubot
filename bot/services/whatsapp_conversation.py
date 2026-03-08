"""Redis-backed conversation state manager for WhatsApp multi-step flows."""

import logging
import json
import time
from typing import Any, Dict, Optional

from bot.utils.redis_cache import redis_cache

logger = logging.getLogger(__name__)

DEFAULT_TTL = 1800  # 30 minutes


class ConversationState:
    """Snapshot of a user's current conversation state."""

    __slots__ = ("flow", "step", "data", "updated_at")

    def __init__(self, flow: str, step: str, data: Dict[str, Any], updated_at: float = None):
        self.flow = flow
        self.step = step
        self.data = data
        self.updated_at = updated_at or time.time()

    def to_dict(self) -> dict:
        return {
            "flow": self.flow,
            "step": self.step,
            "data": self.data,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ConversationState":
        return cls(
            flow=d["flow"],
            step=d["step"],
            data=d.get("data", {}),
            updated_at=d.get("updated_at"),
        )


class ConversationManager:
    """
    Manages per-user conversation state backed by Redis (with in-memory fallback).

    Keyed by phone number (WhatsApp) or user identifier.  Each active conversation
    stores the flow name, current step, and arbitrary data dict with a configurable TTL.
    """

    KEY_PREFIX = "wa_conv"

    def _key(self, user_id: str) -> str:
        return f"{self.KEY_PREFIX}:{user_id}"

    # --- read / write --------------------------------------------------

    async def get_state(self, user_id: str) -> Optional[ConversationState]:
        """Return the active conversation state, or None if expired/absent."""
        raw = await redis_cache.get(self._key(user_id))
        if raw is None:
            return None
        try:
            if isinstance(raw, str):
                raw = json.loads(raw)
            return ConversationState.from_dict(raw)
        except Exception as e:
            logger.debug(f"Corrupt conversation state for {user_id}: {e}")
            await self.clear_state(user_id)
            return None

    async def set_state(
        self,
        user_id: str,
        flow: str,
        step: str,
        data: Dict[str, Any] = None,
        ttl: int = DEFAULT_TTL,
    ) -> ConversationState:
        """Create or overwrite the conversation state."""
        state = ConversationState(flow=flow, step=step, data=data or {})
        await redis_cache.set(self._key(user_id), state.to_dict(), ttl_seconds=ttl)
        return state

    async def update_step(
        self,
        user_id: str,
        step: str,
        data_update: Dict[str, Any] = None,
        ttl: int = DEFAULT_TTL,
    ) -> Optional[ConversationState]:
        """Advance the step and optionally merge new data into the existing state."""
        state = await self.get_state(user_id)
        if state is None:
            return None
        state.step = step
        if data_update:
            state.data.update(data_update)
        state.updated_at = time.time()
        await redis_cache.set(self._key(user_id), state.to_dict(), ttl_seconds=ttl)
        return state

    async def clear_state(self, user_id: str) -> None:
        """Remove the conversation state (e.g. on cancel or completion)."""
        await redis_cache.delete(self._key(user_id))


# Singleton
conversation_manager = ConversationManager()
