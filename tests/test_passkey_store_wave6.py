"""Wave 6: passkey challenge store is shared (Redis) instead of per-process.

NOTE: api/main.py can't be imported under Python 3.9 (the repo uses 3.10+
`str | None` runtime syntax in its import chain), so this exercises the exact
mechanism _verify_passkey_challenge now relies on — the shared redis_cache store
keyed by the raw challenge, recovered by base64url-decoding the client's echoed
challenge — rather than importing the FastAPI app. api/main.py is py_compile-clean.
"""

import asyncio
import base64
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.utils.redis_cache import redis_cache


def _passkey_key(challenge: str) -> str:
    return f"passkey:challenge:{challenge}"


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


async def _create(challenge: str, entry: dict):
    await redis_cache.set(_passkey_key(challenge), entry, ttl_seconds=300)


async def _verify(encoded_challenge: str, expected_flow: str) -> bool:
    """Mirror of _verify_passkey_challenge's store interaction."""
    challenge = _b64url_decode(encoded_challenge).decode("utf-8")
    # Atomic fetch-and-delete: single-use even under concurrent verification.
    entry = await redis_cache.get_del(_passkey_key(challenge))
    if not entry:
        return False  # expired / unknown / already used
    return entry.get("type") == expected_flow


def test_challenge_create_then_verify_roundtrip():
    async def main():
        challenge = "abc_challenge-123"
        encoded = _b64url_encode(challenge.encode())
        await _create(challenge, {"type": "registration", "user_id": "u1"})

        # A different "replica" verifies against the same shared store.
        assert await _verify(encoded, "registration") is True
        # Single-use: the challenge is gone after verification.
        assert await _verify(encoded, "registration") is False
    asyncio.run(main())


def test_unknown_challenge_fails():
    async def main():
        encoded = _b64url_encode(b"never_issued")
        assert await _verify(encoded, "authentication") is False
    asyncio.run(main())


def test_type_mismatch_detected():
    async def main():
        challenge = "auth_ch"
        encoded = _b64url_encode(challenge.encode())
        await _create(challenge, {"type": "authentication"})
        # Verified as the wrong flow -> rejected.
        assert await _verify(encoded, "registration") is False
    asyncio.run(main())


def test_concurrent_verify_consumes_challenge_once():
    """Two concurrent verifications of the same challenge: exactly one wins.

    Regression for the TOCTOU replay — a get()+delete() pair let both reads
    see the challenge before either delete landed. get_del() is atomic.
    """
    async def main():
        challenge = "race_ch"
        encoded = _b64url_encode(challenge.encode())
        await _create(challenge, {"type": "registration"})

        r1, r2 = await asyncio.gather(
            _verify(encoded, "registration"),
            _verify(encoded, "registration"),
        )
        assert sorted([r1, r2]) == [False, True]
        # And it stays consumed afterwards.
        assert await _verify(encoded, "registration") is False
    asyncio.run(main())
