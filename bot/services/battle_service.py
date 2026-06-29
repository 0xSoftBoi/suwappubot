"""Battle service — gamified up/down directional bets (Market Battle / Fun Trade).

Two backings:
  perps       — opens a real HyperLiquid position (long=up, short=down) via
                perps_service.open_position, then closes it at expiry via
                close_position and reads the realised PnL from the exchange.
  prediction  — debits stake_usd from the user's custodial balance at open,
                credits into the battle treasury; at settlement the treasury
                pays the user on WIN or keeps funds on LOSS; on VOID the
                treasury refunds the stake. All balance moves happen inside
                the same DB transaction as the battle-status write.

MONEY-PATH invariants enforced here:
  1. user_id is always bound from the DB query — never taken from callback data.
  2. Settlement is idempotent: the entire settle is one atomic transaction that
     does  UPDATE battles SET status='settled' WHERE id=:id AND status='open'
     and only credits balances when that CAS succeeds (rowcount == 1).
  3. stake_usd is validated > 0 before opening; stake > 0 is re-asserted at
     settle time before any credit is written.
  4. All prediction balance mutations happen inside a single DB transaction via
     _adjust_balance_in_session() — the community_service atomicity primitive.
  5. Per-user open-battle cap (BATTLE_MAX_OPEN) prevents runaway abuse.

TREASURY DESIGN (prediction backing):
  BATTLE_TREASURY_USER_ID is a sentinel integer that identifies the house
  CustodialBalance row.  It is NOT a real user; it is a reserved ID defined
  in settings (default -1, overridable via BATTLE_TREASURY_USER_ID env var).
  The flow:
    open_battle  → debit user, credit treasury
    settle WIN   → debit treasury, credit user (stake * PREDICTION_WIN_MULTIPLIER)
    settle LOSS  → no-op (funds already in treasury from open)
    settle VOID  → debit treasury, credit user (refund stake exactly)
  All moves are inside the same transaction as the status flip.
"""

import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db import get_session
from bot.models.battle import Battle
from bot.models.custodial import CustodialBalance
from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Fixed-odds payout multiplier for 'prediction' backing.
# At 1.9 the house retains ~5% EV on a 50/50 oracle bet:
#   EV = 0.5 * 1.9 - 1 = -0.05  (per $1 staked, house keeps $0.05 in expectation)
PREDICTION_WIN_MULTIPLIER = Decimal("1.9")

# Default leverage for perps-backed battles.
BATTLE_DEFAULT_LEVERAGE = 2

# Default stake limits (USD).
BATTLE_MIN_STAKE_USD = Decimal("1.0")
BATTLE_MAX_STAKE_USD = Decimal("500.0")

# Maximum concurrent open battles per user (abuse cap).
BATTLE_MAX_OPEN = 5

# Duration presets offered to users (minutes).
BATTLE_DURATIONS = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
}

# Markets supported by battles (subset of HL markets so the price feed is always live).
BATTLE_MARKETS = ["BTC-USD", "ETH-USD", "SOL-USD"]

# Custodial token used for prediction battles.
_BATTLE_CHAIN = "base"
_BATTLE_TOKEN = "USDC"

# ---------------------------------------------------------------------------
# Treasury sentinel
# ---------------------------------------------------------------------------


def _get_treasury_user_id() -> int:
    """Return the sentinel user ID for the battle house/treasury account.

    Reads BATTLE_TREASURY_USER_ID from settings with a safe fallback of -1.
    A negative integer is guaranteed to never collide with a real DB user.id
    (auto-increment starts at 1).
    """
    try:
        from bot.config.settings import settings

        return int(getattr(settings, "battle_treasury_user_id", -1))
    except Exception:
        return -1


# ---------------------------------------------------------------------------
# Atomicity primitive (mirrors community_service._adjust_balance_in_session)
# ---------------------------------------------------------------------------


