"""Airdrop campaign service — community token-drop automation.

Handles campaign lifecycle (create → claim → expire/cancel) with custodial
balance integration via hot_wallet_service.

MONEY-PATH notes
----------------
* Creator balance is debited atomically inside create_campaign; if the debit
  raises (insufficient funds) the campaign row is never committed.
* claim_for_user acquires a SELECT FOR UPDATE row lock on the campaign row
  before decrementing remaining funds, preventing over-draw races.
* AirdropClaim has UNIQUE(campaign_id, claimer_id); a duplicate INSERT raises
  IntegrityError which we surface as AlreadyClaimedError so callers can show
  a sensible message instead of an unhandled 500.
* expire_campaigns is idempotent: it only processes 'active' campaigns whose
  expires_at has passed and refunds only once by immediately flipping status
  to 'expired'.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.exc import IntegrityError

from bot.models.community import AirdropCampaign, AirdropClaim
from bot.models.custodial import TransactionType
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sentinel exceptions
# ---------------------------------------------------------------------------


class InsufficientFundsError(Exception):
    """Creator's custodial balance is too low to fund the campaign."""


class AlreadyClaimedError(Exception):
    """This user has already claimed from this campaign."""


class CampaignNotActiveError(Exception):
    """Campaign is not in 'active' status (expired, exhausted, or cancelled)."""


class CampaignExhaustedError(Exception):
    """All allocation has been claimed; no more claims allowed."""


# ---------------------------------------------------------------------------
# Dataclass for lightweight transport (avoids detached-ORM pitfalls)
# ---------------------------------------------------------------------------


