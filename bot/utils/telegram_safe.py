"""Telegram Markdown-safety helpers.

Rendering dynamic or external content (token symbols, Polymarket questions, user
input) with ``parse_mode="Markdown"`` is a crash vector: an unbalanced ``_ * [ ``
makes Telegram reject the message with a ``BadRequest`` ("Can't parse entities"),
so the user sees nothing. Use these everywhere dynamic content meets Markdown.

- ``safe_md(s)``: strip the legacy-Markdown control chars from a dynamic string.
  Stripping (not escaping) keeps truncation safe — no orphaned control char.
- ``send_md_safe(update, text, ...)``: render Markdown, falling back to plain
  text on a parse failure. Callback-safe (edits on a button, replies on a
  command) and ignores the benign "message is not modified" refresh error.
"""

import logging
import re

from telegram import Update
from telegram.error import BadRequest

logger = logging.getLogger(__name__)

_MD_CONTROL = re.compile(r"[_*`\[\]]")


def safe_md(s) -> str:
    """Strip Telegram legacy-Markdown control chars from a dynamic string."""
    return _MD_CONTROL.sub("", str(s or ""))


async def send_md_safe(
    update: Update, text: str, reply_markup=None, edit_on_callback: bool = True
) -> None:
    """Send/edit a Markdown message, retrying as PLAIN text if Markdown fails to
    parse. Use for any message mixing static Markdown with dynamic content.

    - On a callback update, edits the message (set edit_on_callback=False to reply
      instead); on a command, replies.
    - "Message is not modified" (identical refresh) is benign and ignored.
    - A parse failure retries WITHOUT parse_mode rather than silently dropping.
    """
    cq = update.callback_query
    use_edit = bool(cq and edit_on_callback)
    try:
        if use_edit:
            await cq.edit_message_text(text, parse_mode="Markdown", reply_markup=reply_markup)
        else:
            await update.effective_message.reply_text(
                text, parse_mode="Markdown", reply_markup=reply_markup
            )
    except BadRequest as e:
        if "not modified" in str(e).lower():
            return
        try:
            if use_edit:
                await cq.edit_message_text(text, reply_markup=reply_markup)
            else:
                await update.effective_message.reply_text(text, reply_markup=reply_markup)
        except Exception as e2:
            logger.warning(f"send_md_safe fallback failed: {e2}")
