"""Regression: the Telegram bot token must never reach the logs.

httpx logs every request URL at INFO, and the Telegram Bot API carries the bot
token in the URL path. With LOG_LEVEL=INFO that published the full token to
Railway logs on every single API call — 26 occurrences in one log window when
this was found. Anyone able to read the logs could then read every message and
post as the bot.

bot/main.py pins the HTTP client loggers to WARNING regardless of LOG_LEVEL.
These tests pin that behavior so raising LOG_LEVEL can never re-open the leak.
"""

import logging

import pytest

# Importing bot.main applies the logger configuration as a module-level side
# effect; api.main imports it too, so both services inherit it.
import bot.main  # noqa: F401

HTTP_LOGGERS = ("httpx", "httpcore", "urllib3", "telegram.request")


@pytest.mark.parametrize("name", HTTP_LOGGERS)
def test_http_loggers_pinned_to_warning(name):
    """Each client that can carry a credential in a URL stays at WARNING."""
    logger = logging.getLogger(name)
    assert logger.getEffectiveLevel() >= logging.WARNING, (
        f"{name} is at {logging.getLevelName(logger.getEffectiveLevel())}; at INFO it "
        "logs full request URLs, which for Telegram includes the bot token."
    )


@pytest.mark.parametrize("name", HTTP_LOGGERS)
def test_info_records_are_dropped(name):
    """The level actually suppresses emission, not just the reported level."""
    assert logging.getLogger(name).isEnabledFor(logging.INFO) is False


@pytest.mark.parametrize("name", HTTP_LOGGERS)
def test_level_is_set_explicitly_not_inherited(name):
    """The level must be set ON these loggers, not merely inherited from a root
    that happens to be WARNING.

    This is the assertion that matters: inheriting is not a fix, because raising
    LOG_LEVEL to INFO would re-open the leak. Asserting on the root logger
    instead would test the harness — under pytest, basicConfig() is a no-op
    since pytest has already installed handlers.
    """
    assert logging.getLogger(name).level >= logging.WARNING