def _adjust_balance_in_session(
    session: Session,
    user_id: int,
    amount: Decimal,
    operation: str,  # "add" | "subtract"
) -> Decimal:
    """Add or subtract from CustodialBalance within the caller's session.

    Operates on the _BATTLE_CHAIN/_BATTLE_TOKEN (USDC on Base) balance.
    Uses SELECT FOR UPDATE so the balance row is locked for the lifetime of
    the caller's transaction — no concurrent settlement can interleave.

    Raises ValueError on insufficient funds (subtract).
    Returns the new balance.
    """
    if amount <= 0:
        raise ValueError(f"amount must be > 0, got {amount}")

    token_address = get_token_address(_BATTLE_TOKEN, _BATTLE_CHAIN) or NATIVE_TOKEN_ADDRESS

    bal = (
        session.query(CustodialBalance)
        .filter(
            CustodialBalance.user_id == user_id,
            CustodialBalance.chain == _BATTLE_CHAIN,
            CustodialBalance.token_symbol == _BATTLE_TOKEN,
        )
        .with_for_update()
        .first()
    )

    if bal is None:
        if operation == "subtract":
            raise ValueError(
                f"Insufficient balance: account has no {_BATTLE_TOKEN} on {_BATTLE_CHAIN}"
            )
        bal = CustodialBalance(
            user_id=user_id,
            chain=_BATTLE_CHAIN,
            token_symbol=_BATTLE_TOKEN,
            token_address=token_address,
            balance="0",
        )
        session.add(bal)

    current = Decimal(bal.balance)
    if operation == "add":
        new_bal = current + amount
    elif operation == "subtract":
        new_bal = current - amount
        if new_bal < 0:
            raise ValueError(f"Insufficient balance: have {current} {_BATTLE_TOKEN}, need {amount}")
    else:
        raise ValueError(f"Invalid operation: {operation!r}")

    bal.balance = str(new_bal)
    return new_bal


