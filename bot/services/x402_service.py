"""x402 Protocol Service for token-gated subscriptions and payments."""

import logging
import hashlib
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

from bot.config.settings import settings
from bot.models.subscription import (
    Subscription, SubscriptionTier, X402Payment, PaymentStatus,
    TokenGate, APICredit
)
from bot.services.wallet import WalletService
from database.db import get_session

logger = logging.getLogger(__name__)

# Beta access passwords (case-insensitive)
BETA_PASSWORDS = {
    "waifu": SubscriptionTier.PREMIUM,      # Full premium access
    "suwappu": SubscriptionTier.PRO,        # Pro access
    "earlybird": SubscriptionTier.PRO,      # Pro access
}


# Subscription tier limits
TIER_LIMITS = {
    SubscriptionTier.FREE: {
        "daily_swaps": 5,
        "daily_api_calls": 100,
        "max_swap_usd": 1000,
        "features": ["basic_swap", "balance", "history"],
        "price_usd": 0,
    },
    SubscriptionTier.PRO: {
        "daily_swaps": 50,
        "daily_api_calls": 1000,
        "max_swap_usd": 50000,
        "features": ["basic_swap", "balance", "history", "alerts", "limit_orders", "dca", "portfolio"],
        "price_usd": 9.99,
    },
    SubscriptionTier.PREMIUM: {
        "daily_swaps": 500,
        "daily_api_calls": 10000,
        "max_swap_usd": 500000,
        "features": ["basic_swap", "balance", "history", "alerts", "limit_orders", "dca", 
                     "portfolio", "tax_export", "priority_execution", "custom_slippage"],
        "price_usd": 29.99,
    },
    SubscriptionTier.ENTERPRISE: {
        "daily_swaps": -1,  # Unlimited
        "daily_api_calls": -1,
        "max_swap_usd": -1,
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
        self.payment_recipient = getattr(settings, 'fee_collector_address', None)
        
        # Supported payment tokens
        self.payment_tokens = {
            "base": {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "ethereum": {
                "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "ETH": "0x0000000000000000000000000000000000000000",
            },
            "polygon": {
                "USDC": "0x2791Bca1f2de4661ED88A53F4661ED88A03E27EECF6fEfD3",
                "MATIC": "0x0000000000000000000000000000000000000000",
            },
        }
    
    # =========================================================================
    # Subscription Management
    # =========================================================================
    
    async def get_subscription(self, user_id: int) -> Subscription:
        """Get or create user subscription."""
        with get_session() as session:
            sub = session.query(Subscription).filter(
                Subscription.user_id == user_id
            ).first()
            
            if not sub:
                sub = Subscription(user_id=user_id, tier=SubscriptionTier.FREE)
                session.add(sub)
                session.flush()
            
            # Reset daily counters if needed
            if sub.last_reset_date.date() < datetime.utcnow().date():
                sub.api_calls_today = 0
                sub.last_reset_date = datetime.utcnow()
            
            return sub
    
    async def get_tier(self, user_id: int) -> SubscriptionTier:
        """Get user's current subscription tier."""
        sub = await self.get_subscription(user_id)
        
        # Check if subscription expired
        if sub.expires_at and sub.expires_at < datetime.utcnow():
            # Check token gate
            if sub.token_address:
                has_tokens = await self._check_token_balance(
                    user_id, sub.token_address, sub.token_chain, sub.min_token_balance
                )
                if has_tokens:
                    return sub.tier
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
            sub = session.query(Subscription).filter(
                Subscription.user_id == user_id
            ).first()
            
            if not sub:
                sub = Subscription(user_id=user_id)
                session.add(sub)
            
            sub.tier = tier
            sub.started_at = datetime.utcnow()
            sub.expires_at = datetime.utcnow() + timedelta(days=duration_days)
            
            logger.info(f"User {user_id} upgraded to {tier.value} for {duration_days} days")
            return sub
    
    async def activate_beta(self, user_id: int, password: str) -> tuple[bool, str, Optional[SubscriptionTier]]:
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
        tier_order = [SubscriptionTier.FREE, SubscriptionTier.PRO, 
                     SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]
        
        if tier_order.index(current_tier) >= tier_order.index(tier):
            return False, f"You already have {current_tier.value.upper()} access!", None
        
        # Grant beta access (lifetime = 365 days)
        await self.upgrade_subscription(user_id, tier, duration_days=365)
        
        logger.info(f"User {user_id} activated beta code '{password_lower}' -> {tier.value}")
        return True, f"🎉 Beta access activated! You now have **{tier.value.upper()}** for 1 year!", tier
    
    async def set_token_gate(
        self,
        user_id: int,
        token_address: str,
        chain: str,
        min_balance: float,
        tier: SubscriptionTier,
    ) -> Subscription:
        """Set token-gated subscription for user."""
        with get_session() as session:
            sub = session.query(Subscription).filter(
                Subscription.user_id == user_id
            ).first()
            
            if not sub:
                sub = Subscription(user_id=user_id)
                session.add(sub)
            
            sub.tier = tier
            sub.token_address = token_address
            sub.token_chain = chain
            sub.min_token_balance = min_balance
            sub.expires_at = None  # Token-gated = no expiry
            
            logger.info(f"User {user_id} set token gate: {min_balance} tokens on {chain}")
            return sub
    
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
        
        # Check daily swap count
        daily_limit = limits["daily_swaps"]
        if daily_limit != -1 and sub.api_calls_today >= daily_limit:
            return False, f"Daily swap limit reached ({daily_limit}). Upgrade to increase limits."
        
        # Check max swap amount
        max_amount = limits["max_swap_usd"]
        if max_amount != -1 and amount_usd > max_amount:
            return False, f"Swap amount exceeds limit (${max_amount:,.0f}). Upgrade for higher limits."
        
        return True, "OK"
    
    async def record_api_call(self, user_id: int) -> None:
        """Record an API call for rate limiting."""
        with get_session() as session:
            sub = session.query(Subscription).filter(
                Subscription.user_id == user_id
            ).first()
            
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
    
    async def verify_payment(
        self,
        payment_id: str,
        tx_hash: str,
    ) -> tuple[bool, str]:
        """Verify an x402 payment transaction."""
        with get_session() as session:
            payment = session.query(X402Payment).filter(
                X402Payment.payment_id == payment_id
            ).first()
            
            if not payment:
                return False, "Payment not found"
            
            if payment.status == PaymentStatus.COMPLETED:
                return True, "Already completed"
            
            # Verify on-chain (simplified - in production would check actual tx)
            # For now, we trust the tx_hash provided
            try:
                # TODO: Verify transaction on-chain
                # - Check tx exists
                # - Check recipient matches
                # - Check amount matches
                # - Check token matches
                
                payment.tx_hash = tx_hash
                payment.status = PaymentStatus.COMPLETED
                payment.completed_at = datetime.utcnow()
                
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
    # Token Gate Management
    # =========================================================================
    
    async def create_token_gate(
        self,
        name: str,
        token_address: str,
        token_symbol: str,
        chain: str,
        min_balance: float,
        feature: str,
        tier_granted: SubscriptionTier = SubscriptionTier.PRO,
    ) -> TokenGate:
        """Create a new token gate."""
        with get_session() as session:
            gate = TokenGate(
                name=name,
                token_address=token_address,
                token_symbol=token_symbol,
                chain=chain,
                min_balance=min_balance,
                feature=feature,
                tier_granted=tier_granted,
            )
            session.add(gate)
            session.flush()
            return gate
    
    async def check_token_gates(self, user_id: int) -> List[TokenGate]:
        """Check which token gates user qualifies for."""
        with get_session() as session:
            gates = session.query(TokenGate).filter(TokenGate.is_active == True).all()
            
            qualified = []
            for gate in gates:
                has_tokens = await self._check_token_balance(
                    user_id, gate.token_address, gate.chain, gate.min_balance
                )
                if has_tokens:
                    qualified.append(gate)
            
            return qualified
    
    async def _check_token_balance(
        self,
        user_id: int,
        token_address: str,
        chain: str,
        min_balance: float,
    ) -> bool:
        """Check if user holds required tokens."""
        from bot.models.user import Wallet
        
        with get_session() as session:
            wallets = session.query(Wallet).filter(
                Wallet.user_id == user_id,
                Wallet.is_active == True,
            ).all()
            
            for wallet in wallets:
                try:
                    if token_address == "0x0000000000000000000000000000000000000000":
                        # Native token
                        balance = await self.wallet_service.get_evm_native_balance(
                            chain, wallet.address
                        )
                    else:
                        balance = await self.wallet_service.get_evm_token_balance(
                            chain, token_address, wallet.address
                        )
                    
                    if balance >= min_balance:
                        return True
                except Exception as e:
                    logger.debug(f"Error checking balance: {e}")
                    continue
            
            return False
    
    # =========================================================================
    # API Credits
    # =========================================================================
    
    async def get_credits(self, user_id: int) -> float:
        """Get user's API credit balance."""
        with get_session() as session:
            credits = session.query(APICredit).filter(
                APICredit.user_id == user_id
            ).first()
            
            return credits.balance if credits else 0
    
    async def _add_api_credits(self, user_id: int, amount: float) -> None:
        """Add API credits to user account."""
        with get_session() as session:
            credits = session.query(APICredit).filter(
                APICredit.user_id == user_id
            ).first()
            
            if not credits:
                credits = APICredit(user_id=user_id)
                session.add(credits)
            
            credits.balance += amount
            credits.lifetime_purchased += amount
    
    async def use_credits(self, user_id: int, amount: float) -> bool:
        """Use API credits. Returns True if successful."""
        with get_session() as session:
            credits = session.query(APICredit).filter(
                APICredit.user_id == user_id
            ).first()
            
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

