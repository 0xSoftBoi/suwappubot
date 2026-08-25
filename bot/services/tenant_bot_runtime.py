"""Multi-tenant Telegram runtime — one process, many white-label bots.

A tenant bot is a row in ``tenant_bots`` (owned by api-ts / Drizzle; we read it
with raw SQL rather than mirroring it in SQLAlchemy, so there is exactly one
schema definition in the repo). Telegram posts its updates to
``/telegram/tbot/{bot_id}``, that route calls :func:`handle_update`, and this
module answers using the tenant's own token and branding.

Why not a ``telegram.ext.Application`` per tenant: an Application is a running
task with a queue, a job queue and a handler tree, and hosting a few hundred of
them in one process to serve a handful of commands each is a lot of machinery
for a dispatch table. White-label bots have a small, fixed command set gated by
the tenant's enabled skills, so the update is parsed, routed on the command
word, and answered with a single ``sendMessage``. The main Suwappu bot keeps its
Application; this is a different shape of problem.

The cache is what makes it cheap: a bot's config and decrypted token are loaded
once and held for ``CACHE_TTL_SECONDS``, so a busy community costs one DB read a
minute, not one per message.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import text

from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"
CACHE_TTL_SECONDS = 60
DEXSCREENER_TOKENS = "https://api.dexscreener.com/latest/dex/tokens"

# Addresses that are burn sinks on every EVM chain. Used by /burnstats to work
# out what has actually been destroyed.
BURN_ADDRESSES = (
    "0x000000000000000000000000000000000000dead",
    "0x0000000000000000000000000000000000000000",
)


# ── token decryption (mirrors api-ts TenantBotService) ─────────────────────


def _derive_key(material: str) -> bytes:
    """sha256 of the key material — identical to the TS ``deriveKey``."""
    return hashlib.sha256(material.encode()).digest()


def decrypt_bot_token(ciphertext_b64: str, nonce_b64: str) -> str:
    """Reverse of the TS ``encrypt``: AES-256-GCM with the tag appended.

    Raises if ``TENANT_BOT_ENC_KEY`` is unset — a runtime that cannot decrypt
    should fail loudly on the first update rather than answer nothing forever.
    """
    material = os.environ.get("TENANT_BOT_ENC_KEY")
    if not material:
        raise RuntimeError("TENANT_BOT_ENC_KEY not configured")
    key = _derive_key(material)
    nonce = base64.b64decode(nonce_b64)
    raw = base64.b64decode(ciphertext_b64)
    return AESGCM(key).decrypt(nonce, raw, None).decode()


# ── config ─────────────────────────────────────────────────────────────────


@dataclass
class TenantBotConfig:
    bot_id: str
    name: str
    status: str
    webhook_secret: Optional[str]
    token: Optional[str]
    branding: dict = field(default_factory=dict)
    skills: list = field(default_factory=list)
    token_chain: Optional[str] = None
    token_address: Optional[str] = None
    token_symbol: Optional[str] = None
    loaded_at: float = 0.0

    def has_skill(self, key: str) -> bool:
        for s in self.skills or []:
            if isinstance(s, dict) and s.get("key") == key:
                return bool(s.get("enabled", True))
        return False

    @property
    def mark(self) -> str:
        m = (self.branding or {}).get("mark") or ""
        return f"{m} " if m else ""

    @property
    def display_name(self) -> str:
        return (self.branding or {}).get("displayName") or self.name

    def decorate(self, body: str) -> str:
        """Wrap a reply in the tenant's branding. This is the whole point of
        white-labelling — no Suwappu string appears unless they put it there."""
        footer = (self.branding or {}).get("footer")
        return f"{body}\n\n_{footer}_" if footer else body


_cache: dict[str, TenantBotConfig] = {}
_cache_lock = asyncio.Lock()


def _row_to_config(row: Any) -> TenantBotConfig:
    branding = row.branding if isinstance(row.branding, dict) else json.loads(row.branding or "{}")
    skills = row.skills if isinstance(row.skills, list) else json.loads(row.skills or "[]")
    token = None
    if row.bot_token_ciphertext and row.bot_token_nonce:
        try:
            token = decrypt_bot_token(row.bot_token_ciphertext, row.bot_token_nonce)
        except Exception as e:  # noqa: BLE001
            logger.error("tenant bot %s: token decrypt failed: %s", row.id, e)
    return TenantBotConfig(
        bot_id=str(row.id),
        name=row.name,
        status=row.status,
        webhook_secret=row.webhook_secret,
        token=token,
        branding=branding or {},
        skills=skills or [],
        token_chain=row.token_chain,
        token_address=row.token_address,
        token_symbol=row.token_symbol,
        loaded_at=time.time(),
    )


def _load_config_sync(bot_id: str) -> Optional[TenantBotConfig]:
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT id, name, status, webhook_secret, bot_token_ciphertext,
                       bot_token_nonce, branding, skills, token_chain,
                       token_address, token_symbol
                FROM tenant_bots WHERE id = :bot_id
                """),
            {"bot_id": bot_id},
        ).first()
    return _row_to_config(row) if row else None


