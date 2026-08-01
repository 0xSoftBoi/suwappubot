"""Watched-deployer hook for the launch detector — non-fatal, best-effort.

launch_detector (bot/services/sniping/launch_detector.py) currently only
covers Solana (pump.fun + Raydium launches). When it detects a new token
launch, this checks the launch's creator address against DeployerWatch rows
and, on a match, records a DeployerWatchHit and DMs the watching user.

Registered as a launch_detector.on_launch() callback in bot/main.py's
post_init, right before launch_detector.start(). Wrapped in try/except at
every layer so a bug here can never take down launch detection or the bot.
"""

import logging

logger = logging.getLogger(__name__)

# launch_detector only monitors Solana platforms today; if it grows EVM
# coverage, the chain should be threaded through from the launch event
# instead of hardcoded here.
DEFAULT_CHAIN = "solana"


def _short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}" if addr and len(addr) > 12 else (addr or "unknown")


async def check_watched_deployer_launch(launch, bot=None) -> None:
    """Check a detected TokenLaunch against watched deployers; notify + record hits."""
    deployer = getattr(launch, "creator", None)
    token_mint = getattr(launch, "token_mint", None)
    if not deployer or not token_mint:
        return

    try:
        from bot.models.intel import DeployerWatch, DeployerWatchHit
        from bot.models.user import User
        from database.db import get_session

        notify_targets = []
        with get_session() as session:
            watches = (
                session.query(DeployerWatch)
                .filter(
                    DeployerWatch.deployer_address == deployer,
                    DeployerWatch.chain == DEFAULT_CHAIN,
                )
                .all()
            )
            if not watches:
                return

            for watch in watches:
                session.add(
                    DeployerWatchHit(
                        watch_id=watch.id, token_address=token_mint, chain=DEFAULT_CHAIN
                    )
                )
                user = session.query(User).filter(User.id == watch.user_id).first()
                if user and user.telegram_id:
                    notify_targets.append((user.telegram_id, watch.label))
            session.commit()

        if not bot or not notify_targets:
            return

        symbol = getattr(launch, "symbol", None) or "a new token"

        for telegram_id, label in notify_targets:
            label_str = f" ({label})" if label else ""
            text = (
                f"🧑‍💻 Watched deployer `{_short(deployer)}`{label_str} just deployed "
                f"*{symbol}* on {DEFAULT_CHAIN} — `/intel {token_mint} {DEFAULT_CHAIN}`"
            )
            try:
                await bot.send_message(chat_id=telegram_id, text=text, parse_mode="Markdown")
            except Exception as e:
                logger.warning("dev_watch notify failed for telegram_id=%s: %s", telegram_id, e)
    except Exception as e:
        logger.error("dev_watch check_watched_deployer_launch failed: %s", e)
