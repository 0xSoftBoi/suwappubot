"""Process-wide logging configuration shared by every Python entrypoint.

This used to live at module level in ``bot/main.py``. ``api/main.py`` got its
log format — and, more importantly, the httpx/urllib3 silencing that keeps the
Telegram bot token and keyed RPC URLs out of Railway logs — only as a side
effect of ``from bot.main import add_handlers``. The worker process no longer
imports the handler tree (it never registers a handler), so the setup has to
be explicit and idempotent rather than an accident of import order.
"""

from __future__ import annotations

import logging

# httpx logs every request URL at INFO and the Telegram Bot API puts the bot
# token IN the path, so a plain INFO log level published the full token to the
# platform logs on every API call. Keyed RPC providers (Alchemy, Helius) ride
# their credentials in the URL too. Pin these regardless of LOG_LEVEL.
_NOISY_LOGGERS = ("httpx", "httpcore", "urllib3", "telegram.request")

_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

_configured = False


def configure_logging(level: str | None = None) -> None:
    """Install the root handler once and pin the credential-leaking loggers.

    Safe to call from every entrypoint; only the first call installs the root
    handler (``logging.basicConfig`` is itself a no-op once the root logger has
    handlers, but we also skip the ``settings`` import on repeat calls).
    """
    global _configured

    if level is None:
        from bot.config.settings import settings

        level = settings.log_level

    numeric_level = getattr(logging, str(level).upper(), logging.INFO)
    if not _configured:
        logging.basicConfig(format=_FORMAT, level=numeric_level)
        _configured = True

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
