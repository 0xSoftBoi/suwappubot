"""x402 Protocol Service for token-gated subscriptions and payments."""

import logging
import hashlib
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum
from decimal import Decimal

from web3 import Web3

from bot.config.settings import settings
from bot.models.subscription import (
    Subscription,
    SubscriptionTier,
    X402Payment,
    PaymentStatus,
    APICredit,
)
from bot.services.fee_service import TIER_FEE_RATES
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)

import os as _os


def _load_beta_passwords() -> dict:
    raw = _os.getenv("BETA_PASSWORDS", "")
    result = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" in pair:
            code, tier_name = pair.split(":", 1)
            try:
                result[code.strip().lower()] = SubscriptionTier[tier_name.strip().upper()]
            except KeyError:
                pass
    return result


BETA_PASSWORDS = _load_beta_passwords()


# Subscription tier limits.
#
# ``fee_rate`` is DERIVED from the canonical fee table in fee_service
# (TIER_FEE_RATES) — the single source of truth for what's actually charged
# on-chain. Do NOT hardcode the fee here: it would let this copy drift from the
# fee the swap engine collects. Update fee_service.TIER_FEE_RATES instead.
TIER_LIMITS = {
    SubscriptionTier.FREE: {
        "daily_swaps": None,  # Unlimited — revenue comes from swap fee
        "daily_api_calls": 100,
        "max_swap_usd": None,  # No cap — fee applies to all volume
        "fee_rate": TIER_FEE_RATES[SubscriptionTier.FREE],  # 1%
        "features": ["basic_swap", "balance", "history"],
        "price_usd": 0,
    },
    SubscriptionTier.PRO: {
        "daily_swaps": None,  # Unlimited
        "daily_api_calls": 1000,
        "max_swap_usd": None,  # No per-swap USD cap
        "fee_rate": TIER_FEE_RATES[SubscriptionTier.PRO],  # 0.5%
        "features": [
            "basic_swap",
            "balance",
            "history",
            "alerts",
            "limit_orders",
            "dca",
            "portfolio",
            "copy_trading",
        ],
        "price_usd": 9.99,
    },
    SubscriptionTier.PREMIUM: {
        "daily_swaps": None,  # Unlimited
        "daily_api_calls": 10000,
        "max_swap_usd": None,  # No per-swap USD cap
        "fee_rate": TIER_FEE_RATES[SubscriptionTier.PREMIUM],  # 0.3%
        "features": [
            "basic_swap",
            "balance",
            "history",
            "alerts",
            "limit_orders",
            "dca",
            "portfolio",
            "tax_export",
            "priority_execution",
            "custom_slippage",
            "copy_trading",
        ],
        "price_usd": 29.99,
    },
    SubscriptionTier.ENTERPRISE: {
        "daily_swaps": -1,  # Unlimited (legacy sentinel)
        "daily_api_calls": -1,
        "max_swap_usd": -1,
        "fee_rate": TIER_FEE_RATES[SubscriptionTier.ENTERPRISE],  # 0.1%
        "features": ["all"],
        "price_usd": 99.99,
    },
}


@dataclass
class X402PaymentRequest:
    """x402 payment request structure."""

    payment_id: str
    amount: float
    token_symbol: str
    token_address: str
    chain: str
    recipient: str
    memo: str
    expires_at: int  # Unix timestamp


@dataclass
class X402Receipt:
    """x402 payment receipt."""

    payment_id: str
    tx_hash: str
    amount: float
    token_symbol: str
    chain: str
    payer: str
    recipient: str
    timestamp: int
    signature: str


