"""Sentry error-tracking integration.

Fully optional: no-op unless `SENTRY_DSN` is configured. Wallet private keys,
KMS material, mnemonics, and API tokens flow through this codebase, so every
event is passed through an aggressive recursive scrubber before it ever
leaves the process. Never raise on init failure — a broken Sentry config
must never crash or degrade the bot.
"""

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Case-insensitive substrings. If a dict key CONTAINS any of these, its value
# is redacted. Key matching alone is not enough — see _SECRET_VALUE_PATTERNS
# for the value-level pass that catches secrets interpolated into strings.
_SENSITIVE_KEY_MARKERS = (
    "private_key",
    # camelCase must be listed explicitly: lowercasing "privateKey" yields
    # "privatekey", which contains neither "private_key" nor "privkey". We
    # exchange camelCase JSON with api-ts, Turnkey and 0x, so this was a real
    # bypass, not a hypothetical one.
    "privatekey",
    "privkey",
    "secret",
    "mnemonic",
    "seed",
    "password",
    "passphrase",
    "credential",
    "bearer",
    "signature",
    "keystore",
    "xprv",
    "wif",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "session",
    "encrypted_key",
    "encryptedkey",
    "kms",
    "dek",
    "x-api-key",
    "telegram_bot_token",
    "wallet_key",
    "walletkey",
    "dsn",
)

REDACTED = "[REDACTED]"

# Deep enough for a real Sentry event (exception.values[].stacktrace.frames[].
# vars.<obj>.<attr> is already ~8 levels from the root) while still bounding
# pathological input. Past this we emit REDACTED, never the raw value.
_MAX_DEPTH = 24

# Value-level patterns. Key matching cannot catch a secret that was interpolated
# into a message — e.g. `raise ValueError(f"bad key {pk}")` produces a plain
# string under the key "value". These patterns catch the high-confidence shapes
# we actually handle. Ordered most-specific first.
# Credentialed RPC/API endpoints put the key in the URL PATH, under a perfectly
# innocent key name like "url". Sentry's httplib integration records every
# outbound request as a breadcrumb, so an RPC error would otherwise ship our
# paid Alchemy/Helius/Infura keys. Handled separately from the patterns below
# because it rewrites (keeping scheme+host) rather than replacing outright.
# Mirrors CREDENTIALED_URL in api-ts/src/lib/sentryRedact.ts.
_CREDENTIALED_URL = re.compile(
    r"(https?://[A-Za-z0-9.-]*\.?"
    r"(?:alchemy\.com|helius[-.]?(?:rpc|xyz)?\.[a-z]+|infura\.io|"
    r"quicknode\.(?:pro|com)|blastapi\.io|ankr\.com|chainstack\.com)"
    r"[^\s\"']*)",
    re.IGNORECASE,
)

# Redacted outright. Keep in sync with SECRET_VALUE_PATTERNS in
# api-ts/src/lib/sentryRedact.ts.
_SECRET_VALUE_PATTERNS = (
    # Telegram bot token: <digits>:<35 base64url chars>
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b"),
    # JWT / JWS compact serialization
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+"),
    # AWS access key id
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    # Long hex runs — EVM keys (64), ed25519 keypair hex (128), and anything
    # else key-length. Deliberately NOT anchored at exactly 64: a \b-anchored
    # 64-char pattern cannot match inside a longer hex run, so 128-hex secrets
    # slipped through entirely.
    re.compile(r"\b(?:0x)?[a-fA-F0-9]{40,}\b"),
    # Solana base58 secret keys (~87-88 chars). Base58 excludes 0/O/I/l.
    re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{80,90}\b"),
)

# Guard against pathological inputs (e.g. a multi-MB HTML error body captured
# as an exception value) costing a full scan per pattern on the request path.
_MAX_SCRUB_TEXT = 100_000


