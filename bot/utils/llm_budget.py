"""Cost-weighted, distributed token-bucket budget for LLM spend.

Why this exists: the daily counters in nl_intent_service are plain in-memory
dicts. With more than one replica each process keeps its own counters, so the
real ceiling is `cap x replicas`, and every deploy resets them to zero. They
also count *calls*, which cannot express that one Sonnet call costs ~14x a
DeepSeek call.

This module replaces both properties for the metered path:

  * **Distributed** — state lives in Redis (shared across replicas), reusing
    the connection already established by `bot.utils.redis_cache`. When Redis
    is unavailable it degrades to a per-process bucket exactly like
    RedisCache does, and says so in the logs; NL trading must never go
    offline because Redis blipped.
  * **Cost-weighted** — the bucket is denominated in **integer micro-dollars**
    (1 USD = 1_000_000), never floats (see
    docs/research/llm-credits/04-metering-architecture.md §6).
  * **Rolling, not calendar** — a token bucket refills continuously, so there
    is no midnight cliff and no fixed-window edge to game. This is the shape
    t3.chat moved to in 2026 after fixed monthly caps proved to scare users
    off while still failing to bound cost.

Reserve-then-settle: callers `try_consume()` a conservative estimate before
the provider call and `refund()` the unused remainder after, so a burst of
concurrent calls can't all pass a check against the same stale balance.

The bucket is a SPEND LIMITER, not an accounting ledger — `api_credits` +
`llm_credit_service` remain the source of truth for what a user actually owes.
A refund here never invents money; it only returns unspent reservation to the
rate-limit allowance.

Note on changing caps: a bucket keeps whatever token count it had when the
capacity changed, and refills toward the new capacity at the new rate. Raising
a limit therefore takes effect gradually over one window rather than instantly.
That is fine for config changes between deploys; it just means a raised cap
does not retroactively un-throttle an already-drained user.
"""

import logging
import math
import time
from typing import Tuple

logger = logging.getLogger(__name__)

USD_TO_MICROS = 1_000_000


def usd_to_micros(usd: float) -> int:
    """Convert USD to integer micro-dollars, rounding UP.

    Rounding up is deliberate: a reservation that rounds down would let a
    long tail of sub-micro-dollar calls escape the budget entirely.
    """
    return int(math.ceil(usd * USD_TO_MICROS))


# Atomic refill-and-consume. Redis Lua runs single-threaded per shard, so the
# read-modify-write can't interleave across replicas (the exact TOCTOU race an
# unlocked GET/SET pair would have).
_CONSUME_LUA = """
local capacity = tonumber(ARGV[1])
local window_s = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- Time comes from the SERVER, not the caller. Using each replica's own clock
-- let skew be harvested: a fast replica sees inflated elapsed time, refills
-- accordingly, and rewrites ts backwards, so alternating replicas could mint
-- refill indefinitely. Redis >=5 replicates script effects, so TIME is safe.
local t = redis.call('TIME')
local now_ms = t[1] * 1000 + math.floor(t[2] / 1000)

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed_ms = now_ms - ts
if elapsed_ms < 0 then elapsed_ms = 0 end
tokens = tokens + (elapsed_ms / 1000.0) * (capacity / window_s)
if tokens > capacity then tokens = capacity end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', KEYS[1], math.ceil(window_s * 2))
return {allowed, math.floor(tokens)}
"""

# Debit unconditionally, creating the bucket if absent and allowing it to go
# negative. Used to settle an overrun: the money is already spent, so the
# deduction must land. _REFUND_LUA returns -1 without writing when the hash is
# missing, which would silently DROP the debit.
_FORCE_CONSUME_LUA = """
local capacity = tonumber(ARGV[1])
local amount   = tonumber(ARGV[2])
local tokens   = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
if tokens == nil then
  tokens = capacity
  local t = redis.call('TIME')
  redis.call('HSET', KEYS[1], 'ts', t[1] * 1000 + math.floor(t[2] / 1000))
end
tokens = tokens - amount
redis.call('HSET', KEYS[1], 'tokens', tokens)
redis.call('EXPIRE', KEYS[1], 172800)
return math.floor(tokens)
"""

# Return unspent reservation, never exceeding capacity.
_REFUND_LUA = """
local capacity = tonumber(ARGV[1])
local amount   = tonumber(ARGV[2])
local tokens   = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
if tokens == nil then return -1 end
tokens = tokens + amount
if tokens > capacity then tokens = capacity end
redis.call('HSET', KEYS[1], 'tokens', tokens)
return math.floor(tokens)
"""