async def get_config(bot_id: str, *, force: bool = False) -> Optional[TenantBotConfig]:
    """Cached config for one tenant bot. ``force`` bypasses the TTL — used after
    the dashboard changes a bot so the next message reflects it immediately."""
    cached = _cache.get(bot_id)
    if cached and not force and (time.time() - cached.loaded_at) < CACHE_TTL_SECONDS:
        return cached
    async with _cache_lock:
        cached = _cache.get(bot_id)
        if cached and not force and (time.time() - cached.loaded_at) < CACHE_TTL_SECONDS:
            return cached
        try:
            cfg = await run_in_db(_load_config_sync, bot_id)
        except Exception as e:  # noqa: BLE001
            logger.error("tenant bot %s: config load failed: %s", bot_id, e)
            return cached  # serve stale rather than go dark
        if cfg:
            _cache[bot_id] = cfg
        else:
            _cache.pop(bot_id, None)
        return cfg


def invalidate(bot_id: str) -> None:
    _cache.pop(bot_id, None)


# ── Telegram I/O ───────────────────────────────────────────────────────────


async def _send(cfg: TenantBotConfig, chat_id: int, body: str, **extra) -> None:
    if not cfg.token:
        logger.warning("tenant bot %s: send attempted with no token", cfg.bot_id)
        return
    payload = {
        "chat_id": chat_id,
        "text": cfg.decorate(body),
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
        **extra,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(f"{TELEGRAM_API}/bot{cfg.token}/sendMessage", json=payload)
        if res.status_code >= 400:
            # Markdown is the usual culprit (a stray _ or * in a token name).
            # Retry once as plain text so the member still gets an answer.
            logger.warning("tenant bot %s: send failed %s", cfg.bot_id, res.text[:200])
            payload.pop("parse_mode", None)
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(f"{TELEGRAM_API}/bot{cfg.token}/sendMessage", json=payload)
    except Exception as e:  # noqa: BLE001
        logger.error("tenant bot %s: send error: %s", cfg.bot_id, e)


# ── market data ────────────────────────────────────────────────────────────


async def _fetch_pair(cfg: TenantBotConfig) -> Optional[dict]:
    """Deepest pair for the bot's token, from DexScreener.

    DexScreener is used directly rather than the main bot's price service
    because a tenant's token is arbitrary — it will not be in any tracked-symbol
    map, and address lookup is what actually works for a new meme coin.
    """
    if not cfg.token_address:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{DEXSCREENER_TOKENS}/{cfg.token_address}")
        if res.status_code != 200:
            return None
        pairs = (res.json() or {}).get("pairs") or []
        if not pairs:
            return None
        return max(pairs, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0))
    except Exception as e:  # noqa: BLE001
        logger.warning("tenant bot %s: dexscreener failed: %s", cfg.bot_id, e)
        return None


def _fmt_usd(v: Any) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "—"
    if f >= 1_000_000:
        return f"${f / 1_000_000:.2f}M"
    if f >= 1_000:
        return f"${f / 1_000:.1f}K"
    if f >= 1:
        return f"${f:,.2f}"
    return f"${f:.8f}".rstrip("0")


# ── command handlers ───────────────────────────────────────────────────────


def _links_block(cfg: TenantBotConfig) -> str:
    links = (cfg.branding or {}).get("links") or []
    rows = [
        f"[{l.get('label')}]({l.get('url')})"
        for l in links
        if isinstance(l, dict) and l.get("label") and l.get("url")
    ]
    return "\n" + " · ".join(rows) if rows else ""


