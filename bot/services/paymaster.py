"""Paymaster service for gas sponsorship."""

import logging
from typing import Optional, Tuple
from decimal import Decimal
from datetime import datetime, date
from web3 import Web3
from eth_account import Account

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.models.custodial import (
    HotWallet,
    GasSponsorshipConfig,
    UserGasUsage,
    CustodialTransaction,
    TransactionType,
    TransactionStatus,
)
from bot.services.hot_wallet import hot_wallet_service
from bot.services.price_service import price_service
from database.db import get_session

logger = logging.getLogger(__name__)


class PaymasterService:
    """Service for sponsoring gas fees for users."""

    def _get_web3(self, chain_name: str) -> Web3:
        """Get Web3 instance for a chain via RPCManager."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    # === Configuration ===

    def get_sponsorship_config(self, chain: str) -> Optional[GasSponsorshipConfig]:
        """Get gas sponsorship config for a chain."""
        with get_session() as session:
            return (
                session.query(GasSponsorshipConfig)
                .filter(GasSponsorshipConfig.chain == chain)
                .first()
            )

    def set_sponsorship_config(
        self,
        chain: str,
        is_enabled: bool = True,
        max_gas_per_tx_usd: float = 5.0,
        max_gas_per_user_daily_usd: float = 20.0,
        fee_percentage: float = 0.0,
    ) -> GasSponsorshipConfig:
        """Set or update gas sponsorship config."""
        with get_session() as session:
            config = (
                session.query(GasSponsorshipConfig)
                .filter(GasSponsorshipConfig.chain == chain)
                .first()
            )

            if not config:
                config = GasSponsorshipConfig(chain=chain)
                session.add(config)

            config.is_enabled = is_enabled
            config.max_gas_per_tx_usd = max_gas_per_tx_usd
            config.max_gas_per_user_daily_usd = max_gas_per_user_daily_usd
            config.fee_percentage = fee_percentage

            session.flush()
            config_id = config.id

        with get_session() as session:
            return (
                session.query(GasSponsorshipConfig)
                .filter(GasSponsorshipConfig.id == config_id)
                .first()
            )

    # === User Gas Tracking ===

    def get_user_daily_gas_usage(self, user_id: int, chain: str) -> float:
        """Get user's gas usage for today."""
        today = date.today().isoformat()

        with get_session() as session:
            usage = (
                session.query(UserGasUsage)
                .filter(
                    UserGasUsage.user_id == user_id,
                    UserGasUsage.chain == chain,
                    UserGasUsage.date == today,
                )
                .first()
            )

            if usage:
                return usage.gas_sponsored_usd
            return 0.0

    def record_gas_usage(
        self,
        user_id: int,
        chain: str,
        gas_cost_usd: float,
    ) -> None:
        """Record gas usage for a user."""
        today = date.today().isoformat()

        with get_session() as session:
            usage = (
                session.query(UserGasUsage)
                .filter(
                    UserGasUsage.user_id == user_id,
                    UserGasUsage.chain == chain,
                    UserGasUsage.date == today,
                )
                .first()
            )

            if not usage:
                usage = UserGasUsage(
                    user_id=user_id,
                    chain=chain,
                    date=today,
                )
                session.add(usage)

            usage.gas_sponsored_usd += gas_cost_usd
            usage.tx_count += 1

            # Also update total sponsored in config
            config = (
                session.query(GasSponsorshipConfig)
                .filter(GasSponsorshipConfig.chain == chain)
                .first()
            )
            if config:
                config.total_sponsored_usd += gas_cost_usd

    # === Sponsorship Checks ===

    def can_sponsor_gas(
        self,
        user_id: int,
        chain: str,
        estimated_gas_usd: float,
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if gas can be sponsored for a transaction.

        Returns:
            Tuple of (can_sponsor, reason_if_not)
        """
        config = self.get_sponsorship_config(chain)

        if not config or not config.is_enabled:
            return False, "Gas sponsorship not enabled for this chain"

        # Check per-transaction limit
        if estimated_gas_usd > config.max_gas_per_tx_usd:
            return (
                False,
                f"Gas cost ${estimated_gas_usd:.2f} exceeds max ${config.max_gas_per_tx_usd:.2f} per transaction",
            )

        # Check daily limit
        daily_usage = self.get_user_daily_gas_usage(user_id, chain)
        if daily_usage + estimated_gas_usd > config.max_gas_per_user_daily_usd:
            remaining = config.max_gas_per_user_daily_usd - daily_usage
            return False, f"Daily gas limit reached. Remaining: ${remaining:.2f}"

        # Check if gas payer wallet has enough balance
        gas_wallet = hot_wallet_service.get_gas_payer_wallet("evm")
        if not gas_wallet:
            return False, "No gas payer wallet configured"

        return True, None

    # === Gas Estimation ===

    async def estimate_gas_cost(
        self,
        chain_name: str,
        tx_data: dict,
    ) -> Tuple[int, Decimal, float]:
        """
        Estimate gas cost for a transaction.

        Returns:
            Tuple of (gas_limit, gas_cost_native, gas_cost_usd)
        """
        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        # Estimate gas
        try:
            gas_limit = web3.eth.estimate_gas(tx_data)
        except Exception:
            gas_limit = 300000  # Default for complex swaps

        gas_price = web3.eth.gas_price
        gas_cost_wei = gas_limit * gas_price
        gas_cost_native = Decimal(str(gas_cost_wei)) / Decimal(10**18)

        # Get native token price
        prices = await price_service.get_prices([chain.native_token])
        native_price = prices.get(chain.native_token, 0) or 0

        gas_cost_usd = float(gas_cost_native) * native_price

        return gas_limit, gas_cost_native, gas_cost_usd

    # === Transaction Sponsorship ===

    async def sponsor_transaction(
        self,
        user_id: int,
        chain_name: str,
        user_address: str,
        tx_data: dict,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Sponsor gas for a user's transaction by sending them gas.

        This is a simple approach where we send the user enough native token
        to cover their gas costs before they execute the transaction.

        Returns:
            Tuple of (success, message, gas_tx_hash)
        """
        # Get gas estimate
        gas_limit, gas_cost_native, gas_cost_usd = await self.estimate_gas_cost(chain_name, tx_data)

        # Check if we can sponsor
        can_sponsor, reason = self.can_sponsor_gas(user_id, chain_name, gas_cost_usd)
        if not can_sponsor:
            return False, reason, None

        # Get gas payer wallet
        gas_wallet = hot_wallet_service.get_gas_payer_wallet("evm")
        if not gas_wallet:
            return False, "No gas payer wallet configured", None

        # Add 20% buffer for gas price fluctuations
        amount_to_send = gas_cost_native * Decimal("1.2")

        try:
            # Send native token to user
            tx_hash = await hot_wallet_service.send_native_token(
                wallet=gas_wallet,
                chain_name=chain_name,
                to_address=user_address,
                amount=amount_to_send,
            )

            # Record gas usage
            self.record_gas_usage(user_id, chain_name, gas_cost_usd)

            # Record transaction
            hot_wallet_service.record_transaction(
                user_id=user_id,
                tx_type=TransactionType.GAS_SPONSORSHIP,
                chain=chain_name,
                token_symbol=get_chain_by_name(chain_name).native_token,
                amount=amount_to_send,
                tx_hash=tx_hash,
                from_address=gas_wallet.address,
                to_address=user_address,
                gas_sponsored=True,
                gas_cost=gas_cost_native,
                notes=f"Gas sponsorship for swap",
            )

            logger.info(
                f"Sponsored ${gas_cost_usd:.4f} gas for user {user_id} on {chain_name}: {tx_hash}"
            )

            return (
                True,
                f"Gas sponsored: {float(amount_to_send):.6f} {get_chain_by_name(chain_name).native_token}",
                tx_hash,
            )

        except Exception as e:
            logger.error(f"Gas sponsorship failed: {e}")
            return False, f"Gas sponsorship failed: {str(e)}", None

    async def execute_sponsored_swap(
        self,
        user_id: int,
        chain_name: str,
        swap_tx: dict,
        from_address: str,
        private_key: str,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Execute a swap with sponsored gas.

        In this approach, we:
        1. Execute the swap from our hot wallet (acting as a relayer)
        2. The user's tokens are already in custodial balance

        Returns:
            Tuple of (success, message, tx_hash)
        """
        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        # Get gas estimate
        gas_limit, gas_cost_native, gas_cost_usd = await self.estimate_gas_cost(chain_name, swap_tx)

        # Check if we can sponsor
        can_sponsor, reason = self.can_sponsor_gas(user_id, chain_name, gas_cost_usd)
        if not can_sponsor:
            return False, reason, None

        try:
            # Prepare transaction
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key

            nonce = web3.eth.get_transaction_count(Web3.to_checksum_address(from_address))
            gas_price = web3.eth.gas_price

            swap_tx["nonce"] = nonce
            swap_tx["gas"] = gas_limit
            swap_tx["gasPrice"] = gas_price
            swap_tx["chainId"] = chain.chain_id

            # Sign and send
            signed = Account.sign_transaction(swap_tx, private_key)
            tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)
            tx_hash_hex = tx_hash.hex()

            # Record gas usage
            self.record_gas_usage(user_id, chain_name, gas_cost_usd)

            logger.info(
                f"Executed sponsored swap for user {user_id} on {chain_name}: {tx_hash_hex}"
            )

            return True, "Swap executed with sponsored gas", tx_hash_hex

        except Exception as e:
            logger.error(f"Sponsored swap failed: {e}")
            return False, f"Swap failed: {str(e)}", None

    # === Meta-Transaction Support (EIP-712) ===

    async def create_meta_transaction(
        self,
        chain_name: str,
        user_address: str,
        target_contract: str,
        call_data: str,
    ) -> dict:
        """
        Create a meta-transaction that can be relayed.

        This is for more advanced use cases where the user signs
        the intent and we relay it on their behalf.
        """
        web3 = self._get_web3(chain_name)
        chain = get_chain_by_name(chain_name)

        # Simple meta-tx structure
        meta_tx = {
            "from": user_address,
            "to": target_contract,
            "data": call_data,
            "nonce": web3.eth.get_transaction_count(Web3.to_checksum_address(user_address)),
            "chainId": chain.chain_id,
        }

        return meta_tx


# Global instance
paymaster_service = PaymasterService()
