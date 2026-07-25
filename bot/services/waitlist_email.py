"""Best-effort transactional email for the mobile-app waitlist signup.

Uses the Resend HTTP API (https://resend.com). Fire-and-forget: any failure
(missing API key, network error, non-2xx response) is logged and swallowed —
never let email delivery block or fail a waitlist signup.
"""

import logging
from typing import Optional

import httpx

from bot.config.settings import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _render_html(position: int) -> str:
    return f"""
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin-bottom: 8px;">You're on the list 🎉</h2>
      <p>
        Thanks for signing up for the Suwappu mobile app (iOS/Android) and
        <strong>Suwappu Card by Rain</strong> waitlist.
      </p>
      <p style="font-size: 18px; margin: 20px 0;">
        Your position: <strong>#{position}</strong>
      </p>
      <p>
        We'll email you as soon as it's your turn. In the meantime, check out
        <a href="https://suwappu.bot">suwappu.bot</a>.
      </p>
      <p style="color: #666; font-size: 12px; margin-top: 24px;">Suwappu</p>
    </div>
    """.strip()


async def send_waitlist_confirmation(
    to_email: str,
    position: int,
    name: Optional[str] = None,
) -> bool:
    """Send a best-effort waitlist confirmation email via Resend.

    Returns True if the email was accepted by Resend, False otherwise
    (including when no API key is configured). Never raises.
    """
    api_key = (settings.resend_api_key or "").strip()
    if not api_key:
        logger.debug("Resend API key not configured; skipping waitlist confirmation email")
        return False

    try:
        payload = {
            "from": settings.waitlist_email_from,
            "to": [to_email],
            "subject": f"You're #{position} on the Suwappu mobile waitlist",
            "html": _render_html(position),
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                RESEND_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code >= 300:
            logger.warning(
                "Resend waitlist email failed (%s): %s", resp.status_code, resp.text[:300]
            )
            return False
        return True
    except Exception:  # noqa: BLE001
        logger.warning("Failed to send waitlist confirmation email", exc_info=True)
        return False
