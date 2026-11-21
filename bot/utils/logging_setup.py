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
import sys

# httpx logs every request URL at INFO and the Telegram Bot API puts the bot
# token IN the path, so a plain INFO log level published the full token to the
# platform logs on every API call. Keyed RPC providers (Alchemy, Helius) ride
# their credentials in the URL too. Pin these regardless of LOG_LEVEL.
_NOISY_LOGGERS = ("httpx", "httpcore", "urllib3", "telegram.request")

_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

_configured = False


class _BelowErrorFilter(logging.Filter):
    """Pass only records strictly below ERROR (they go to stdout)."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno < logging.ERROR


def _build_handlers() -> list[logging.Handler]:
    """INFO/WARNING -> stdout, ERROR+ -> stderr.

    Railway tags every stderr line severity "error", so a single stderr handler
    made all of our INFO traffic look like an outage and buried real errors.
    """
    formatter = logging.Formatter(_FORMAT)
    out = logging.StreamHandler(sys.stdout)
    out.addFilter(_BelowErrorFilter())
    out.setFormatter(formatter)
    err = logging.StreamHandler(sys.stderr)
    err.setLevel(logging.ERROR)
    err.setFormatter(formatter)
    return [out, err]


def route_server_loggers() -> None:
    """Make uvicorn's loggers follow the root handlers.

    uvicorn installs its own dictConfig (stderr handler, propagate=False) when
    the server starts — after our import-time setup — so this must be callable
    again from the app lifespan, which runs after uvicorn has configured itself.
    """
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        for h in list(lg.handlers):
            lg.removeHandler(h)
        lg.propagate = True


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
        # Replace only plain StreamHandlers (e.g. a default stderr handler a
        # library installed first). Not basicConfig(force=True): that strips
        # EVERY root handler, including pytest's capture handlers (subclasses,
        # so the exact-type check skips them).
        root = logging.getLogger()
        for h in list(root.handlers):
            if type(h) is logging.StreamHandler:
                root.removeHandler(h)
        for h in _build_handlers():
            root.addHandler(h)
        root.setLevel(numeric_level)
        _configured = True
    route_server_loggers()

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
