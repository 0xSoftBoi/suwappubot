"""Portfolio and balance overview handlers."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler

from bot.models.user import User, Wallet
from bot.models.predict import PredictionPosition
from bot.models.swap import SwapTransaction, SwapStatus
from bot.models.fees import FeeTransaction
from bot.models.subscription import SubscriptionTier
from bot.services.wallet import WalletService
from bot.services.price_service import PriceService
from bot.services.x402_service import x402_service, TIER_LIMITS
from bot.utils.formatters import format_amount, format_usd, format_chain_name
from database.db import get_session
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)

wallet_service = WalletService()
price_service = PriceService()

# PRO tier's swap fee, single-sourced from fee_service so a pricing change
# can't silently desync the upsell math from what PRO users actually pay.
from bot.services.fee_service import TIER_FEE_RATES  # noqa: E402

PRO_FEE_RATE = TIER_FEE_RATES[SubscriptionTier.PRO]


def _compute_pro_delta_usd(fee_rows: list[tuple[float, float]]) -> float:
    """What PRO's 50bps fee would have kept vs what was actually paid, summed
    over `fee_rows` (fee_amount_usd, fee_percentage) pairs from FeeTransaction.

    Per row: volume = fee_amount_usd / (fee_percentage / 100); pro_fee =
    volume * PRO_FEE_RATE; delta = fee_amount_usd - pro_fee. Rows with a
    non-positive fee_percentage are skipped (can't back out volume from a
    zero/negative rate). Returns the SUM of deltas, which can be negative
    (e.g. a row already at or below PRO's rate) — callers gate display on
    the total being positive, not this helper.

    Pure + synchronous — no DB, no `self` — unit-testable in isolation.
    """
    pro_delta = 0.0
    for fee_amount_usd, fee_percentage in fee_rows:
        fee_amount_usd = float(fee_amount_usd or 0)
        fee_percentage = float(fee_percentage or 0)
        if fee_percentage <= 0:
            continue
        volume = fee_amount_usd / (fee_percentage / 100)
        pro_fee = volume * PRO_FEE_RATE
        pro_delta += fee_amount_usd - pro_fee
    return pro_delta


async def _build_savings_block(user_id: int) -> str:
    """Last-30-days execution-savings receipt + FREE->PRO upsell delta.

    Returns "" (never raises — this is a display add-on, not the money path)
    when there's no savings data for the window at all, so the block is
    skipped entirely rather than rendered empty.
    """
    try:
        since = datetime.now(timezone.utc) - timedelta(days=30)

        with get_session() as session:
            # Only swaps that actually made it on-chain count — a reverted
            # or failed swap delivered no savings, and claiming otherwise
            # would be a false receipt.
            total_savings = (
                session.query(func.sum(SwapTransaction.price_improvement_usd))
                .filter(
                    SwapTransaction.user_id == user_id,
                    SwapTransaction.created_at >= since,
                    SwapTransaction.price_improvement_usd.isnot(None),
                    SwapTransaction.status.in_(
                        [
                            SwapStatus.SUBMITTED.value,
                            SwapStatus.CONFIRMING.value,
                            SwapStatus.COMPLETED.value,
                        ]
                    ),
                )
                .scalar()
            ) or 0.0

            fee_rows = (
                session.query(FeeTransaction.fee_amount_usd, FeeTransaction.fee_percentage)
                .filter(
                    FeeTransaction.user_id == user_id,
                    FeeTransaction.created_at >= since,
                    FeeTransaction.fee_amount_usd.isnot(None),
                    FeeTransaction.fee_percentage > 0,
                )
                .all()
            )

        if total_savings < 0.01 and not fee_rows:
            return ""

        lines = ["\n\U0001f4b0 *Execution Savings (30d)*"]
        if total_savings >= 0.01:
            lines.append(f"  Best-route savings: ~{format_usd(total_savings)}")

        # FREE-tier upsell: what PRO's fee rate would have kept vs what was
        # actually paid at the user's current (higher) rate. Only rendered
        # when the delta actually beats PRO's subscription price — telling a
        # user to pay $9.99/mo to save $0.50 erodes trust in every other
        # number we show.
        tier = await x402_service.get_tier(user_id)
        if tier == SubscriptionTier.FREE and fee_rows:
            pro_delta = _compute_pro_delta_usd(fee_rows)
            pro_price = float((TIER_LIMITS.get(SubscriptionTier.PRO) or {}).get("price_usd", 9.99))
            if pro_delta > pro_price:
                lines.append(
                    f"  PRO would have kept you ~{format_usd(pro_delta)} "
                    f"this month → /subscribe"
                )

        if len(lines) <= 1:
            return ""
        return "\n".join(lines)
    except Exception as e:
        logger.debug(f"Could not build savings block for user {user_id}: {e}")
        return ""


async def _build_portfolio_text(wallet_infos, user_id=None):
    """Fetch balances and build portfolio display text and total USD value."""
    all_balances = {}
    total_usd = 0.0

    for wallet_id, address, chain_type, name in wallet_infos:
        balances = await wallet_service.get_balances_by_address(address, chain_type)

        for chain, tokens in balances.items():
            if chain not in all_balances:
                all_balances[chain] = {}
            for token, amount in tokens.items():
                if token in all_balances[chain]:
                    all_balances[chain][token] += amount
                else:
                    all_balances[chain][token] = amount

    # Get USD values
    all_tokens = set()
    for tokens in all_balances.values():
        all_tokens.update(tokens.keys())

    prices = await price_service.get_prices(list(all_tokens))

    lines = ["\U0001f4bc *Your Portfolio*\n"]

    for chain_name in sorted(all_balances.keys()):
        tokens = all_balances[chain_name]
        if not tokens:
            continue

        chain_display = format_chain_name(chain_name)
        lines.append(f"\n*{chain_display}*")

        for token, amount in sorted(tokens.items()):
            if amount <= 0:
                continue

            price = prices.get(token, 0) or 0
            usd_value = amount * price
            total_usd += usd_value

            if usd_value > 0.01:
                lines.append(
                    f"  {format_amount(amount, symbol=token)} " f"({format_usd(usd_value)})"
                )
            else:
                lines.append(f"  {format_amount(amount, symbol=token)}")

    # Prediction market positions
    if user_id:
        try:
            with get_session() as session:
                positions = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.user_id == user_id,
                        PredictionPosition.total_shares > 0,
                        PredictionPosition.is_resolved == False,  # noqa: E712
                    )
                    .all()
                )

                if positions:
                    lines.append("\n*Predictions*")
                    for pos in positions:
                        shares = float(pos.total_shares or 0)
                        cost = float(pos.total_cost_usdc or 0)
                        current = float(pos.current_price or 0)
                        value = shares * current
                        pnl_pct = ((value - cost) / cost * 100) if cost > 0 else 0

                        outcome_emoji = "\U0001f7e2" if pos.outcome == "Yes" else "\U0001f534"
                        question = pos.market_question or "Unknown"
                        if len(question) > 40:
                            question = question[:37] + "..."

                        lines.append(
                            f"  {outcome_emoji} {question}\n"
                            f"    {format_usd(value)} ({pnl_pct:+.1f}%)"
                        )
                        total_usd += value

                # Resolved winners are settled but not auto-redeemed for EOAs, so
                # they still hold real value (1:1 pUSD). Keep them in the total as
                # claimable rather than letting them disappear post-resolution.
                claimable = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.user_id == user_id,
                        PredictionPosition.is_resolved == True,  # noqa: E712
                        PredictionPosition.resolved_payout > 0,
                    )
                    .all()
                )
                if claimable:
                    claimable_total = sum(float(p.resolved_payout or 0) for p in claimable)
                    lines.append("\n*Predictions — Claimable*")
                    lines.append(
                        f"  \U0001f3c6 {len(claimable)} resolved "
                        f"({format_usd(claimable_total)} to redeem)"
                    )
                    total_usd += claimable_total
        except Exception as e:
            logger.debug(f"Could not load prediction positions: {e}")

    # HyperLiquid holdings (perps account value + HYPE staking + vault equity)
    if user_id:
        try:
            from bot.services.perps_service import perps_service

            hl = await perps_service.get_holdings_usd(user_id)
            if hl["total_usd"] > 0.01:
                lines.append("\n*HyperLiquid*")
                if hl["perps_usd"] > 0.01:
                    lines.append(f"  Perps account ({format_usd(hl['perps_usd'])})")
                if hl.get("spot_usd", 0) > 0.01:
                    lines.append(f"  Spot ({format_usd(hl['spot_usd'])})")
                if hl["staking_usd"] > 0.01:
                    lines.append(f"  HYPE staking ({format_usd(hl['staking_usd'])})")
                if hl["vault_usd"] > 0.01:
                    lines.append(f"  Vaults ({format_usd(hl['vault_usd'])})")
                total_usd += hl["total_usd"]
        except Exception as e:
            logger.debug(f"Could not load HyperLiquid holdings: {e}")

    # Execution-savings receipt: surfaces the quote-race edge that was
    # previously computed and discarded — makes execution quality visible
    # value, and upsells FREE users on the fee delta they'd save on PRO.
    if user_id:
        savings_block = await _build_savings_block(user_id)
        if savings_block:
            lines.append(savings_block)

    lines.append(f"\n\U0001f4b0 *Total Value:* {format_usd(total_usd)}")

    return "\n".join(lines)


def _portfolio_keyboard():
    """Return standard portfolio keyboard."""
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("\U0001f504 Refresh", callback_data="portfolio_refresh"),
                InlineKeyboardButton("\U0001f504 Swap", callback_data="swap_start"),
            ],
            [InlineKeyboardButton("\u00ab Back", callback_data="main_menu")],
        ]
    )


def _error_keyboard():
    """Return error/retry keyboard."""
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("\U0001f504 Retry", callback_data="portfolio_refresh")],
            [InlineKeyboardButton("\u00ab Back", callback_data="main_menu")],
        ]
    )


@enforce_tos
async def portfolio_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /portfolio command - show full portfolio with USD values."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await update.message.reply_text(
                "\u274c Please use /start first to set up your account."
            )
            return

        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )

        if not wallets:
            keyboard = [
                [InlineKeyboardButton("\U0001f45b Add Wallet", callback_data="wallet_menu")]
            ]
            await update.message.reply_text(
                "\U0001f45b Add a wallet first to view your portfolio!",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]
        db_user_id = db_user.id

    loading_msg = await update.message.reply_text("\U0001f4ca Loading portfolio...")

    try:
        text = await _build_portfolio_text(wallet_infos, user_id=db_user_id)
        await loading_msg.edit_text(
            text,
            parse_mode="Markdown",
            reply_markup=_portfolio_keyboard(),
        )
    except Exception as e:
        import logging

        logging.getLogger(__name__).exception("Portfolio load failed")
        await loading_msg.edit_text(
            f"\u274c Error loading portfolio: {str(e)}",
            reply_markup=_error_keyboard(),
        )


@enforce_tos
async def portfolio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle portfolio button callback."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("\u274c Please use /start first.")
            return

        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_active == True,  # noqa: E712
            )
            .all()
        )

        if not wallets:
            keyboard = [
                [InlineKeyboardButton("\U0001f45b Add Wallet", callback_data="wallet_menu")]
            ]
            await query.edit_message_text(
                "\U0001f45b Add a wallet first!",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        wallet_infos = [(w.id, w.address, w.chain_type, w.name) for w in wallets]
        db_user_id = db_user.id

    await query.edit_message_text("\U0001f4ca Loading portfolio...")

    try:
        text = await _build_portfolio_text(wallet_infos, user_id=db_user_id)
        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=_portfolio_keyboard(),
        )
    except Exception as e:
        logger.error(f"Error in portfolio_callback: {e}", exc_info=True)
        await query.edit_message_text(
            "\u274c An unexpected error occurred. Please try again.",
            reply_markup=_error_keyboard(),
        )


# Create handlers
portfolio_handler = CommandHandler("p", portfolio_command)