class LLMBudget:
    """Cost-weighted token bucket, Redis-backed with in-memory fallback."""

    # Re-warn at most this often while degraded, so a persistent outage stays
    # visible in logs instead of being announced once and never again.
    DEGRADED_WARN_INTERVAL_S = 60.0

    # Cap on the degraded fallback map. During a Redis outage every distinct
    # caller key would otherwise be retained forever, letting traffic grow the
    # process's memory without bound. Mirrors RedisCache.MAX_MEMORY_KEYS.
    MAX_MEMORY_KEYS = 10_000

    def __init__(self):
        # key -> (tokens, last_refill_epoch_seconds); only used when Redis is
        # unavailable. Per-process, so it is a safety net, not a real limit.
        self._memory: dict = {}
        self._last_degraded_warning = 0.0
        # Running count of calls served by the degraded per-process bucket.
        self.degraded_calls = 0

    # -- internals --------------------------------------------------------

    def _client(self):
        """The shared async Redis client, or None when unavailable."""
        try:
            from bot.utils.redis_cache import redis_cache

            if getattr(redis_cache, "_connected", False):
                return getattr(redis_cache, "_redis", None)
        except Exception:  # pragma: no cover - import guard
            pass
        return None

    def _warn_degraded(self, reason: str) -> None:
        """Warn that the cap is no longer fleet-wide, at most once per minute.

        Latching this for the whole process (the previous behavior) meant a
        single blip at startup permanently silenced every later flap, leaving
        operators with no signal that the effective ceiling had become
        `cap x replicas`. `degraded_calls` is a running counter for health
        surfaces to expose.
        """
        self.degraded_calls += 1
        now = time.time()
        if now - self._last_degraded_warning < self.DEGRADED_WARN_INTERVAL_S:
            return
        self._last_degraded_warning = now
        logger.warning(
            "llm_budget: Redis unavailable (%s) — falling back to a "
            "PER-PROCESS budget (%d degraded calls so far). With multiple "
            "replicas the effective ceiling is this budget x replica count.",
            reason,
            self.degraded_calls,
        )

    def _memory_consume(
        self, key: str, capacity: int, window_s: int, cost: int
    ) -> Tuple[bool, int]:
        now = time.time()
        tokens, ts = self._memory.get(key, (float(capacity), now))
        tokens = min(capacity, tokens + (now - ts) * (capacity / window_s))
        allowed = tokens >= cost
        if allowed:
            tokens -= cost
        self._evict_if_full(key)
        self._memory[key] = (tokens, now)
        return allowed, int(tokens)

    def _evict_if_full(self, key: str) -> None:
        """Bound the degraded map before inserting a new key.

        Evicts the least-recently-touched entry. Dropping a bucket only resets
        that caller's degraded allowance, which is already best-effort —
        unbounded memory growth during a Redis outage is the worse failure.
        Every write path must go through this, settlement included.
        """
        if key in self._memory or len(self._memory) < self.MAX_MEMORY_KEYS:
            return
        oldest = min(self._memory, key=lambda k: self._memory[k][1])
        self._memory.pop(oldest, None)

    # -- public API -------------------------------------------------------

    async def try_consume(
        self, key: str, cost_micros: int, capacity_micros: int, window_seconds: int = 86_400
    ) -> Tuple[bool, int]:
        """Attempt to consume `cost_micros` from bucket `key`.

        Returns (allowed, remaining_micros). Never raises — a limiter failure
        must not take the feature offline.
        """
        if capacity_micros <= 0:
            return True, 0  # unlimited / disabled
        cost_micros = max(0, int(cost_micros))

        client = self._client()
        if client is None:
            self._warn_degraded("no connection")
            return self._memory_consume(key, capacity_micros, window_seconds, cost_micros)

        try:
            allowed, remaining = await client.eval(
                _CONSUME_LUA,
                1,
                key,
                capacity_micros,
                window_seconds,
                cost_micros,
            )
            return bool(int(allowed)), int(remaining)
        except Exception as e:
            self._warn_degraded(str(e))
            return self._memory_consume(key, capacity_micros, window_seconds, cost_micros)

    async def force_consume(self, key: str, micros: int, capacity_micros: int) -> None:
        """Deduct `micros` even if the bucket lacks them, allowing it to go
        negative. Used to settle an overrun: the money is already spent, so the
        deduction must land rather than being dropped because the bucket is
        nearly empty, absent, or Redis is unavailable.
        """
        micros = int(micros)
        if micros <= 0 or capacity_micros <= 0:
            return

        client = self._client()
        if client is None:
            self._warn_degraded("no connection")
        else:
            try:
                await client.eval(_FORCE_CONSUME_LUA, 1, key, capacity_micros, micros)
                return
            except Exception as e:
                # Fall through to the in-memory bucket rather than dropping an
                # already-incurred charge.
                self._warn_degraded(f"force_consume: {e}")

        now = time.time()
        tokens, ts = self._memory.get(key, (float(capacity_micros), now))
        self._evict_if_full(key)
        self._memory[key] = (tokens - micros, ts)

    async def refund(self, key: str, micros: int, capacity_micros: int) -> None:
        """Return unspent reservation to the bucket. Best-effort, never raises.

        A NEGATIVE `micros` deducts (see `force_consume`) and may drive the
        bucket below zero; the Lua clamps only at capacity, never at zero.
        """
        micros = int(micros)
        if micros == 0 or capacity_micros <= 0:
            return

        client = self._client()
        if client is None:
            tokens, ts = self._memory.get(key, (float(capacity_micros), time.time()))
            self._memory[key] = (min(capacity_micros, tokens + micros), ts)
            return

        try:
            await client.eval(_REFUND_LUA, 1, key, capacity_micros, micros)
        except Exception as e:
            logger.warning("llm_budget: refund failed for %s: %s", key, e)

    def reset(self) -> None:
        """Clear the in-memory fallback state (tests)."""
        self._memory.clear()
        self._last_degraded_warning = 0.0
        self.degraded_calls = 0


# Module-level singleton, mirroring bot.utils.redis_cache.redis_cache.
llm_budget = LLMBudget()


def user_budget_key(user_id) -> str:
    return f"llmbudget:user:{user_id}"


GLOBAL_BUDGET_KEY = "llmbudget:global"