def _key_is_sensitive(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return any(marker in lowered for marker in _SENSITIVE_KEY_MARKERS)


def _redact_url(match: "re.Match") -> str:
    """Keep scheme://host so the error stays diagnosable, drop the credential."""
    url = match.group(1)
    parts = url.split("/", 3)  # ['https:', '', 'host', 'rest...']
    if len(parts) >= 3:
        return f"{parts[0]}//{parts[2]}/{REDACTED}"
    return REDACTED


def _scrub_text(text: str) -> str:
    """Redact secret-shaped substrings inside a free-text string.

    Key-based redaction cannot catch a secret interpolated into a message, or
    an API key sitting in a URL path under the benign key "url".

    Note this deliberately also matches a 64-hex *transaction hash*, which is
    harmless to lose from an error message and not worth the risk of trying to
    distinguish from a private key.
    """
    if len(text) > _MAX_SCRUB_TEXT:
        # Too big to scan safely; we cannot prove it is clean, so drop it.
        return REDACTED
    text = _CREDENTIALED_URL.sub(_redact_url, text)
    for pattern in _SECRET_VALUE_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


def _scrub_value(value: Any, depth: int = 0) -> Any:
    """Recursively redact any sensitive keys/values in a nested structure."""
    if depth > _MAX_DEPTH:
        return REDACTED

    if isinstance(value, dict):
        scrubbed = {}
        for k, v in value.items():
            if _key_is_sensitive(k):
                scrubbed[k] = REDACTED
            else:
                scrubbed[k] = _scrub_value(v, depth + 1)
        return scrubbed

    if isinstance(value, (list, tuple)):
        scrubbed_list = [_scrub_value(item, depth + 1) for item in value]
        return type(value)(scrubbed_list) if isinstance(value, tuple) else scrubbed_list

    if isinstance(value, (set, frozenset)):
        # Sets were previously returned untouched — a set of secret strings
        # shipped verbatim via Sentry's repr-based serialization.
        return sorted(_scrub_value(item, depth + 1) for item in map(str, value))

    if isinstance(value, str):
        return _scrub_text(value)

    if isinstance(value, (bytes, bytearray)):
        # Decrypted key material is handled as bytes in this codebase, and
        # Sentry serializes it via repr(). Scan the decoded form.
        try:
            return _scrub_text(value.decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001 — never let scrubbing raise
            return REDACTED

    return value


def scrub_event(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """Sentry `before_send` hook — recursively redact sensitive data.

    Deny-by-default: the ENTIRE event is walked and scrubbed, rather than a
    hand-listed set of fields. Redaction happens on two axes:

      - **Keys**: any dict key matching a sensitive marker has its value
        replaced (the key itself is kept, so the shape stays readable).
      - **Values**: free text is scanned for secret-shaped substrings — keys,
        JWTs, bot tokens, AWS ids, and credentialed RPC URLs. Key matching
        alone cannot catch a secret interpolated into a message.

    Request bodies, URLs and the ASGI environ are deleted outright.

    Local variables in stack frames are excluded at the SDK integration level
    (`include_local_variables=False`) rather than scrubbed here, since locals
    in this codebase hold decrypted key material under arbitrary names that
    key-based redaction cannot recognize.

    Returns None to DROP the event if anything goes wrong — failing closed.
    """
    try:
        # ── 1. Hard deletes: fields we never want to transmit at all. ──
        request = event.get("request")
        if isinstance(request, dict):
            # Body, and the URL — with the FastAPI/Starlette integration the
            # full URL *including the query string* lands in request["url"],
            # so redacting query_string alone left the same secret in place.
            # `env` carries the WSGI/ASGI environ.
            for field in ("data", "url", "env"):
                request.pop(field, None)
            if "query_string" in request:
                request["query_string"] = REDACTED

        # ── 2. Scrub the WHOLE event, not an allow-list of fields. ──
        # This used to enumerate request/extra/contexts/tags/breadcrumbs/
        # exception/logentry, which meant every other field in Sentry's schema
        # shipped raw: `user`, `transaction`, `server_name`, `modules`,
        # `threads[]`, and stacktrace frames' `vars`/`pre_context`/
        # `post_context`. Deny-by-default is the only safe posture here — a
        # field we forgot must be scrubbed, not exempt.
        scrubbed = _scrub_value(event)
        if not isinstance(scrubbed, dict):
            # Depth cap collapsed the event itself — refuse to send it.
            return None
        return scrubbed
    except Exception:
        # Scrubbing must never itself crash event delivery. If scrubbing
        # fails for any reason, drop the event entirely rather than risk
        # sending unscrubbed data.
        logger.warning("Sentry before_send scrubber failed; dropping event", exc_info=True)
        return None


def init_sentry() -> bool:
    """Initialize Sentry if SENTRY_DSN is configured. Fully optional.

    Returns True if Sentry was initialized, False otherwise (no DSN, or
    init failed). Never raises.
    """
    try:
        from bot.config.settings import settings

        if not settings.sentry_dsn:
            logger.debug("SENTRY_DSN not set — Sentry disabled")
            return False

        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            release=settings.sentry_release,
            traces_sample_rate=0,
            send_default_pii=False,
            before_send=scrub_event,
            include_local_variables=False,
            max_request_body_size="never",
        )
        logger.info(
            "Sentry initialized (environment=%s, release=%s)",
            settings.sentry_environment,
            settings.sentry_release or "unset",
        )
        return True
    except Exception:
        logger.warning("Sentry initialization failed — continuing without it", exc_info=True)
        return False
