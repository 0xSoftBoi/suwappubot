"""Community payment service — tip, lucky-box, and bill-split logic.

All fund movements go through the custodial hot-wallet ledger
(CustodialBalance rows) — no on-chain transactions are emitted for
in-bot transfers.

ATOMICITY DESIGN
================
hot_wallet_service.update_custodial_balance() always opens its own
session (get_session()).  Calling it from inside another get_session()
block gives two *independent* transactions — the balance credit would
NOT be protected by the outer SELECT FOR UPDATE lock, and a crash
between the two commits would leave counters decremented but no credit
issued.

To prevent this we use ``_adjust_balance_in_session()`` — a private
helper that manipulates CustodialBalance directly on the *caller's*
session.  This keeps the balance mutation, the claim-row INSERT, and
the counter decrement all inside **one** atomic commit for
claim_lucky_box and pay_split_share.

For send_tip (no row-level lock needed) and create_lucky_box /
create_split_bill (write-once, no contention) the dual-session pattern
is acceptable and mirrors existing custodial.py usage.

MONEY-PATH
==========
  - claim_lucky_box: SELECT FOR UPDATE (LuckyBox) + UNIQUE constraint
    (LuckyBoxClaim) + single-session balance credit.
  - pay_split_share: SELECT FOR UPDATE (SplitBill + SplitBillShare) +
    status == "paid" guard + single-session debit/credit.
  - expire_lucky_boxes: status transition active -> expired -> refunded;
    double-refund is impossible.
  - send_tip: balance check before debit; pending tips protected by
    tip.status transition.
  - All amounts validated > 0 before any mutation.
"""

import logging
import random
from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, Decimal
from typing import Optional, Tuple

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from bot.models.community import (
    LuckyBox,
    LuckyBoxClaim,
    SplitBill,
    SplitBillShare,
    Tip,
)
from bot.models.custodial import CustodialBalance, TransactionType
from bot.models.user import User
from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS
from bot.services.hot_wallet import hot_wallet_service
from database.db import get_session

logger = logging.getLogger(__name__)

# Minimum granularity for a single slot (avoids zero-value payouts)
_MIN_SLOT = Decimal("0.000001")

# Default token / chain for community payments (overridden per call)
DEFAULT_CHAIN = "base"
DEFAULT_TOKEN = "USDC"

# Lucky-box lifetime
LUCKY_BOX_TTL_SECONDS = 24 * 60 * 60  # 24 hours

# Username-only pending-tip fallback: only auto-claim tips created within this
# window.  Telegram handles can be recycled after an account is deleted/renamed;
# bounding the fallback to a short recency window limits (does not eliminate)
# the blast radius of a recycled @handle claiming a stale tip meant for the
# original holder.  Tips older than this are left pending/unclaimed rather
# than silently auto-claimed by username match alone.
USERNAME_FALLBACK_MAX_AGE_SECONDS = 7 * 24 * 60 * 60  # 7 days


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_db_user_by_telegram_id(session: Session, telegram_id: int) -> Optional[User]:
    return session.query(User).filter(User.telegram_id == telegram_id).first()


def _get_db_user_by_username(session: Session, username: str) -> Optional[User]:
    """Look up a user by @username (case-insensitive, strips leading @).

    Uses exact case-insensitive equality rather than ILIKE — a raw ILIKE on
    unescaped input lets '%'/'_' act as SQL wildcards, which could match
    unintended usernames.  Username lookups should always be exact matches.
    """
    uname = username.lstrip("@").lower()
    return session.query(User).filter(func.lower(User.username) == uname).first()