class X402Service:
    """Service for handling x402 payments and token-gated subscriptions."""

    def __init__(self):
        self.wallet_service = WalletService()

        # Payment recipient (your fee collector)
        self.payment_recipient = getattr(settings, "fee_collector_address", None)

        # Supported payment tokens (USDC + native token per chain)
        self.payment_tokens = {
            "ethereum": {
                "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "base": {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "arbitrum": {
                "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "optimism": {
                "USDC": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "polygon": {
                "USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
                "MATIC": "0x0000000000000000000000000000000000000000",
            },
            "bsc": {
                "USDC": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
                "BNB": "0x0000000000000000000000000000000000000000",
            },
            "avalanche": {
                "USDC": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
                "AVAX": "0x0000000000000000000000000000000000000000",
            },
            "fantom": {
                "USDC": "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75",
                "FTM": "0x0000000000000000000000000000000000000000",
            },
            "linea": {
                "USDC": "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "mantle": {
                "USDC": "0x09Bc4E0D10E52cdF6EaF3cdfE71aDd9e94d7f99c",
                "MNT": "0x0000000000000000000000000000000000000000",
            },
            "gnosis": {
                "USDC": "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
                "xDAI": "0x0000000000000000000000000000000000000000",
            },
            "scroll": {
                "USDC": "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "tempo": {
                # Tempo TIP-20 stablecoins (18 decimals). pathUSD is the primary
                # payment token; the others are accepted fallbacks. Decimals are
                # resolved per-address at verify time via get_decimals_by_address.
                "pathUSD": "0x20c0000000000000000000000000000000000000",
                "AlphaUSD": "0x20c0000000000000000000000000000000000001",
                "BetaUSD": "0x20c0000000000000000000000000000000000002",
                "ThetaUSD": "0x20c0000000000000000000000000000000000003",
            },
        }

    # =========================================================================
    # Subscription Management
    # =========================================================================

    async def get_subscription(self, user_id: int) -> Subscription:
        """Get or create user subscription."""
        with get_session() as session:
            sub = session.query(Subscription).filter(Subscription.user_id == user_id).first()

            if not sub:
                sub = Subscription(user_id=user_id, tier=SubscriptionTier.FREE)
                session.add(sub)
                session.flush()

            # Reset daily counters if needed
            if sub.last_reset_date.date() < datetime.now(timezone.utc).date():
                sub.api_calls_today = 0
                sub.last_reset_date = datetime.now(timezone.utc)

            return sub

    async def get_tier(self, user_id: int) -> SubscriptionTier:
        """Get user's current subscription tier."""
        sub = await self.get_subscription(user_id)

        # Check if subscription expired
        if sub.expires_at and sub.expires_at < datetime.now(timezone.utc):
            return SubscriptionTier.FREE

        return sub.tier

    async def upgrade_subscription(
        self,
        user_id: int,
        tier: SubscriptionTier,
        duration_days: int = 30,
        payment_id: Optional[str] = None,
    ) -> Subscription:
        """Upgrade user subscription."""
        with get_session() as session:
            sub = session.query(Subscription).filter(Subscription.user_id == user_id).first()

            if not sub:
                sub = Subscription(user_id=user_id)
                session.add(sub)

            sub.tier = tier
            sub.started_at = datetime.now(timezone.utc)
            sub.expires_at = datetime.now(timezone.utc) + timedelta(days=duration_days)

            logger.info(f"User {user_id} upgraded to {tier.value} for {duration_days} days")
            return sub

    async def activate_beta(
        self, user_id: int, password: str
    ) -> tuple[bool, str, Optional[SubscriptionTier]]:
        """
        Activate beta access with a password.

        Returns:
            (success, message, tier_granted)
        """
        password_lower = password.strip().lower()

        if password_lower not in BETA_PASSWORDS:
            return False, "Invalid beta code. Try again!", None

        tier = BETA_PASSWORDS[password_lower]

        # Check if already has this tier or higher
        current_tier = await self.get_tier(user_id)
        tier_order = [
            SubscriptionTier.FREE,
            SubscriptionTier.PRO,
            SubscriptionTier.PREMIUM,
            SubscriptionTier.ENTERPRISE,
        ]

        try:
            if tier_order.index(current_tier) >= tier_order.index(tier):
                return False, f"You already have {current_tier.value.upper()} access!", None
        except ValueError:
            pass  # Unknown tier — proceed with upgrade

        # Grant beta access (lifetime = 365 days)
        await self.upgrade_subscription(user_id, tier, duration_days=365)

        logger.info(f"User {user_id} activated beta code -> {tier.value}")
        return (
            True,
            f"🎉 Beta access activated! You now have **{tier.value.upper()}** for 1 year!",
            tier,
        )

    # =========================================================================
    # Feature Access Control
    # =========================================================================

    async def check_feature_access(self, user_id: int, feature: str) -> bool:
        """Check if user has access to a feature."""
        tier = await self.get_tier(user_id)
        limits = TIER_LIMITS.get(tier, TIER_LIMITS[SubscriptionTier.FREE])

        allowed_features = limits["features"]
        return "all" in allowed_features or feature in allowed_features

    async def check_swap_limit(self, user_id: int, amount_usd: float) -> tuple[bool, str]:
        """Check if user can perform swap of given amount."""
        sub = await self.get_subscription(user_id)
        tier = await self.get_tier(user_id)
        limits = TIER_LIMITS.get(tier, TIER_LIMITS[SubscriptionTier.FREE])

        # Check daily swap count.
        # None = unlimited (paid tiers); -1 = unlimited (legacy ENTERPRISE sentinel).
        daily_limit = limits["daily_swaps"]
        if daily_limit is not None and daily_limit != -1 and sub.api_calls_today >= daily_limit:
            return False, f"Daily swap limit reached ({daily_limit}). Upgrade to increase limits."

        # Check max swap amount.
        # None = no cap (paid tiers); -1 = no cap (legacy ENTERPRISE sentinel).
        max_amount = limits["max_swap_usd"]
        if max_amount is not None and max_amount != -1 and amount_usd > max_amount:
            return (
                False,
                f"Swap amount exceeds limit (${max_amount:,.0f}). Upgrade for higher limits.",
            )

        return True, "OK"

    async def record_api_call(self, user_id: int) -> None:
        """Record an API call for rate limiting."""
        with get_session() as session:
            sub = session.query(Subscription).filter(Subscription.user_id == user_id).first()

            if sub:
                sub.api_calls_today += 1
                sub.api_calls_total += 1

    # =========================================================================
    # x402 Payment Flow
    # =========================================================================

    def create_payment_request(
        self,
        amount: float,
        token_symbol: str = "USDC",
        chain: str = "base",
        memo: str = "",
        expires_in: int = 3600,  # 1 hour
    ) -> X402PaymentRequest:
        """Create an x402 payment request."""
        payment_id = f"x402_{secrets.token_hex(16)}"

        token_address = self.payment_tokens.get(chain, {}).get(token_symbol, "")

        return X402PaymentRequest(
            payment_id=payment_id,
            amount=amount,
            token_symbol=token_symbol,
            token_address=token_address,
            chain=chain,
            recipient=self.payment_recipient or "",
            memo=memo,
            expires_at=int(time.time()) + expires_in,
        )

    async def create_subscription_payment(
        self,
        user_id: int,
        tier: SubscriptionTier,
        chain: str = "base",
    ) -> X402PaymentRequest:
        """Create payment request for subscription upgrade."""
        price = TIER_LIMITS[tier]["price_usd"]

        payment = self.create_payment_request(
            amount=price,
            token_symbol="USDC",
            chain=chain,
            memo=f"Suwappu {tier.value} subscription",
        )

        # Record pending payment
        with get_session() as session:
            x402_payment = X402Payment(
                user_id=user_id,
                payment_id=payment.payment_id,
                amount=price,
                token_symbol="USDC",
                chain=chain,
                product_type="subscription",
                product_id=tier.value,
                status=PaymentStatus.PENDING,
            )
            session.add(x402_payment)

        return payment

    def _verify_transaction_on_chain_sync(
        self,
        tx_hash: str,
        chain: str,
        expected_recipient: str,
        expected_amount: float,
        token_address: Optional[str] = None,
    ) -> tuple[bool, str, Optional[str]]:
        """Synchronous on-chain verification (runs in thread pool).

        Returns (verified, message, sender) where ``sender`` is the on-chain
        payer (the tx ``from`` for native transfers, or the Transfer event's
        ``from`` for ERC20). SECURITY: callers MUST assert this sender is a wallet
        bound to the authenticated principal (sender-spoof defense) — a stateless
        recipient/amount check alone lets anyone redeem another user's inbound
        payment txHash.
        """
        try:
            from bot.config.chains import get_chain_by_name

            chain_config = get_chain_by_name(chain)
            if not chain_config:
                return False, f"Unsupported chain: {chain}", None

            from bot.services.rpc_manager import rpc_manager

            web3 = rpc_manager.get_web3(chain)

            # Fetch transaction receipt
            try:
                receipt = web3.eth.get_transaction_receipt(tx_hash)
            except Exception as e:
                logger.error(f"Failed to fetch transaction receipt: {e}")
                return False, f"Transaction not found: {tx_hash}", None

            # Check transaction succeeded
            if receipt.get("status") != 1:
                return False, "Transaction failed on-chain", None

            # Normalize addresses
            expected_recipient = Web3.to_checksum_address(expected_recipient)

            # Verify native token transfer
            if not token_address or token_address == "0x0000000000000000000000000000000000000000":
                tx = web3.eth.get_transaction(tx_hash)

                if not tx.get("to"):
                    return False, "Missing recipient address", None

                sender = Web3.to_checksum_address(tx["from"]) if tx.get("from") else None

                actual_recipient = Web3.to_checksum_address(tx["to"])
                if actual_recipient != expected_recipient:
                    return (
                        False,
                        f"Recipient mismatch: expected {expected_recipient}, got {actual_recipient}",
                        sender,
                    )

                actual_amount = Decimal(tx["value"]) / Decimal(10**18)
                expected_decimal = Decimal(str(expected_amount))
                min_amount = expected_decimal * Decimal("0.99")

                if actual_amount < min_amount:
                    return (
                        False,
                        f"Amount too low: expected {expected_amount}, got {actual_amount}",
                        sender,
                    )

                return True, "Native token transfer verified", sender

            # Verify ERC20 token transfer
            else:
                transfer_topic = web3.keccak(text="Transfer(address,address,uint256)").hex()
                token_address_checksum = Web3.to_checksum_address(token_address)

                for log in receipt.get("logs", []):
                    log_address = Web3.to_checksum_address(log.get("address", ""))

                    if log_address != token_address_checksum:
                        continue

                    topics = log.get("topics", [])
                    if not topics or topics[0].hex() != transfer_topic:
                        continue

                    if len(topics) < 3:
                        continue

                    # topics[1] = Transfer `from` (the payer), topics[2] = `to`.
                    from_address = Web3.to_checksum_address("0x" + topics[1].hex()[-40:])
                    to_address = Web3.to_checksum_address("0x" + topics[2].hex()[-40:])

                    if to_address != expected_recipient:
                        continue

                    data = log.get("data", "0x")
                    if isinstance(data, str):
                        amount_wei = int(data, 16) if data != "0x" else 0
                    else:
                        amount_wei = int.from_bytes(data, byteorder="big")

                    # Resolve token decimals from the canonical token config so
                    # non-6dp stablecoins (e.g. Tempo TIP-20 pathUSD/AlphaUSD/
                    # BetaUSD/ThetaUSD = 18dp) are scaled correctly. Falls back to
                    # 6 (USDC standard) when the address is unknown.
                    try:
                        from bot.config.tokens import get_decimals_by_address

                        decimals = get_decimals_by_address(token_address, chain)
                    except Exception:
                        decimals = 6
                    actual_amount = Decimal(amount_wei) / Decimal(10**decimals)

                    expected_decimal = Decimal(str(expected_amount))
                    min_amount = expected_decimal * Decimal("0.99")

                    if actual_amount < min_amount:
                        return (
                            False,
                            f"Amount too low: expected {expected_amount}, got {actual_amount}",
                            from_address,
                        )

                    return True, "ERC20 transfer verified", from_address

                return False, f"No matching Transfer event found for token {token_address}", None

        except Exception as e:
            logger.error(f"On-chain verification error: {e}")
            return False, f"Verification failed: {str(e)}", None

    async def _verify_transaction_on_chain(
        self,
        tx_hash: str,
        chain: str,
        expected_recipient: str,
        expected_amount: float,
        token_address: Optional[str] = None,
    ) -> tuple[bool, str, Optional[str]]:
        """Verify a transaction on-chain without blocking the event loop.

        Returns (verified, message, sender) — see the sync variant.
        """
        import asyncio

        return await asyncio.to_thread(
            self._verify_transaction_on_chain_sync,
            tx_hash,
            chain,
            expected_recipient,
            expected_amount,
            token_address,
        )

    async def verify_payment(
        self,
        payment_id: str,
        tx_hash: str,
    ) -> tuple[bool, str]:
        """Verify an x402 payment transaction."""
        with get_session() as session:
            payment = (
                session.query(X402Payment).filter(X402Payment.payment_id == payment_id).first()
            )

            if not payment:
                return False, "Payment not found"

            if payment.status == PaymentStatus.COMPLETED:
                return True, "Already completed"

            # Verify transaction on-chain
            try:
                # Verify the transaction matches payment parameters
                success, message, _sender = await self._verify_transaction_on_chain(
                    tx_hash=tx_hash,
                    chain=payment.chain,
                    expected_recipient=self.payment_recipient,
                    expected_amount=payment.amount,
                    token_address=payment.token_address,
                )

                if not success:
                    payment.status = PaymentStatus.FAILED
                    logger.warning(f"Payment {payment_id} verification failed: {message}")
                    return False, f"Verification failed: {message}"

                # Mark as completed
                payment.tx_hash = tx_hash
                payment.status = PaymentStatus.COMPLETED
                payment.completed_at = datetime.now(timezone.utc)

                logger.info(f"Payment {payment_id} verified on-chain: {message}")

                # Grant subscription
                if payment.product_type == "subscription":
                    tier = SubscriptionTier(payment.product_id)
                    await self.upgrade_subscription(
                        payment.user_id, tier, duration_days=30, payment_id=payment_id
                    )
                elif payment.product_type == "api_credits":
                    await self._add_api_credits(payment.user_id, payment.amount)

                logger.info(f"Payment {payment_id} verified and completed")
                return True, "Payment verified"

            except Exception as e:
                payment.status = PaymentStatus.FAILED
                logger.error(f"Payment verification failed: {e}")
                return False, str(e)

    # =========================================================================
    # API Credits
    # =========================================================================

    async def get_credits(self, user_id: int) -> float:
        """Get user's API credit balance."""
        with get_session() as session:
            credits = session.query(APICredit).filter(APICredit.user_id == user_id).first()

            return credits.balance if credits else 0

    async def _add_api_credits(self, user_id: int, amount: float) -> None:
        """Add API credits to user account."""
        with get_session() as session:
            credits = session.query(APICredit).filter(APICredit.user_id == user_id).first()

            if not credits:
                credits = APICredit(user_id=user_id)
                session.add(credits)

            credits.balance += amount
            credits.lifetime_purchased += amount

    async def use_credits(self, user_id: int, amount: float) -> bool:
        """Use API credits. Returns True if successful."""
        with get_session() as session:
            credits = session.query(APICredit).filter(APICredit.user_id == user_id).first()

            if not credits or credits.balance < amount:
                return False

            credits.balance -= amount
            credits.lifetime_used += amount
            return True

    # =========================================================================
    # Helpers
    # =========================================================================

    def get_tier_info(self, tier: SubscriptionTier) -> Dict[str, Any]:
        """Get information about a subscription tier."""
        return TIER_LIMITS.get(tier, TIER_LIMITS[SubscriptionTier.FREE])

    def get_all_tiers(self) -> Dict[SubscriptionTier, Dict[str, Any]]:
        """Get all tier information."""
        return TIER_LIMITS


# Global instance
x402_service = X402Service()
