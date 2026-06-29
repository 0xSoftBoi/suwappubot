"""Support-ticket fan-out service.

A single background loop that routes every newly-created support ticket to the
team, regardless of which surface filed it (Telegram bot, webapp/api-ts, and
later WhatsApp). Tickets are picked up by polling for ``notified_at IS NULL``,
so no surface needs to duplicate notification or Linear-sync logic.

For each fresh ticket it, best-effort:
  1. DMs every configured admin (``admin_telegram_ids``).
  2. Posts into the support group, if ``support_group_chat_id`` is set.
  3. Creates a Linear issue, if ``linear_api_key`` + ``linear_team_id`` are set,
     storing the issue id/url back on the ticket.
Then it stamps ``notified_at`` so the ticket is not processed again.

The same module exposes ``post_admin_update`` / ``add_linear_comment`` helpers
the bot reply/close handlers call so replies and resolutions are reflected in
Linear too.
"""

import asyncio
import logging
from datetime import datetime

import aiohttp

from bot.config.settings import settings
from bot.models.support import SupportTicket, TicketKind
from database.db import get_session

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 15  # tickets should reach the team quickly
LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"
HTTP_TIMEOUT = aiohttp.ClientTimeout(total=10)

_KIND_EMOJI = {
    TicketKind.SUPPORT: "🆘",
    TicketKind.BUG: "🐞",
    TicketKind.ENTERPRISE_LEAD: "💼",
}
_KIND_NOUN = {
    TicketKind.SUPPORT: "support ticket",
    TicketKind.BUG: "bug report",
    TicketKind.ENTERPRISE_LEAD: "enterprise lead",
}


def _admin_ids() -> list[int]:
    raw = settings.admin_telegram_ids or ""
    return [int(x) for x in raw.split(",") if x.strip()]


def _emoji(kind: str) -> str:
    return _KIND_EMOJI.get(kind, "🎫")


def _noun(kind: str) -> str:
    return _KIND_NOUN.get(kind, "ticket")


# --------------------------------------------------------------------------- #
# Linear GraphQL (best-effort; all failures are swallowed + logged)
# --------------------------------------------------------------------------- #


async def _linear_request(query: str, variables: dict) -> dict | None:
    """Call the Linear GraphQL API. Returns the `data` dict, or None on failure."""
    if not settings.linear_api_key:
        return None
    headers = {
        "Authorization": settings.linear_api_key,
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession(timeout=HTTP_TIMEOUT) as session:
            async with session.post(
                LINEAR_GRAPHQL_URL,
                json={"query": query, "variables": variables},
                headers=headers,
            ) as resp:
                body = await resp.json()
                if resp.status != 200 or body.get("errors"):
                    logger.warning("Linear API error (%s): %s", resp.status, body.get("errors"))
                    return None
                return body.get("data")
    except Exception as e:  # noqa: BLE001
        logger.warning("Linear request failed: %s", e)
        return None


async def _create_linear_issue(ticket_id: int, kind: str, message: str, handle: str) -> dict | None:
    """Create a Linear issue for a ticket. Returns {'id','identifier','url'} or None."""
    if not (settings.linear_api_key and settings.linear_team_id):
        return None
    title = f"[{kind}] #{ticket_id} from {handle}"
    description = f"**Suwappu {_noun(kind)} #{ticket_id}**\nFrom: {handle}\n\n{message}"
    query = """
    mutation CreateIssue($teamId: String!, $title: String!, $description: String!) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
        success
        issue { id identifier url }
      }
    }
    """
    data = await _linear_request(
        query,
        {"teamId": settings.linear_team_id, "title": title, "description": description},
    )
    if not data:
        return None
    issue = (data.get("issueCreate") or {}).get("issue")
    return issue or None


async def add_linear_comment(issue_id: str | None, body: str) -> None:
    """Append a comment to a Linear issue, best-effort. No-op if unconfigured."""
    if not issue_id or not settings.linear_api_key:
        return
    query = """
    mutation Comment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }
    """
    await _linear_request(query, {"issueId": issue_id, "body": body})


# --------------------------------------------------------------------------- #
# Telegram fan-out helpers (usable from handlers too)
# --------------------------------------------------------------------------- #


async def post_admin_update(bot, text: str) -> None:
    """Send an operational update to the support group (if set) and all admins."""
    if bot is None:
        return
    targets: list = []
    if settings.support_group_chat_id:
        targets.append(settings.support_group_chat_id)
    targets.extend(_admin_ids())
    for chat_id in targets:
        try:
            await bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown")
        except Exception as e:  # noqa: BLE001 — one bad target must not block the rest
            logger.error("Failed to post support update to %s: %s", chat_id, e)


class SupportNotifier:
    """Background task that fans out un-notified support tickets to the team."""

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None

    async def start(self, bot=None) -> None:
        if self._running:
            logger.warning("Support notifier already running")
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Support notifier started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Support notifier stopped")

    async def _loop(self) -> None:
        await asyncio.sleep(10)  # let the app finish booting
        while self._running:
            try:
                await self._process_pending()
            except Exception as e:  # noqa: BLE001
                logger.error("Support notifier loop error: %s", e, exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _process_pending(self) -> None:
        # Snapshot pending tickets, then release the session before doing I/O.
        with get_session() as session:
            pending = (
                session.query(SupportTicket)
                .filter(SupportTicket.notified_at.is_(None))
                .order_by(SupportTicket.created_at.asc())
                .limit(20)
                .all()
            )
            rows = [
                {
                    "id": t.id,
                    "kind": t.kind,
                    "message": t.message or "",
                    "username": t.username,
                    "telegram_id": t.telegram_id,
                    "source": t.source,
                }
                for t in pending
            ]

        for row in rows:
            await self._fan_out(row)

    async def _fan_out(self, row: dict) -> None:
        ticket_id = row["id"]
        kind = row["kind"]
        if row["username"]:
            handle = f"@{row['username']}"
        elif row["telegram_id"]:
            handle = f"id:{row['telegram_id']}"
        else:
            # Web-form leads have no Telegram identity; the body carries contact details.
            handle = "web form"
        message = row["message"]
        preview = message if len(message) <= 600 else message[:600] + "…"

        # The /treply path DMs the user via Telegram, so only offer it when we
        # actually have a Telegram id to reply to (web leads are followed up by
        # email/Telegram handle captured in the message body).
        if row["telegram_id"]:
            footer = f"Reply: `/treply {ticket_id} <message>`  •  Close: `/tclose {ticket_id}`"
        else:
            footer = f"Follow up via the contact details above  •  Close: `/tclose {ticket_id}`"

        # 1 + 2) Telegram admins + support group.
        text = (
            f"{_emoji(kind)} *New {_noun(kind)} #{ticket_id}* _(via {row['source']})_\n"
            f"From: {handle}\n\n"
            f"{preview}\n\n"
            f"{footer}"
        )
        await post_admin_update(self._bot, text)

        # 3) Linear issue (optional).
        issue = await _create_linear_issue(ticket_id, kind, message, handle)

        # Stamp notified_at so we never re-process; persist Linear linkage.
        with get_session() as session:
            t = session.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
            if not t:
                return
            t.notified_at = datetime.utcnow()
            if issue:
                t.linear_issue_id = issue.get("id")
                t.linear_issue_url = issue.get("url")
            session.commit()

        if issue:
            logger.info("Ticket #%s synced to Linear %s", ticket_id, issue.get("identifier"))


# Module-level singleton (mirrors digest_service / alert_service).
support_notifier = SupportNotifier()