def _command_menu(cfg: TenantBotConfig) -> str:
    """Only advertise commands the bot's skills actually serve — a menu entry
    for a disabled skill is a dead button, and members read it as broken."""
    rows = []
    if cfg.has_skill("price"):
        rows.append("/price — current price and 24h move")
    if cfg.has_skill("chart"):
        rows.append("/chart — price chart")
    if cfg.has_skill("buy") or cfg.has_skill("swap"):
        rows.append("/buy — buy the token")
    if cfg.has_skill("holders"):
        rows.append("/holders — supply and holders")
    if cfg.has_skill("burn_stats"):
        rows.append("/burnstats — what has been burned")
    if cfg.has_skill("leaderboard"):
        rows.append("/leaderboard — top buyers")
    if cfg.has_skill("alerts"):
        rows.append("/alert — set a price alert")
    if cfg.has_skill("portfolio"):
        rows.append("/portfolio — your holdings")
    return "\n".join(rows) if rows else "_No commands are enabled yet._"


async def _cmd_start(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    tagline = (cfg.branding or {}).get("tagline") or ""
    body = f"{cfg.mark}*{cfg.display_name}*"
    if tagline:
        body += f"\n_{tagline}_"
    body += f"\n\n{_command_menu(cfg)}{_links_block(cfg)}"
    await _send(cfg, chat_id, body)


async def _cmd_price(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    if not cfg.token_address:
        await _send(cfg, chat_id, "No token is configured for this bot yet.")
        return
    pair = await _fetch_pair(cfg)
    if not pair:
        await _send(cfg, chat_id, "Couldn't reach market data just now — try again shortly.")
        return
    sym = cfg.token_symbol or (pair.get("baseToken") or {}).get("symbol") or "token"
    change = (pair.get("priceChange") or {}).get("h24")
    arrow = "🟢" if (change or 0) >= 0 else "🔴"
    body = (
        f"{cfg.mark}*{sym}*\n\n"
        f"Price: *{_fmt_usd(pair.get('priceUsd'))}*\n"
        f"24h: {arrow} {change if change is not None else '—'}%\n"
        f"Liquidity: {_fmt_usd((pair.get('liquidity') or {}).get('usd'))}\n"
        f"24h volume: {_fmt_usd((pair.get('volume') or {}).get('h24'))}\n"
        f"FDV: {_fmt_usd(pair.get('fdv'))}"
    )
    await _send(cfg, chat_id, body)


async def _cmd_chart(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    pair = await _fetch_pair(cfg)
    if not pair or not pair.get("url"):
        await _send(cfg, chat_id, "No chart available for this token yet.")
        return
    await _send(
        cfg, chat_id, f"{cfg.mark}[Open the {cfg.token_symbol or 'token'} chart]({pair['url']})"
    )


async def _cmd_buy(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    if not cfg.token_address:
        await _send(cfg, chat_id, "No token is configured for this bot yet.")
        return
    main_bot = os.environ.get("SUWAPPU_BOT_USERNAME", "suwappubot")
    chain = cfg.token_chain or "base"
    deep_link = f"https://t.me/{main_bot}?start=swap_{chain}_{cfg.token_address}"
    await _send(
        cfg,
        chat_id,
        f"{cfg.mark}Buy *{cfg.token_symbol or 'the token'}*",
        reply_markup={
            "inline_keyboard": [[{"text": "Buy now", "url": deep_link}]],
        },
    )


async def _cmd_burnstats(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    """What this bot's own automations have burned, from tenant_bot_runs.

    Only successful live runs count. A simulated run is a rehearsal, and
    reporting it as burned supply to a community would be a lie.
    """

    def _query() -> dict:
        with get_session() as session:
            row = session.execute(
                text("""
                    SELECT count(*) AS runs,
                           coalesce(sum(r.spend_usd), 0) AS spent
                    FROM tenant_bot_runs r
                    JOIN tenant_bot_automations a ON a.id = r.automation_id
                    WHERE r.bot_id = :bot_id
                      AND r.status = 'succeeded'
                      AND a.kind = 'buy_and_burn'
                    """),
                {"bot_id": cfg.bot_id},
            ).first()
            return (
                {"runs": row.runs or 0, "spent": row.spent or 0} if row else {"runs": 0, "spent": 0}
            )

    try:
        stats = await run_in_db(_query)
    except Exception as e:  # noqa: BLE001
        logger.warning("tenant bot %s: burnstats query failed: %s", cfg.bot_id, e)
        await _send(cfg, chat_id, "Burn stats are unavailable right now.")
        return

    if not stats["runs"]:
        await _send(
            cfg,
            chat_id,
            f"{cfg.mark}*Burn stats*\n\nNo burns have executed yet.",
        )
        return
    await _send(
        cfg,
        chat_id,
        f"{cfg.mark}*Burn stats*\n\n"
        f"Burns executed: *{stats['runs']}*\n"
        f"Total spent on buybacks: *{_fmt_usd(stats['spent'])}*",
    )


async def _cmd_holders(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    pair = await _fetch_pair(cfg)
    if not pair:
        await _send(cfg, chat_id, "Couldn't reach token data just now.")
        return
    sym = cfg.token_symbol or (pair.get("baseToken") or {}).get("symbol") or "token"
    txns = (pair.get("txns") or {}).get("h24") or {}
    await _send(
        cfg,
        chat_id,
        f"{cfg.mark}*{sym} — 24h activity*\n\n"
        f"Buys: {txns.get('buys', '—')}\n"
        f"Sells: {txns.get('sells', '—')}\n"
        f"Liquidity: {_fmt_usd((pair.get('liquidity') or {}).get('usd'))}\n"
        f"Market cap: {_fmt_usd(pair.get('marketCap') or pair.get('fdv'))}",
    )


async def _cmd_unsupported(cfg: TenantBotConfig, chat_id: int, _args: str) -> None:
    await _send(cfg, chat_id, f"{_command_menu(cfg)}")


# command word -> (skill it needs, handler). A command whose skill is off is
# treated as unknown, so disabling a skill in the dashboard genuinely turns the
# command off rather than leaving it half-working.
_ROUTES = {
    "start": (None, _cmd_start),
    "help": (None, _cmd_start),
    "price": ("price", _cmd_price),
    "p": ("price", _cmd_price),
    "chart": ("chart", _cmd_chart),
    "buy": ("buy", _cmd_buy),
    "holders": ("holders", _cmd_holders),
    "burnstats": ("burn_stats", _cmd_burnstats),
    "burn": ("burn_stats", _cmd_burnstats),
}


def _parse_command(text_body: str) -> tuple[Optional[str], str]:
    """``/price@somebot BTC`` -> ``('price', 'BTC')``."""
    if not text_body.startswith("/"):
        return None, ""
    head, _, rest = text_body.partition(" ")
    cmd = head[1:].split("@", 1)[0].strip().lower()
    return (cmd or None), rest.strip()


# ── entry point ────────────────────────────────────────────────────────────


def _bump_counter_sync(bot_id: str) -> None:
    with get_session() as session:
        session.execute(
            text(
                "UPDATE tenant_bots SET messages_handled = messages_handled + 1, "
                "last_update_at = now() WHERE id = :bot_id"
            ),
            {"bot_id": bot_id},
        )


async def handle_update(bot_id: str, secret_token: Optional[str], payload: dict) -> dict:
    """Route one Telegram update for one tenant bot.

    Returns a small dict for the webhook route to echo. Never raises: Telegram
    retries on a non-2xx and a retry storm on a bad update helps nobody.
    """
    cfg = await get_config(bot_id)
    if not cfg:
        return {"status": "unknown_bot"}

    # Constant-time-ish comparison of the per-bot secret. Telegram sends it on
    # every update; without this anyone who learns a bot_id could drive the bot.
    if not cfg.webhook_secret or secret_token != cfg.webhook_secret:
        logger.warning("tenant bot %s: update with bad secret token", bot_id)
        return {"status": "forbidden"}

    if cfg.status != "live":
        return {"status": "not_live"}

    message = payload.get("message") or payload.get("edited_message")
    if not message:
        return {"status": "ignored"}
    chat_id = (message.get("chat") or {}).get("id")
    body = (message.get("text") or "").strip()
    if not chat_id or not body:
        return {"status": "ignored"}

    cmd, args = _parse_command(body)
    if not cmd:
        return {"status": "ignored"}

    route = _ROUTES.get(cmd)
    if not route:
        return {"status": "unknown_command"}
    skill, handler = route
    if skill and not cfg.has_skill(skill):
        return {"status": "skill_disabled"}

    try:
        await handler(cfg, chat_id, args)
    except Exception as e:  # noqa: BLE001
        logger.error("tenant bot %s: handler %s failed: %s", bot_id, cmd, e, exc_info=True)
        return {"status": "handler_error"}

    try:
        await run_in_db(_bump_counter_sync, bot_id)
    except Exception:  # noqa: BLE001
        pass  # a stats counter is never worth failing a reply over

    return {"status": "ok", "command": cmd}