def _adjust_balance_in_session(
    session: Session,
    user_id: int,
    chain: str,
    token_symbol: str,
    amount: Decimal,
    operation: str,  # "add" | "subtract"
) -> Decimal:
    """Add or subtract from CustodialBalance **within the caller's session**.

    This is the key atomicity primitive.  By operating on the session the
    caller already holds (which may have SELECT FOR UPDATE locks), the balance
    mutation is part of the same DB transaction as whatever lock/counter work
    the caller is doing.

    Raises ValueError on insufficient funds (subtract).
    Returns the new balance.
    """
    token_address = get_token_address(token_symbol, chain) or NATIVE_TOKEN_ADDRESS

    bal = (
        session.query(CustodialBalance)
        .filter(
            CustodialBalance.user_id == user_id,
            CustodialBalance.chain == chain,
            CustodialBalance.token_symbol == token_symbol,
        )
        .with_for_update()
        .first()
    )

    if bal is None:
        if operation == "subtract":
            raise ValueError("Insufficient balance")
        bal = CustodialBalance(
            user_id=user_id,
            chain=chain,
            token_symbol=token_symbol,
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
            raise ValueError(f"Insufficient balance: have {current} {token_symbol}, need {amount}")
    else:
        raise ValueError(f"Invalid operation: {operation!r}")

    bal.balance = str(new_bal)
    return new_bal


# ---------------------------------------------------------------------------
# Tipping
# ---------------------------------------------------------------------------


def send_tip(
    *,
    sender_telegram_id: int,
    recipient_telegram_id: Optional[int],
    recipient_username: Optional[str],
    chat_id: str,
    amount: Decimal,
    token: str,
    chain: str,
) -> Tuple[bool, str, Optional[int]]:
    """Debit sender and credit recipient (or hold as pending).

    Returns (success, message, tip_id).

    MONEY-PATH:
      - All balance mutations and the Tip row insert happen in a single
        session — sender debit, recipient credit (if registered), and the
        Tip record are committed atomically.
      - If recipient not yet registered, Tip is stored as status='pending'
        with recipient_id=NULL; claim_pending_tips() credits them on /start.
    """
    if amount <= _MIN_SLOT:
        return False, "Amount must be greater than 0.", None

    with get_session() as session:
        sender = _get_db_user_by_telegram_id(session, sender_telegram_id)
        if not sender:
            return False, "You must /start first.", None

        # Resolve recipient within this session
        recipient: Optional[User] = None
        if recipient_telegram_id:
            recipient = _get_db_user_by_telegram_id(session, recipient_telegram_id)
        elif recipient_username:
            recipient = _get_db_user_by_username(session, recipient_username)

        # Debit sender — raises ValueError if insufficient
        try:
            _adjust_balance_in_session(session, sender.id, chain, token, amount, "subtract")
        except ValueError as exc:
            return False, str(exc), None

        tip_status = "pending"
        credited_recipient_id: Optional[int] = None

        if recipient:
            _adjust_balance_in_session(session, recipient.id, chain, token, amount, "add")
            tip_status = "claimed"
            credited_recipient_id = recipient.id

        tip = Tip(
            sender_id=sender.id,
            recipient_id=credited_recipient_id,
            recipient_username=recipient_username,
            chat_id=chat_id,
            token=token,
            chain=chain,
            amount=amount,
            status=tip_status,
            claimed_at=_now_utc() if tip_status == "claimed" else None,
        )
        session.add(tip)
        session.flush()
        tip_id = tip.id

        # Capture sender.id before session closes
        sender_id_for_audit = sender.id

    # Audit trail (non-critical — separate sessions OK)
    try:
        hot_wallet_service.record_transaction(
            user_id=sender_id_for_audit,
            tx_type=TransactionType.WITHDRAWAL,
            chain=chain,
            token_symbol=token,
            amount=amount,
            notes=f"tip_id={tip_id}",
        )
        if credited_recipient_id:
            hot_wallet_service.record_transaction(
                user_id=credited_recipient_id,
                tx_type=TransactionType.DEPOSIT,
                chain=chain,
                token_symbol=token,
                amount=amount,
                notes=f"tip_id={tip_id}",
            )
    except Exception as exc:
        logger.warning("Failed to record tip audit rows (tip_id=%s): %s", tip_id, exc)

    if tip_status == "claimed":
        msg = f"Tip sent: {amount} {token} credited to recipient."
    else:
        msg = f"Tip of {amount} {token} held pending — recipient can claim it on /start."

    return True, msg, tip_id


def claim_pending_tips(*, recipient_telegram_id: int, recipient_username: str) -> Decimal:
    """Credit all pending tips addressed to this user.

    Called from /start when a new user registers.  Returns total credited.

    Matching priority:
      1. Tips with recipient_id == this user's db-id (bound at send time to a known
         telegram_id; immune to Telegram username recycling).
      2. Tips with recipient_id IS NULL but recipient_username matches (username-only
         tips — inherently subject to Telegram username recycling; kept for
         backward-compat but only as a fallback for tips sent before the sender
         could resolve the telegram_id).

    Each tip is credited within its own session so errors are isolated.
    """
    total = Decimal("0")
    uname = (recipient_username or "").lstrip("@").lower()

    # Fetch pending tip IDs first (read-only pass)
    with get_session() as session:
        recipient = _get_db_user_by_telegram_id(session, recipient_telegram_id)
        if not recipient:
            return total
        recipient_db_id = recipient.id

        # Pass 1: tips that were bound to this exact db-id at send time.
        id_bound_tips = (
            session.query(Tip)
            .filter(Tip.status == "pending", Tip.recipient_id == recipient_db_id)
            .all()
        )
        to_claim = [
            (tip.id, tip.chain, tip.token, Decimal(str(tip.amount))) for tip in id_bound_tips
        ]

        # Pass 2: username-only fallback (recipient_id never set — legacy path).
        # NOTE: These tips are vulnerable to Telegram username recycling; a new
        # account that later acquires the same @handle can claim them.  Tips sent
        # to a resolvable telegram_id always take the id-bound path above.
        # RESIDUAL RISK GUARD: bounded to tips created within
        # USERNAME_FALLBACK_MAX_AGE_SECONDS.  This does not fully eliminate the
        # recycling risk (a handle could be recycled within the window) but
        # caps exposure — stale username-only tips are left pending/unclaimed
        # rather than auto-claimed indefinitely by username match alone.
        if uname:
            # Tip.created_at is stored tz-naive (default=datetime.utcnow); compare
            # against a naive UTC cutoff to match the column's storage format.
            cutoff = (_now_utc() - timedelta(seconds=USERNAME_FALLBACK_MAX_AGE_SECONDS)).replace(
                tzinfo=None
            )
            username_tips = (
                session.query(Tip)
                .filter(
                    Tip.status == "pending",
                    Tip.recipient_id.is_(None),
                    Tip.created_at >= cutoff,
                )
                .all()
            )
            to_claim += [
                (tip.id, tip.chain, tip.token, Decimal(str(tip.amount)))
                for tip in username_tips
                if (tip.recipient_username or "").lstrip("@").lower() == uname
            ]

    # Credit each tip in its own session so errors are isolated
    for tip_id, tip_chain, tip_token, tip_amount in to_claim:
        try:
            with get_session() as session:
                tip = (
                    session.query(Tip)
                    .filter(Tip.id == tip_id, Tip.status == "pending")
                    .with_for_update()
                    .first()
                )
                if not tip:
                    continue  # Already claimed by a concurrent call
                _adjust_balance_in_session(
                    session, recipient_db_id, tip_chain, tip_token, tip_amount, "add"
                )
                tip.recipient_id = recipient_db_id
                tip.status = "claimed"
                tip.claimed_at = _now_utc()
            total += tip_amount
        except Exception as exc:
            logger.error("Failed to credit pending tip %s: %s", tip_id, exc)

    return total


# ---------------------------------------------------------------------------
# Lucky box
# ---------------------------------------------------------------------------


def create_lucky_box(
    *,
    creator_telegram_id: int,
    chat_id: str,
    total_amount: Decimal,
    total_count: int,
    split_mode: str,
    token: str,
    chain: str,
) -> Tuple[bool, str, Optional[int]]:
    """Debit creator and create a lucky box.

    MONEY-PATH:
      - Balance check and debit happen in the same session as the LuckyBox
        INSERT so the box is never created without funds being escrowed.
    """
    if total_amount <= 0:
        return False, "Amount must be greater than 0.", None
    if total_count < 1 or total_count > 200:
        return False, "Count must be between 1 and 200.", None
    if split_mode not in ("random", "even"):
        return False, "Split mode must be 'random' or 'even'.", None
    if total_amount / total_count < _MIN_SLOT:
        return False, f"Amount too small for {total_count} recipients.", None

    with get_session() as session:
        creator = _get_db_user_by_telegram_id(session, creator_telegram_id)
        if not creator:
            return False, "You must /start first.", None

        try:
            _adjust_balance_in_session(session, creator.id, chain, token, total_amount, "subtract")
        except ValueError as exc:
            return False, str(exc), None

        expires_at = _now_utc() + timedelta(seconds=LUCKY_BOX_TTL_SECONDS)

        box = LuckyBox(
            creator_id=creator.id,
            chat_id=chat_id,
            token=token,
            chain=chain,
            total_amount=total_amount,
            remaining_amount=total_amount,
            total_count=total_count,
            claimed_count=0,
            split_mode=split_mode,
            status="active",
            expires_at=expires_at,
        )
        session.add(box)
        session.flush()
        box_id = box.id

    logger.info(
        "Lucky box %s created by telegram_id=%s: %s %s x%s (%s)",
        box_id,
        creator_telegram_id,
        total_amount,
        token,
        total_count,
        split_mode,
    )
    return True, "Lucky box created!", box_id


def claim_lucky_box(
    *,
    box_id: int,
    claimer_telegram_id: int,
) -> Tuple[bool, str, Optional[Decimal]]:
    """Claim one slot from a lucky box.

    ATOMICITY — all of the following happen inside ONE session / ONE commit:
      1. SELECT FOR UPDATE on LuckyBox serialises concurrent claimers.
      2. Status, remaining_amount, and claimed_count are checked under lock.
      3. LuckyBoxClaim INSERT — the UNIQUE constraint (lucky_box_id, claimer_id)
         is the second fence; IntegrityError == already claimed.
      4. Box counters (remaining_amount, claimed_count, status) are updated.
      5. CustodialBalance credit via _adjust_balance_in_session() — same session,
         same commit.  A crash after step 5 but before the commit rolls back
         everything; a crash after commit means the user has their credit.

    No separate-session balance call is made here — that was the original bug.
    """
    with get_session() as session:
        claimer = _get_db_user_by_telegram_id(session, claimer_telegram_id)
        if not claimer:
            return False, "You must /start first.", None

        # ── 1. Lock the box row ──────────────────────────────────────────────
        box: Optional[LuckyBox] = (
            session.query(LuckyBox).filter(LuckyBox.id == box_id).with_for_update().first()
        )
        if not box:
            return False, "Lucky box not found.", None

        now = _now_utc()

        # ── 2. Expiry check (under lock) ─────────────────────────────────────
        expires_tz = box.expires_at
        if expires_tz.tzinfo is None:
            expires_tz = expires_tz.replace(tzinfo=timezone.utc)
        if box.status == "active" and expires_tz <= now:
            box.status = "expired"
            session.flush()

        if box.status != "active":
            return False, f"This lucky box is no longer active (status: {box.status}).", None

        if box.claimed_count >= box.total_count:
            box.status = "exhausted"
            session.flush()
            return False, "All slots have been claimed.", None

        remaining = Decimal(str(box.remaining_amount))
        slots_left = box.total_count - box.claimed_count

        # ── 3. Compute payout ────────────────────────────────────────────────
        if box.split_mode == "even":
            if slots_left == 1:
                # Last slot gets the exact remainder so rounding dust from
                # (total/count).quantize(ROUND_DOWN) on prior claims is never
                # permanently stranded in the box.
                payout = remaining
            else:
                payout = (Decimal(str(box.total_amount)) / box.total_count).quantize(
                    _MIN_SLOT, rounding=ROUND_DOWN
                )
        else:
            if slots_left == 1:
                payout = remaining
            else:
                max_payout = remaining - _MIN_SLOT * (slots_left - 1)
                if max_payout <= _MIN_SLOT:
                    payout = _MIN_SLOT
                else:
                    micro_min = int(_MIN_SLOT * 1_000_000)
                    micro_max = int(max_payout * 1_000_000)
                    payout = Decimal(random.randint(micro_min, micro_max)) / 1_000_000

        payout = min(payout, remaining)  # Safety clamp

        # ── 4. Insert claim row — UNIQUE constraint is the idempotency fence ─
        claim = LuckyBoxClaim(
            lucky_box_id=box.id,
            claimer_id=claimer.id,
            amount=payout,
            claimed_at=now,
        )
        session.add(claim)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            return False, "You have already claimed this lucky box.", None

        # ── 5. Decrement box counters ────────────────────────────────────────
        box.claimed_count += 1
        new_remaining = remaining - payout
        box.remaining_amount = new_remaining
        if box.claimed_count >= box.total_count or new_remaining <= 0:
            box.status = "exhausted"

        # ── 6. Credit claimer — SAME session, SAME commit ────────────────────
        #    _adjust_balance_in_session() locks the CustodialBalance row with
        #    FOR UPDATE too, so concurrent tip credits for the same user do not
        #    race with this credit.
        _adjust_balance_in_session(session, claimer.id, box.chain, box.token, payout, "add")

        # Capture values for logging before session closes
        box_token = box.token

    logger.info(
        "Lucky box %s claimed by telegram_id=%s: %s %s",
        box_id,
        claimer_telegram_id,
        payout,
        box_token,
    )
    return True, f"You claimed {payout} {box_token}!", payout


def expire_lucky_boxes() -> int:
    """Refund unclaimed remainder of all expired boxes to their creators.

    Intended to be called by a background scheduler.  Returns count processed.

    MONEY-PATH — double-refund prevention:
      - Boxes are only processed when status == 'active' and past expiry, or
        status == 'expired' (not yet refunded).
      - Status is transitioned to 'refunded' atomically with the credit inside
        each box's own session so a crash between two boxes does not block the
        rest.
    """
    processed = 0
    now = _now_utc()

    # Find candidate box IDs first (no lock)
    with get_session() as session:
        candidates = (
            session.query(LuckyBox.id)
            .filter(
                LuckyBox.status.in_(["active", "expired"]),
                LuckyBox.expires_at <= now,
            )
            .all()
        )
        box_ids = [row[0] for row in candidates]

    for box_id in box_ids:
        try:
            with get_session() as session:
                box = (
                    session.query(LuckyBox).filter(LuckyBox.id == box_id).with_for_update().first()
                )
                if not box:
                    continue
                if box.status not in ("active", "expired"):
                    continue  # Already refunded or exhausted

                expires_tz = box.expires_at
                if expires_tz.tzinfo is None:
                    expires_tz = expires_tz.replace(tzinfo=timezone.utc)
                if expires_tz > now:
                    continue  # Not yet expired (race with clock)

                remaining = Decimal(str(box.remaining_amount))
                if remaining > 0:
                    _adjust_balance_in_session(
                        session, box.creator_id, box.chain, box.token, remaining, "add"
                    )

                box.remaining_amount = Decimal("0")
                box.status = "refunded"
            processed += 1
        except Exception as exc:
            logger.error("Refund failed for lucky box %s: %s", box_id, exc)

    return processed


# ---------------------------------------------------------------------------
# Bill split
# ---------------------------------------------------------------------------


def create_split_bill(
    *,
    creator_telegram_id: int,
    chat_id: str,
    total_amount: Decimal,
    debtor_telegram_ids: list[int],
    debtor_usernames: list[str],
    description: Optional[str],
    token: str,
    chain: str,
) -> Tuple[bool, str, Optional[int]]:
    """Create a SplitBill and one SplitBillShare per debtor.

    The creator is NOT automatically a debtor.  Each debtor's share is
    total_amount / n_resolved_debtors, rounded down to _MIN_SLOT precision.

    Unresolved usernames/telegram_ids (no matching Suwappu account) are
    rejected up front rather than silently dropped — this ensures the sum of
    shares always equals the intended total_amount / n_debtors and unresolved
    handles never silently reduce the amount collected from the resolved set.
    """
    if total_amount <= 0:
        return False, "Amount must be greater than 0.", None

    n_debtors = len(debtor_telegram_ids) + len(debtor_usernames)
    if n_debtors == 0:
        return False, "Must specify at least one debtor.", None
    if n_debtors > 50:
        return False, "Too many debtors (max 50).", None

    with get_session() as session:
        creator = _get_db_user_by_telegram_id(session, creator_telegram_id)
        if not creator:
            return False, "You must /start first.", None

        # ── Resolve all debtors FIRST, before computing the per-share amount.
        # Share amount is computed only over the resolved set so it always
        # sums back to total_amount (rounding dust aside) — unresolved
        # usernames must be rejected, never silently excluded post-hoc.
        resolved: dict[int, int] = {}  # debtor_db_id -> 1 (dedup, preserves order via insertion)
        unresolved: list[str] = []

        for tg_id in debtor_telegram_ids:
            debtor = _get_db_user_by_telegram_id(session, tg_id)
            if debtor:
                resolved[debtor.id] = 1
            else:
                unresolved.append(str(tg_id))

        for uname in debtor_usernames:
            debtor = _get_db_user_by_username(session, uname)
            if debtor:
                resolved[debtor.id] = 1
            else:
                unresolved.append(uname if uname.startswith("@") else f"@{uname}")

        if unresolved:
            return (
                False,
                "These debtors don't have a Suwappu account yet, so the bill "
                "cannot be split accurately: " + ", ".join(unresolved) + ". "
                "Ask them to /start the bot first, then create the split again.",
                None,
            )

        if not resolved:
            return False, "None of the specified debtors have a Suwappu account.", None

        n_resolved = len(resolved)
        share_amount = (total_amount / n_resolved).quantize(_MIN_SLOT, rounding=ROUND_DOWN)
        if share_amount <= 0:
            return False, "Share amount rounds to zero — increase total amount.", None

        bill = SplitBill(
            creator_id=creator.id,
            chat_id=chat_id,
            token=token,
            chain=chain,
            total_amount=total_amount,
            description=description,
            status="pending",
        )
        session.add(bill)
        session.flush()
        bill_id = bill.id

        for debtor_id in resolved:
            session.add(
                SplitBillShare(
                    split_bill_id=bill_id,
                    debtor_id=debtor_id,
                    amount=share_amount,
                    status="pending",
                )
            )

        session.flush()

    return (
        True,
        f"Bill split created ({n_resolved} debtors, {share_amount} {token} each).",
        bill_id,
    )


def pay_split_share(
    *,
    bill_id: int,
    payer_telegram_id: int,
) -> Tuple[bool, str]:
    """Pay the calling user's share of a split bill.

    ATOMICITY — all inside ONE session / ONE commit:
      1. SELECT FOR UPDATE on SplitBill and SplitBillShare.
      2. share.status == "paid" check is the idempotency guard.
      3. Payer debit via _adjust_balance_in_session().
      4. Creator credit via _adjust_balance_in_session().
      5. share.status = "paid", bill.status = "settled" if all done.

    SECURITY: payer identity is always resolved from payer_telegram_id
    (the Telegram update's effective_user.id) — the bill_id from
    callback_data is treated as an opaque reference, never as proof of
    identity or authorisation.
    """
    with get_session() as session:
        payer = _get_db_user_by_telegram_id(session, payer_telegram_id)
        if not payer:
            return False, "You must /start first."

        # ── Lock bill row ────────────────────────────────────────────────────
        bill: Optional[SplitBill] = (
            session.query(SplitBill).filter(SplitBill.id == bill_id).with_for_update().first()
        )
        if not bill:
            return False, "Bill not found."
        if bill.status == "settled":
            return False, "This bill is already fully settled."
        if bill.status == "cancelled":
            return False, "This bill has been cancelled."

        # ── Lock share row — bound to payer.id (from telegram_id lookup) ────
        share: Optional[SplitBillShare] = (
            session.query(SplitBillShare)
            .filter(
                SplitBillShare.split_bill_id == bill_id,
                SplitBillShare.debtor_id == payer.id,
            )
            .with_for_update()
            .first()
        )
        if not share:
            return False, "You do not have a share in this bill."
        if share.status == "paid":
            return False, "You have already paid your share."

        share_amount = Decimal(str(share.amount))

        # ── Debit payer (raises ValueError if insufficient) ──────────────────
        try:
            _adjust_balance_in_session(
                session, payer.id, bill.chain, bill.token, share_amount, "subtract"
            )
        except ValueError as exc:
            return False, str(exc)

        # ── Credit creator — SAME session ────────────────────────────────────
        _adjust_balance_in_session(
            session, bill.creator_id, bill.chain, bill.token, share_amount, "add"
        )

        share.status = "paid"
        share.paid_at = _now_utc()
        session.flush()

        # Check settled
        unpaid = (
            session.query(SplitBillShare)
            .filter(
                SplitBillShare.split_bill_id == bill_id,
                SplitBillShare.status == "pending",
            )
            .count()
        )
        if unpaid == 0:
            bill.status = "settled"

        bill_token = bill.token
        bill_settled = bill.status == "settled"

    logger.info(
        "Split bill %s: payer telegram_id=%s paid %s %s",
        bill_id,
        payer_telegram_id,
        share_amount,
        bill_token,
    )
    settled_suffix = " Bill fully settled!" if bill_settled else ""
    return True, f"Paid {share_amount} {bill_token}.{settled_suffix}"


def get_split_bill_status(bill_id: int) -> Optional[dict]:
    """Return a status dict for display; None if not found."""
    with get_session() as session:
        bill: Optional[SplitBill] = session.query(SplitBill).filter(SplitBill.id == bill_id).first()
        if not bill:
            return None

        shares = session.query(SplitBillShare).filter(SplitBillShare.split_bill_id == bill_id).all()

        paid = sum(1 for s in shares if s.status == "paid")
        share_amount = Decimal(str(shares[0].amount)) if shares else Decimal("0")

        return {
            "id": bill.id,
            "creator_id": bill.creator_id,
            "total_amount": Decimal(str(bill.total_amount)),
            "token": bill.token,
            "chain": bill.chain,
            "description": bill.description,
            "status": bill.status,
            "paid_count": paid,
            "total_count": len(shares),
            "share_amount": share_amount,
        }
