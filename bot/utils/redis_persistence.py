"""Redis-backed persistence for python-telegram-bot."""

import json
import logging
from typing import Any, Dict, Optional, Tuple

from telegram.ext import BasePersistence, PersistenceInput

logger = logging.getLogger(__name__)


class RedisPersistence(BasePersistence):
    """Stores telegram conversation state in Redis so any instance can continue flows."""

    def __init__(self, redis_client, prefix: str = "ptb"):
        super().__init__(
            store_data=PersistenceInput(
                bot_data=True,
                chat_data=True,
                user_data=True,
                callback_data=True,
            ),
            update_interval=1,
        )
        self._redis = redis_client
        self._prefix = prefix

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------

    def _key(self, *parts: str) -> str:
        return ":".join([self._prefix, *parts])

    @staticmethod
    def _serialize(data: Any) -> str:
        return json.dumps(data, default=str)

    @staticmethod
    def _deserialize(raw: str) -> Any:
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw

    # ------------------------------------------------------------------
    # User data
    # ------------------------------------------------------------------

    async def get_user_data(self) -> Dict[int, dict]:
        try:
            raw = await self._redis.hgetall(self._key("user_data"))
            return {int(k): self._deserialize(v) for k, v in raw.items()}
        except Exception as e:
            logger.debug(f"get_user_data error: {e}")
            return {}

    async def update_user_data(self, user_id: int, data: dict) -> None:
        try:
            await self._redis.hset(
                self._key("user_data"), str(user_id), self._serialize(data)
            )
        except Exception as e:
            logger.debug(f"update_user_data error: {e}")

    async def refresh_user_data(self, user_id: int, user_data: dict) -> dict:
        try:
            raw = await self._redis.hget(self._key("user_data"), str(user_id))
            if raw is not None:
                return self._deserialize(raw)
        except Exception:
            pass
        return user_data

    async def drop_user_data(self, user_id: int) -> None:
        try:
            await self._redis.hdel(self._key("user_data"), str(user_id))
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Chat data
    # ------------------------------------------------------------------

    async def get_chat_data(self) -> Dict[int, dict]:
        try:
            raw = await self._redis.hgetall(self._key("chat_data"))
            return {int(k): self._deserialize(v) for k, v in raw.items()}
        except Exception as e:
            logger.debug(f"get_chat_data error: {e}")
            return {}

    async def update_chat_data(self, chat_id: int, data: dict) -> None:
        try:
            await self._redis.hset(
                self._key("chat_data"), str(chat_id), self._serialize(data)
            )
        except Exception as e:
            logger.debug(f"update_chat_data error: {e}")

    async def refresh_chat_data(self, chat_id: int, chat_data: dict) -> dict:
        try:
            raw = await self._redis.hget(self._key("chat_data"), str(chat_id))
            if raw is not None:
                return self._deserialize(raw)
        except Exception:
            pass
        return chat_data

    async def drop_chat_data(self, chat_id: int) -> None:
        try:
            await self._redis.hdel(self._key("chat_data"), str(chat_id))
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Bot data
    # ------------------------------------------------------------------

    async def get_bot_data(self) -> dict:
        try:
            raw = await self._redis.get(self._key("bot_data"))
            if raw is not None:
                return self._deserialize(raw)
        except Exception as e:
            logger.debug(f"get_bot_data error: {e}")
        return {}

    async def update_bot_data(self, data: dict) -> None:
        try:
            await self._redis.set(self._key("bot_data"), self._serialize(data))
        except Exception as e:
            logger.debug(f"update_bot_data error: {e}")

    async def refresh_bot_data(self, bot_data: dict) -> dict:
        try:
            raw = await self._redis.get(self._key("bot_data"))
            if raw is not None:
                return self._deserialize(raw)
        except Exception:
            pass
        return bot_data

    # ------------------------------------------------------------------
    # Callback data
    # ------------------------------------------------------------------

    async def get_callback_data(self) -> Optional[Tuple[list, dict]]:
        try:
            raw = await self._redis.get(self._key("callback_data"))
            if raw is not None:
                data = self._deserialize(raw)
                if isinstance(data, (list, tuple)) and len(data) == 2:
                    return tuple(data)
        except Exception as e:
            logger.debug(f"get_callback_data error: {e}")
        return None

    async def update_callback_data(self, data: Tuple[list, dict]) -> None:
        try:
            await self._redis.set(
                self._key("callback_data"), self._serialize(data)
            )
        except Exception as e:
            logger.debug(f"update_callback_data error: {e}")

    # ------------------------------------------------------------------
    # Conversations
    # ------------------------------------------------------------------

    async def get_conversations(self, name: str) -> Dict:
        try:
            raw = await self._redis.hgetall(self._key("conv", name))
            result = {}
            for k, v in raw.items():
                try:
                    key = self._deserialize(k)
                    # Conversation keys are tuples
                    if isinstance(key, list):
                        key = tuple(key)
                    result[key] = self._deserialize(v)
                except Exception:
                    result[k] = self._deserialize(v)
            return result
        except Exception as e:
            logger.debug(f"get_conversations error: {e}")
            return {}

    async def update_conversation(
        self, name: str, key: Tuple, new_state: Optional[object]
    ) -> None:
        try:
            serialized_key = self._serialize(key)
            if new_state is None:
                await self._redis.hdel(self._key("conv", name), serialized_key)
            else:
                await self._redis.hset(
                    self._key("conv", name),
                    serialized_key,
                    self._serialize(new_state),
                )
        except Exception as e:
            logger.debug(f"update_conversation error: {e}")

    # ------------------------------------------------------------------
    # Flush
    # ------------------------------------------------------------------

    async def flush(self) -> None:
        """No-op — Redis writes are immediate."""
        pass