@dataclass
class CampaignInfo:
    id: int
    creator_id: int
    chat_id: str
    token: str
    chain: str
    total_amount: Decimal
    remaining_amount: Decimal
    per_user_amount: Optional[Decimal]
    criteria: Optional[dict]
    status: str
    expires_at: Optional[datetime]
    created_at: datetime
    claim_count: int


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class AirdropCampaignService:
    """Business logic for airdrop campaign creation, claiming, and expiry."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _to_info(self, campaign: AirdropCampaign, claim_count: int = 0) -> CampaignInfo:
        criteria = None
        if campaign.criteria:
            try:
                criteria = json.loads(campaign.criteria)
            except (ValueError, TypeError):
                criteria = {"raw": campaign.criteria}

        return CampaignInfo(
            id=campaign.id,
            creator_id=campaign.creator_id,
            chat_id=campaign.chat_id,
            token=campaign.token,
            chain=campaign.chain,
            total_amount=Decimal(str(campaign.total_amount)),
            remaining_amount=Decimal(str(campaign.remaining_amount)),
            per_user_amount=(
                Decimal(str(campaign.per_user_amount)) if campaign.per_user_amount else None
            ),
            criteria=criteria,
            status=campaign.status,
            expires_at=campaign.expires_at,
            created_at=campaign.created_at,
            claim_count=claim_count,
        )

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    def create_campaign(
        self,
        *,
        creator_db_id: int,
        chat_id: str,
        token: str,
        chain: str,
        total_amount: Decimal,
        per_user_amount: Optional[Decimal] = None,
        max_claimants: Optional[int] = None,
        criteria: Optional[dict] = None,
        expires_at: Optional[datetime] = None,
    ) -> CampaignInfo:
        """Create a campaign, debiting creator's custodial balance up front.

        Either per_user_amount (fixed per-user allocation) or max_claimants
        (even split) must be provided — not both, not neither.

        Raises
        ------
        ValueError
            If arguments are invalid (amounts <= 0, missing split spec, etc.)
        InsufficientFundsError
            If creator's custodial balance < total_amount.
        """
        # --- Input validation ---
        if total_amount <= Decimal("0"):
            raise ValueError("total_amount must be greater than 0")

        if per_user_amount is not None and max_claimants is not None:
            raise ValueError("Specify either per_user_amount or max_claimants, not both")

        if per_user_amount is None and max_claimants is None:
            raise ValueError("Must specify either per_user_amount or max_claimants")

        if per_user_amount is not None and per_user_amount <= Decimal("0"):
            raise ValueError("per_user_amount must be greater than 0")

        if max_claimants is not None and max_claimants < 1:
            raise ValueError("max_claimants must be at least 1")

        # Compute per-user amount for even-split mode
        if max_claimants is not None:
            per_user_amount = (total_amount / Decimal(max_claimants)).quantize(Decimal("0.000001"))

        # Guard: per_user_amount must not exceed total
        if per_user_amount is not None and per_user_amount > total_amount:
            raise ValueError("per_user_amount exceeds total_amount")

        # Encode criteria
        criteria_json: Optional[str] = None
        if criteria:
            if max_claimants is not None:
                criteria = dict(criteria)
                criteria["max_claimants"] = max_claimants
            criteria_json = json.dumps(criteria)
        elif max_claimants is not None:
            criteria_json = json.dumps({"max_claimants": max_claimants})

        with get_session() as session:
            # Verify the creator exists
            creator = session.query(User).filter(User.id == creator_db_id).first()
            if not creator:
                raise ValueError(f"User {creator_db_id} not found")

            # Check & debit creator balance inside the same transaction
            balance_row = None
            from bot.models.custodial import CustodialBalance

            balance_row = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == creator_db_id,
                    CustodialBalance.chain == chain,
                    CustodialBalance.token_symbol == token,
                )
                .with_for_update()
                .first()
            )

            current_balance = Decimal(balance_row.balance) if balance_row else Decimal("0")

            if current_balance < total_amount:
                raise InsufficientFundsError(
                    f"Balance {current_balance} {token} < {total_amount} required"
                )

            # Debit the creator
            balance_row.balance = str(current_balance - total_amount)

            # Create campaign row — remaining_amount starts at total
            campaign = AirdropCampaign(
                creator_id=creator_db_id,
                chat_id=str(chat_id),
                token=token,
                chain=chain,
                total_amount=str(total_amount),
                remaining_amount=str(total_amount),
                per_user_amount=str(per_user_amount) if per_user_amount else None,
                criteria=criteria_json,
                status="active",
                expires_at=expires_at,
                created_at=datetime.now(timezone.utc),
            )
            session.add(campaign)
            session.flush()  # get campaign.id before commit

            # Record the escrow debit transaction
            from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS

            token_address = get_token_address(token, chain) or NATIVE_TOKEN_ADDRESS
            from bot.models.custodial import CustodialTransaction

            tx = CustodialTransaction(
                user_id=creator_db_id,
                tx_type=TransactionType.FEE.value,
                chain=chain,
                token_symbol=token,
                token_address=token_address,
                amount=str(total_amount),
                notes=f"airdrop_escrow:campaign:{campaign.id}",
            )
            session.add(tx)

            campaign_id = campaign.id

        logger.info(
            "AirdropCampaign %d created by user %d: %s %s on %s, expires %s",
            campaign_id,
            creator_db_id,
            total_amount,
            token,
            chain,
            expires_at,
        )

        return self.get_campaign(campaign_id)

    # ------------------------------------------------------------------
    # Fetch
    # ------------------------------------------------------------------

    def get_campaign(self, campaign_id: int) -> Optional[CampaignInfo]:
        """Return campaign info or None if not found."""
        with get_session() as session:
            campaign = (
                session.query(AirdropCampaign).filter(AirdropCampaign.id == campaign_id).first()
            )
            if not campaign:
                return None
            count = (
                session.query(AirdropClaim).filter(AirdropClaim.campaign_id == campaign_id).count()
            )
            return self._to_info(campaign, count)

    def get_active_campaigns_for_chat(self, chat_id: str) -> List[CampaignInfo]:
        """Return all active campaigns for a given Telegram chat."""
        now = datetime.now(timezone.utc)
        with get_session() as session:
            campaigns = (
                session.query(AirdropCampaign)
                .filter(
                    AirdropCampaign.chat_id == str(chat_id),
                    AirdropCampaign.status == "active",
                )
                .all()
            )
            result = []
            for c in campaigns:
                # Filter out already-expired ones (background job handles status flip)
                if c.expires_at and c.expires_at.replace(tzinfo=timezone.utc) < now:
                    continue
                count = session.query(AirdropClaim).filter(AirdropClaim.campaign_id == c.id).count()
                result.append(self._to_info(c, count))
            return result

    def get_user_campaigns(self, creator_db_id: int) -> List[CampaignInfo]:
        """Return all campaigns created by a user, newest first."""
        with get_session() as session:
            campaigns = (
                session.query(AirdropCampaign)
                .filter(AirdropCampaign.creator_id == creator_db_id)
                .order_by(AirdropCampaign.id.desc())
                .all()
            )
            result = []
            for c in campaigns:
                count = session.query(AirdropClaim).filter(AirdropClaim.campaign_id == c.id).count()
                result.append(self._to_info(c, count))
            return result

    def has_claimed(self, campaign_id: int, claimer_db_id: int) -> bool:
        """Return True if the user already has a claim record for this campaign."""
        with get_session() as session:
            return (
                session.query(AirdropClaim)
                .filter(
                    AirdropClaim.campaign_id == campaign_id,
                    AirdropClaim.claimer_id == claimer_db_id,
                )
                .first()
                is not None
            )

    # ------------------------------------------------------------------
    # Claim
    # ------------------------------------------------------------------

    def claim_for_user(self, *, campaign_id: int, claimer_db_id: int) -> Decimal:
        """Process a single claim.

        Returns the amount credited to the claimer's custodial balance.

        Raises
        ------
        CampaignNotActiveError   — status != 'active' or expired
        CampaignExhaustedError   — remaining_amount < per_user_amount
        AlreadyClaimedError      — UNIQUE constraint violation (or pre-check)
        ValueError               — campaign has no per_user_amount set
        """
        with get_session() as session:
            # Lock the campaign row to prevent concurrent over-draw
            campaign = (
                session.query(AirdropCampaign)
                .filter(AirdropCampaign.id == campaign_id)
                .with_for_update()
                .first()
            )

            if not campaign:
                raise CampaignNotActiveError("Campaign not found")

            if campaign.status != "active":
                raise CampaignNotActiveError(f"Campaign is {campaign.status}, not active")

            # Check wall-clock expiry even if status is still 'active'
            if campaign.expires_at:
                expires = campaign.expires_at
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) >= expires:
                    campaign.status = "expired"
                    raise CampaignNotActiveError("Campaign has expired")

            # Prevent self-farming: creator cannot claim their own airdrop
            if claimer_db_id == campaign.creator_id:
                raise ValueError("Campaign creators cannot claim their own airdrop")

            if not campaign.per_user_amount:
                raise ValueError("Campaign has no per_user_amount; variable airdrops unsupported")

            per_user = Decimal(str(campaign.per_user_amount))
            remaining = Decimal(str(campaign.remaining_amount))

            if remaining < per_user:
                campaign.status = "exhausted"
                raise CampaignExhaustedError(
                    f"Remaining {remaining} < {per_user}; campaign is exhausted"
                )

            # Check criteria: max_claimants cap
            if campaign.criteria:
                try:
                    criteria_dict = json.loads(campaign.criteria)
                    max_claimants = criteria_dict.get("max_claimants")
                    if max_claimants is not None:
                        current_count = (
                            session.query(AirdropClaim)
                            .filter(AirdropClaim.campaign_id == campaign_id)
                            .count()
                        )
                        if current_count >= int(max_claimants):
                            campaign.status = "exhausted"
                            raise CampaignExhaustedError(f"Max claimants ({max_claimants}) reached")
                except (ValueError, KeyError):
                    pass

            # Insert claim row — UNIQUE(campaign_id, claimer_id) is our last-resort guard
            claim = AirdropClaim(
                campaign_id=campaign_id,
                claimer_id=claimer_db_id,
                amount=str(per_user),
                claimed_at=datetime.now(timezone.utc),
            )
            session.add(claim)

            # Decrement remaining
            new_remaining = remaining - per_user
            campaign.remaining_amount = str(new_remaining)
            if new_remaining < per_user:
                # Next claim would fail; pre-mark exhausted if truly zero
                if new_remaining == Decimal("0"):
                    campaign.status = "exhausted"

            # Credit claimer's custodial balance inside the same transaction
            from bot.models.custodial import CustodialBalance
            from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS

            token_address = (
                get_token_address(campaign.token, campaign.chain) or NATIVE_TOKEN_ADDRESS
            )

            balance_row = (
                session.query(CustodialBalance)
                .filter(
                    CustodialBalance.user_id == claimer_db_id,
                    CustodialBalance.chain == campaign.chain,
                    CustodialBalance.token_symbol == campaign.token,
                )
                .with_for_update()
                .first()
            )

            if not balance_row:
                balance_row = CustodialBalance(
                    user_id=claimer_db_id,
                    chain=campaign.chain,
                    token_symbol=campaign.token,
                    token_address=token_address,
                    balance="0",
                )
                session.add(balance_row)

            balance_row.balance = str(Decimal(balance_row.balance) + per_user)

            # Record the credit transaction
            from bot.models.custodial import CustodialTransaction

            session.add(
                CustodialTransaction(
                    user_id=claimer_db_id,
                    tx_type=TransactionType.DEPOSIT.value,
                    chain=campaign.chain,
                    token_symbol=campaign.token,
                    token_address=token_address,
                    amount=str(per_user),
                    notes=f"airdrop_claim:campaign:{campaign_id}",
                )
            )

            try:
                session.flush()  # surface UNIQUE violation before commit
            except IntegrityError:
                session.rollback()
                raise AlreadyClaimedError(
                    f"User {claimer_db_id} already claimed from campaign {campaign_id}"
                )

        logger.info(
            "AirdropClaim: user %d claimed %s %s from campaign %d",
            claimer_db_id,
            per_user,
            campaign.token,
            campaign_id,
        )
        return per_user

    # ------------------------------------------------------------------
    # Cancel (creator/admin)
    # ------------------------------------------------------------------

    def cancel_campaign(self, *, campaign_id: int, requestor_db_id: int) -> Decimal:
        """Cancel an active campaign and refund remaining funds to creator.

        Returns the refunded amount.

        Raises
        ------
        PermissionError   — requestor is not the campaign creator.
        CampaignNotActiveError — campaign is not active.
        """
        with get_session() as session:
            campaign = (
                session.query(AirdropCampaign)
                .filter(AirdropCampaign.id == campaign_id)
                .with_for_update()
                .first()
            )

            if not campaign:
                raise ValueError("Campaign not found")

            if campaign.creator_id != requestor_db_id:
                raise PermissionError("Only the campaign creator can cancel it")

            if campaign.status != "active":
                raise CampaignNotActiveError(f"Campaign is already {campaign.status}")

            refund = Decimal(str(campaign.remaining_amount))
            campaign.status = "cancelled"
            campaign.remaining_amount = "0"

            if refund > Decimal("0"):
                # Credit the refund back to creator
                from bot.models.custodial import CustodialBalance, CustodialTransaction
                from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS

                token_address = (
                    get_token_address(campaign.token, campaign.chain) or NATIVE_TOKEN_ADDRESS
                )

                balance_row = (
                    session.query(CustodialBalance)
                    .filter(
                        CustodialBalance.user_id == campaign.creator_id,
                        CustodialBalance.chain == campaign.chain,
                        CustodialBalance.token_symbol == campaign.token,
                    )
                    .with_for_update()
                    .first()
                )

                if not balance_row:
                    balance_row = CustodialBalance(
                        user_id=campaign.creator_id,
                        chain=campaign.chain,
                        token_symbol=campaign.token,
                        token_address=token_address,
                        balance="0",
                    )
                    session.add(balance_row)

                balance_row.balance = str(Decimal(balance_row.balance) + refund)

                session.add(
                    CustodialTransaction(
                        user_id=campaign.creator_id,
                        tx_type=TransactionType.REFUND.value,
                        chain=campaign.chain,
                        token_symbol=campaign.token,
                        token_address=token_address,
                        amount=str(refund),
                        notes=f"airdrop_refund:campaign:{campaign_id}:cancel",
                    )
                )

        logger.info(
            "AirdropCampaign %d cancelled by user %d; refunded %s",
            campaign_id,
            requestor_db_id,
            refund,
        )
        return refund

    # ------------------------------------------------------------------
    # Expiry (background job)
    # ------------------------------------------------------------------

    def expire_campaigns(self) -> int:
        """Scan for expired active campaigns and refund remaining to creators.

        Idempotent — only processes campaigns still in 'active' status.
        Returns the number of campaigns processed.
        """
        now = datetime.now(timezone.utc)
        processed = 0

        with get_session() as session:
            expired_campaigns = (
                session.query(AirdropCampaign)
                .filter(
                    AirdropCampaign.status == "active",
                    AirdropCampaign.expires_at.isnot(None),
                    AirdropCampaign.expires_at <= now,
                )
                .with_for_update(skip_locked=True)
                .all()
            )

            for campaign in expired_campaigns:
                refund = Decimal(str(campaign.remaining_amount))
                campaign.status = "expired"
                campaign.remaining_amount = "0"

                if refund > Decimal("0"):
                    from bot.models.custodial import CustodialBalance, CustodialTransaction
                    from bot.config.tokens import get_token_address, NATIVE_TOKEN_ADDRESS

                    token_address = (
                        get_token_address(campaign.token, campaign.chain) or NATIVE_TOKEN_ADDRESS
                    )

                    balance_row = (
                        session.query(CustodialBalance)
                        .filter(
                            CustodialBalance.user_id == campaign.creator_id,
                            CustodialBalance.chain == campaign.chain,
                            CustodialBalance.token_symbol == campaign.token,
                        )
                        .with_for_update()
                        .first()
                    )

                    if not balance_row:
                        balance_row = CustodialBalance(
                            user_id=campaign.creator_id,
                            chain=campaign.chain,
                            token_symbol=campaign.token,
                            token_address=token_address,
                            balance="0",
                        )
                        session.add(balance_row)

                    balance_row.balance = str(Decimal(balance_row.balance) + refund)
                    session.add(
                        CustodialTransaction(
                            user_id=campaign.creator_id,
                            tx_type=TransactionType.REFUND.value,
                            chain=campaign.chain,
                            token_symbol=campaign.token,
                            token_address=token_address,
                            amount=str(refund),
                            notes=f"airdrop_refund:campaign:{campaign.id}:expiry",
                        )
                    )

                    logger.info(
                        "AirdropCampaign %d expired; refunded %s %s to creator %d",
                        campaign.id,
                        refund,
                        campaign.token,
                        campaign.creator_id,
                    )

                processed += 1

        return processed


# Singleton
airdrop_campaign_service = AirdropCampaignService()
