"""Logging filter that redacts sensitive data from log output.

Registered globally so every logger automatically strips API keys,
private keys, JWT tokens, and other secrets before they reach handlers.
"""

import logging
import re

# Patterns that match sensitive data in log messages.
# Each tuple is (compiled regex, replacement string).
_REDACT_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Private keys (hex, 64+ chars)
    (re.compile(r"(?:0x)?[0-9a-fA-F]{64,}"), "[REDACTED_KEY]"),
    # Base58 private keys (Solana) - 87-88 chars of base58 alphabet
    (re.compile(r"\b[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{87,88}\b"), "[REDACTED_KEY]"),
    # API key prefixes (sk-*, xkey-*, etc.)
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b"), "[REDACTED_API_KEY]"),
    # Bearer tokens
    (re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE), "Bearer [REDACTED]"),
    # JWT tokens (three base64 segments separated by dots)
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "[REDACTED_JWT]"),
    # URL query params containing key/token/secret
    (re.compile(r"([?&](?:key|token|secret|api_key|apikey|access_token)=)[^&\s]+", re.IGNORECASE), r"\1[REDACTED]"),
    # RPC URLs that embed API keys in the path (e.g. https://eth-mainnet.g.alchemy.com/v2/<key>)
    (re.compile(r"(https?://[^/]+/v[0-9]+/)[A-Za-z0-9_\-]{20,}"), r"\1[REDACTED]"),
    # KMS key IDs (arn:aws:kms:...)
    (re.compile(r"(arn:aws:kms:[^:]+:[^:]+:key/)[0-9a-f\-]+"), r"\1[REDACTED]"),
    # Generic long hex strings that might be secrets (>= 40 hex chars, not already caught)
    (re.compile(r"\b[0-9a-fA-F]{40,}\b"), "[REDACTED_HEX]"),
]


class SensitiveDataFilter(logging.Filter):
    """Logging filter that redacts sensitive patterns from log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Sanitize the formatted message
        if record.args:
            # Format the message first, then sanitize
            try:
                record.msg = str(record.msg) % record.args
                record.args = None
            except (TypeError, ValueError):
                pass

        record.msg = self._sanitize(str(record.msg))
        return True

    @staticmethod
    def _sanitize(text: str) -> str:
        for pattern, replacement in _REDACT_PATTERNS:
            text = pattern.sub(replacement, text)
        return text


def install_log_sanitizer() -> None:
    """Install the sensitive-data filter on the root logger.

    Call this once during application startup (e.g. in main.py after
    ``logging.basicConfig``).
    """
    root = logging.getLogger()
    root.addFilter(SensitiveDataFilter())