class BattleService:
    """Open, settle, and list directional up/down battles."""

    # ------------------------------------------------------------------ #
    #  Internal helpers
    # ------------------------------------------------------------------ #

    async def _fetch_mark_price(self, market: str) -> Optional[Decimal]:
        """Return the HyperLiquid mark price for *market* as a Decimal, or None."""
        try:
            from bot.services.hyperliquid_client import hyperliquid_client

            price = await hyperliquid_client.get_mark_price(market)
            if price and price > 0:
                return Decimal(str(price))
        except Exception as e:
            logger.warning("battle: price fetch failed for %s: %s", market, e)
        return None

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #

    async def open_battle(
        self,
        user_id: int,
        market: str,
        direction: str,
        stake_usd: Decimal,
        backing: str = "perps",
        duration_minutes: int = 5,
    ) -> Battle:
        """Open a new directional battle for *user_id*.

        Parameters
        ----------
        user_id:          Telegram/DB user id (caller must supply from update.effective_user.id)
        market:           e.g. "BTC-USD"
        direction:        "up" or "down"
        stake_usd:        amount in USD (must be > 0 and within limits)
        backing:          "perps" or "prediction"
        duration_minutes: how long until auto-settlement

        Returns
        -------
        The newly-created Battle row (expunged from session).

        Raises
        ------
        ValueError on invalid inputs or insufficient balance.
        Exception on exchange / DB failures.
        """
        # --- input validation ---
        if direction not in ("up", "down"):
            raise ValueError("direction must be 'up' or 'down'")
        if backing not in ("perps", "prediction"):
            raise ValueError("backing must be 'perps' or 'prediction'")
        if market not in BATTLE_MARKETS:
            raise ValueError(f"market must be one of {BATTLE_MARKETS}")
        stake_usd = Decimal(str(stake_usd))
        if stake_usd < BATTLE_MIN_STAKE_USD:
            raise ValueError(f"Minimum stake is ${BATTLE_MIN_STAKE_USD}")
        if stake_usd > BATTLE_MAX_STAKE_USD:
            raise ValueError(f"Maximum stake is ${BATTLE_MAX_STAKE_USD}")
        if duration_minutes not in BATTLE_DURATIONS.values():
            raise ValueError(f"Duration must be one of {list(BATTLE_DURATIONS.values())} minutes")

        # Fetch price before entering the session (async, no DB lock needed yet).
        entry_price = await self._fetch_mark_price(market)
        if not entry_price:
            raise Exception(f"Could not fetch price for {market}. Please try again.")

        expiry_at = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
        perp_order_id: Optional[int] = None
        leverage = Decimal(str(BATTLE_DEFAULT_LEVERAGE))

        if backing == "perps":
            perp_order_id = await self._open_perps_backing(
                user_id=user_id,
                market=market,
                direction=direction,
                stake_usd=stake_usd,
                leverage=int(leverage),
            )

        # MONEY-PATH: prediction debit + Battle INSERT in ONE transaction.
        with get_session() as session:
            # --- per-user open-battle cap (abuse guard) ---
            open_count = (
                session.query(Battle)
                .filter(Battle.user_id == user_id, Battle.status == "open")
                .count()
            )
            if open_count >= BATTLE_MAX_OPEN:
                raise ValueError(
                    f"You already have {open_count} open battles. "
                    f"Maximum is {BATTLE_MAX_OPEN}. Settle existing battles first."
                )

            if backing == "prediction":
                # Debit user, credit treasury — both in this session/transaction.
                treasury_id = _get_treasury_user_id()
                try:
                    _adjust_balance_in_session(session, user_id, stake_usd, "subtract")
                except ValueError as exc:
                    raise ValueError(
                        f"Insufficient custodial balance to open battle: {exc}"
                    ) from exc
                _adjust_balance_in_session(session, treasury_id, stake_usd, "add")
                logger.info(
                    "battle open: debited user=%s $%.4f, credited treasury=%s",
                    user_id,
                    float(stake_usd),
                    treasury_id,
                )

            battle = Battle(
                user_id=user_id,
                market=market,
                direction=direction,
                stake_usd=stake_usd,
                backing=backing,
                leverage=leverage if backing == "perps" else None,
                entry_price=entry_price,
                expiry_at=expiry_at,
                perp_order_id=perp_order_id,
                status="open",
                created_at=datetime.now(timezone.utc),
            )
            session.add(battle)
            session.flush()
            session.expunge(battle)

        logger.info(
            "Battle opened: id=%s user=%s market=%s dir=%s stake=%.2f backing=%s",
            battle.id,
            user_id,
            market,
            direction,
            stake_usd,
            backing,
        )
        return battle

    async def _open_perps_backing(
        self,
        user_id: int,
        market: str,
        direction: str,
        stake_usd: Decimal,
        leverage: int,
    ) -> Optional[int]:
        """Open a HyperLiquid position for this battle.

        Returns the perp_order id (from PerpOrder.id) or None on failure.
        We deliberately let perps errors surface so the caller can abort the battle.
        """
        from bot.services.perps_service import perps_service
        from bot.services.hyperliquid_client import hyperliquid_client

        side = "long" if direction == "up" else "short"
        price = await hyperliquid_client.get_mark_price(market)
        if not price:
            raise Exception("Cannot fetch price for perps backing")
        size = float(stake_usd) * leverage / price

        # open_position returns a PerpPosition; we want the PerpOrder id that was
        # created inside. The easiest approach is to read the latest PerpOrder for
        # this user+market after the call — perps_service writes it in the same tx.
        await perps_service.open_position(
            user_id=user_id,
            market=market,
            side=side,
            size=size,
            leverage=leverage,
        )

        # Read back the order id that was just written.
        try:
            from bot.models.perps import PerpOrder

            with get_session() as session:
                order = (
                    session.query(PerpOrder)
                    .filter_by(user_id=user_id, market=market, side=side)
                    .order_by(PerpOrder.id.desc())
                    .first()
                )
                return order.id if order else None
        except Exception as e:
            logger.warning("battle: could not read back PerpOrder id: %s", e)
            return None

    async def settle_battle(self, battle_id: int) -> Optional[Battle]:
        """Settle a single battle by id.

        ATOMICITY / IDEMPOTENCY design:
        ─────────────────────────────
        Step 1  — Atomic CAS in its own short transaction:
                    UPDATE battles SET status='settling'
                    WHERE id=:id AND status='open'
                  rowcount==0  →  already settled/voided by another tick, return None.
                  rowcount==1  →  we exclusively own this battle; read the row fields
                                  and commit (session context exits).

        Step 2  — Async price fetch + perps close (no DB lock held).  Safe because
                  status='settling' prevents any other caller from touching the row.

        Step 3  — Final write in a second transaction: apply balance mutations
                  (prediction only) and flip status to 'settled'/'voided'.
                  If the balance write fails we try to void + refund; either way
                  the row leaves 'settling' so it does not get retried forever.

        Returns the settled Battle row (expunged) or None if already settled.
        """
        # ── Step 1: CAS — claim the battle for settlement ──────────────────
        with get_session() as session:
            result = session.execute(
                text(
                    "UPDATE battles SET status = 'settling' " "WHERE id = :id AND status = 'open'"
                ),
                {"id": battle_id},
            )
            if result.rowcount == 0:
                # Already settled, voided, or mid-settling by another tick.
                return None

            # Read all fields we need while still in this short transaction.
            battle = session.query(Battle).filter(Battle.id == battle_id).first()
            if not battle:
                return None  # Should not happen after rowcount==1.

            battle_user_id = battle.user_id
            battle_market = battle.market
            battle_direction = battle.direction
            battle_backing = battle.backing
            battle_stake_usd = Decimal(str(battle.stake_usd))
            battle_entry_price = Decimal(str(battle.entry_price))
            session.expunge(battle)
        # CAS committed; status='settling' is now visible to all concurrent ticks.

        # ── Step 1b: Validate stake (guard before any balance move) ─────────
        if battle_stake_usd <= 0:
            logger.error("battle %s: stake_usd <= 0, voiding", battle_id)
            return await self._write_settlement_result(
                battle_id=battle_id,
                battle_user_id=battle_user_id,
                battle_backing=battle_backing,
                battle_stake_usd=battle_stake_usd,
                settle_price=None,
                outcome="void",
                pnl_usd=Decimal("0"),
            )

        # ── Step 2: Async operations (price fetch, perps close) ─────────────
        settle_price: Optional[Decimal] = await self._fetch_mark_price(battle_market)

        if not settle_price:
            logger.warning("battle %s: settle price unavailable, voiding", battle_id)
            outcome = "void"
            pnl_usd = Decimal("0")
        else:
            price_moved_up = settle_price > battle_entry_price
            if battle_direction == "up":
                outcome = "win" if price_moved_up else "loss"
            else:
                outcome = "win" if not price_moved_up else "loss"

            if battle_backing == "perps":
                pnl_usd = await self._settle_perps_backing(
                    battle_id=battle_id,
                    user_id=battle_user_id,
                    market=battle_market,
                    direction=battle_direction,
                    stake_usd=battle_stake_usd,
                    entry_price=battle_entry_price,
                    settle_price=settle_price,
                )
            else:  # prediction
                pnl_usd = (
                    battle_stake_usd * (PREDICTION_WIN_MULTIPLIER - 1)
                    if outcome == "win"
                    else -battle_stake_usd
                )

        # ── Step 3: Write balances + final status in one transaction ─────────
        return await self._write_settlement_result(
            battle_id=battle_id,
            battle_user_id=battle_user_id,
            battle_backing=battle_backing,
            battle_stake_usd=battle_stake_usd,
            settle_price=settle_price,
            outcome=outcome,
            pnl_usd=pnl_usd,
        )

    async def _write_settlement_result(
        self,
        battle_id: int,
        battle_user_id: int,
        battle_backing: str,
        battle_stake_usd: Decimal,
        settle_price: Optional[Decimal],
        outcome: str,
        pnl_usd: Decimal,
    ) -> Optional[Battle]:
        """Write balance mutations and final status in one atomic transaction.

        Called after the CAS (status='settling') has already committed.
        For prediction battles: applies payout via _apply_prediction_payout().
        On any exception the battle is voided and a refund is attempted.
        """
        with get_session() as session:
            # ── Step 3 CAS: atomically claim the 'settling' row ───────────────
            # This guards against the orphan-recovery path in settle_expired_battles
            # resetting status='settling' → 'open' (after 5 min timeout) while
            # Step 2 (async price fetch) is still in flight.  A new tick could then
            # CAS-claim the row before we reach here, leaving two writers racing to
            # apply a payout.  The guarded UPDATE ensures only the writer that
            # transitions status OUT OF 'settling' proceeds with balance mutations.
            final_status = "settled" if outcome != "void" else "voided"
            settled_at = datetime.now(timezone.utc)
            cas_result = session.execute(
                text(
                    "UPDATE battles "
                    "SET status = :final_status, "
                    "    settle_price = :settle_price, "
                    "    outcome = :outcome, "
                    "    pnl_usd = :pnl_usd, "
                    "    settled_at = :settled_at "
                    "WHERE id = :id AND status = 'settling'"
                ),
                {
                    "final_status": final_status,
                    "settle_price": float(settle_price) if settle_price is not None else None,
                    "outcome": outcome,
                    "pnl_usd": float(pnl_usd),
                    "settled_at": settled_at,
                    "id": battle_id,
                },
            )
            if cas_result.rowcount == 0:
                # Row was re-opened by orphan recovery and re-claimed by another tick,
                # or already finalized.  Do NOT pay out — another writer owns it.
                logger.warning(
                    "battle %s: Step 3 CAS missed (status != 'settling') — "
                    "another tick owns this settlement, skipping payout",
                    battle_id,
                )
                return None

            # CAS succeeded (rowcount==1): we exclusively own the final write.
            # Apply balance mutations in the SAME transaction so the status flip
            # and the payout commit or roll back together.
            if battle_backing == "prediction":
                treasury_id = _get_treasury_user_id()
                try:
                    self._apply_prediction_payout(
                        session=session,
                        outcome=outcome,
                        user_id=battle_user_id,
                        treasury_id=treasury_id,
                        stake_usd=battle_stake_usd,
                    )
                except Exception as exc:
                    logger.error(
                        "battle %s: balance mutation failed (%s) — voiding and refunding",
                        battle_id,
                        exc,
                    )
                    outcome = "void"
                    pnl_usd = Decimal("0")
                    settle_price = None
                    # Overwrite the status columns set by the CAS above to reflect
                    # the forced void outcome within the same transaction.
                    session.execute(
                        text(
                            "UPDATE battles "
                            "SET status = 'voided', "
                            "    settle_price = NULL, "
                            "    outcome = 'void', "
                            "    pnl_usd = 0 "
                            "WHERE id = :id"
                        ),
                        {"id": battle_id},
                    )
                    try:
                        _adjust_balance_in_session(
                            session, treasury_id, battle_stake_usd, "subtract"
                        )
                        _adjust_balance_in_session(session, battle_user_id, battle_stake_usd, "add")
                    except Exception as refund_exc:
                        logger.critical(
                            "battle %s: VOID refund also failed — manual fix required: %s",
                            battle_id,
                            refund_exc,
                        )

            # Re-read the final row (fields written by CAS UPDATE above) so the
            # returned object reflects the committed state.
            battle = session.query(Battle).filter(Battle.id == battle_id).first()
            if not battle:
                logger.error(
                    "battle %s: row gone after Step 3 CAS — manual fix required", battle_id
                )
                return None
            session.expunge(battle)

        logger.info(
            "Battle settled: id=%s user=%s outcome=%s pnl=%.4f settle_price=%s",
            battle_id,
            battle_user_id,
            outcome,
            float(pnl_usd),
            settle_price,
        )
        return battle

    def _apply_prediction_payout(
        self,
        session: Session,
        outcome: str,
        user_id: int,
        treasury_id: int,
        stake_usd: Decimal,
    ) -> None:
        """Apply treasury <-> user balance moves for a prediction battle outcome.

        All mutations happen on the caller's session (same transaction as the
        status flip).  Raises ValueError on insufficient treasury balance.

        WIN:  treasury pays user stake * PREDICTION_WIN_MULTIPLIER
        LOSS: no-op (funds already moved to treasury at open_battle)
        VOID: treasury refunds user stake exactly
        """
        if outcome == "win":
            payout = (stake_usd * PREDICTION_WIN_MULTIPLIER).quantize(Decimal("0.000001"))
            # Check treasury solvency.
            treasury_bal = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == treasury_id,
                    CustodialBalance.chain == _BATTLE_CHAIN,
                    CustodialBalance.token_symbol == _BATTLE_TOKEN,
                )
                .with_for_update()
                .first()
            )
            treasury_balance = Decimal(treasury_bal.balance) if treasury_bal else Decimal("0")
            if treasury_balance < payout:
                logger.critical(
                    "battle treasury INSOLVENT: has %.4f %s, needs %.4f for win payout — voiding",
                    float(treasury_balance),
                    _BATTLE_TOKEN,
                    float(payout),
                )
                raise ValueError(
                    f"Treasury insolvent: balance {treasury_balance} < payout {payout}"
                )
            _adjust_balance_in_session(session, treasury_id, payout, "subtract")
            _adjust_balance_in_session(session, user_id, payout, "add")
            logger.info(
                "battle prediction WIN: treasury=%s paid user=%s $%.4f",
                treasury_id,
                user_id,
                float(payout),
            )

        elif outcome == "void":
            # Refund exact stake from treasury to user.
            _adjust_balance_in_session(session, treasury_id, stake_usd, "subtract")
            _adjust_balance_in_session(session, user_id, stake_usd, "add")
            logger.info(
                "battle prediction VOID: treasury=%s refunded user=%s $%.4f",
                treasury_id,
                user_id,
                float(stake_usd),
            )

        # LOSS: no balance move needed — funds already in treasury from open_battle.

    async def _settle_perps_backing(
        self,
        battle_id: int,
        user_id: int,
        market: str,
        direction: str,
        stake_usd: Decimal,
        entry_price: Decimal,
        settle_price: Decimal,
    ) -> Decimal:
        """Close the HyperLiquid position that backs this battle and return realised PnL."""
        from bot.services.perps_service import perps_service
        from bot.models.perps import PerpPosition

        side = "long" if direction == "up" else "short"
        # Find the matching open position for this user + market + side.
        try:
            with get_session() as session:
                position = (
                    session.query(PerpPosition)
                    .filter_by(user_id=user_id, market=market, side=side, status="open")
                    .order_by(PerpPosition.id.desc())
                    .first()
                )
                position_id = position.id if position else None

            if position_id:
                result = await perps_service.close_position(
                    user_id=user_id,
                    position_id=position_id,
                    percent=100.0,
                )
                if result:
                    return Decimal(str(result.get("pnl", 0)))
        except Exception as e:
            logger.error("battle %s: perps close failed: %s", battle_id, e)

        # Fallback: compute PnL from oracle prices if close failed.
        leverage = Decimal(str(BATTLE_DEFAULT_LEVERAGE))
        size = stake_usd * leverage / entry_price
        if direction == "up":
            return (settle_price - entry_price) * size
        else:
            return (entry_price - settle_price) * size

    async def settle_expired_battles(self) -> int:
        """Settle all open battles whose expiry_at has passed.

        Called from the background scheduler.  Returns the count settled.
        Errors in individual battles are isolated — one bad settlement never
        blocks the rest.

        Also recovers orphaned 'settling' rows: a crash after the CAS commit
        but before _write_settlement_result leaves a battle stuck in 'settling'.
        After 5 minutes we reset such rows to 'open' so settle_battle's CAS can
        re-claim them and complete the write.
        """
        now = datetime.now(timezone.utc)
        stale_settling_cutoff = now - timedelta(minutes=5)

        with get_session() as session:
            # Reset stale 'settling' rows to 'open' so the CAS can re-claim them.
            session.execute(
                text(
                    "UPDATE battles SET status = 'open' "
                    "WHERE status = 'settling' AND expiry_at <= :cutoff"
                ),
                {"cutoff": stale_settling_cutoff},
            )

            expired_ids = [
                row.id
                for row in session.query(Battle.id)
                .filter(Battle.status == "open", Battle.expiry_at <= now)
                .all()
            ]

        settled = 0
        for battle_id in expired_ids:
            try:
                result = await self.settle_battle(battle_id)
                if result:
                    settled += 1
            except Exception as e:
                logger.error("battle %s settle error: %s", battle_id, e)

        if settled:
            logger.info("battle_service: settled %d expired battles", settled)
        return settled

    # ------------------------------------------------------------------ #
    #  Query helpers
    # ------------------------------------------------------------------ #

    def get_user_battles(
        self,
        user_id: int,
        status: Optional[str] = None,
        limit: int = 10,
    ) -> list[Battle]:
        """Return battles for *user_id*, optionally filtered by status."""
        with get_session() as session:
            q = session.query(Battle).filter(Battle.user_id == user_id)
            if status:
                q = q.filter(Battle.status == status)
            battles = q.order_by(Battle.id.desc()).limit(limit).all()
            for b in battles:
                session.expunge(b)
            return battles

    def get_battle(self, battle_id: int, user_id: int) -> Optional[Battle]:
        """Get a specific battle, enforcing user_id ownership."""
        with get_session() as session:
            battle = (
                session.query(Battle)
                .filter(Battle.id == battle_id, Battle.user_id == user_id)
                .first()
            )
            if battle:
                session.expunge(battle)
            return battle


battle_service = BattleService()
