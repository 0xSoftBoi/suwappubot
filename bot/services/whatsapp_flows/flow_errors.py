"""Shared error-handling utility for WhatsApp flows.

Keeps internal exception details server-side and returns a safe,
reference-tagged message to users.
"""

import logging
import uuid

logger = logging.getLogger(__name__)


def user_safe_error(exc: Exception, context: str = "") -> str:
    """Log *exc* with a short reference id and return a user-friendly string.

    Args:
        exc:     The exception that was caught.
        context: Optional short label (e.g. "swap", "withdrawal") used only
                 in the server-side log line, never shown to the user.

    Returns:
        A WhatsApp-safe string like:
        "❌ Something went wrong — your funds are safe. Ref: a1b2c3d4."
    """
    ref_id = uuid.uuid4().hex[:8]
    label = f"[{context}] " if context else ""
    logger.error("%sref=%s %s: %s", label, ref_id, type(exc).__name__, exc, exc_info=True)
    return (
        f"❌ Something went wrong — your funds are safe. " f"Ref: {ref_id}. Try again in a moment."
    )
