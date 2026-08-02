"""Turnkey policy engine orchestration.

Manages infrastructure-level spending limits and address whitelist
policies for Turnkey wallets. Policies are enforced at Turnkey's
enclave level -- signing requests that violate policies are rejected
before the key is ever used.
"""

import logging
from typing import Optional, List
from dataclasses import dataclass

from bot.models.user import Wallet
from database.db import get_session

logger = logging.getLogger(__name__)


@dataclass
class PolicyInfo:
    """Represents a Turnkey policy with local metadata."""

    policy_id: str
    policy_name: str
    policy_type: str  # "spending_limit" or "address_whitelist"
    wallet_address: str
    # Spending limit fields
    limit_amount_usd: Optional[float] = None
    time_window_seconds: Optional[int] = None
    # Whitelist fields
    allowed_addresses: Optional[List[str]] = None


class TurnkeyPolicyService:
    """
    Orchestrates Turnkey policy CRUD and maps user-facing concepts
    (USD limits, daily/hourly windows) to Turnkey policy conditions.
    """

    # Approximate ETH price for wei conversion (updated at runtime)
    _eth_price_usd: float = 3000.0

    def _usd_to_wei(self, usd: float) -> str:
        """Convert USD amount to approximate wei string."""
        eth = usd / self._eth_price_usd
        wei = int(eth * 10**18)
        return str(wei)

    async def update_eth_price(self) -> None:
        """Refresh cached ETH price from chain config."""
        try:
            from bot.services.price_service import price_service

            price = await price_service.get_price("ETH")
            if price and price > 0:
                self._eth_price_usd = price
        except Exception as e:
            logger.warning(f"Failed to update ETH price for policy engine: {e}")

    async def set_spending_limit(
        self,
        wallet: Wallet,
        limit_usd: float,
        window: str = "daily",
    ) -> Optional[str]:
        """
        Set a spending limit policy on a Turnkey wallet.

        Replaces any existing spending limit policy of the same window
        on this wallet.

        Args:
            wallet: Turnkey Wallet object
            limit_usd: Maximum spend in USD for the window
            window: "hourly" or "daily"

        Returns:
            Policy ID, or None on failure
        """
        if not wallet.is_turnkey_wallet:
            logger.warning("set_spending_limit called on non-Turnkey wallet")
            return None

        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        await self.update_eth_price()

        window_seconds = 3600 if window == "hourly" else 86400
        limit_wei = self._usd_to_wei(limit_usd)
        policy_name = f"spending_limit_{window}_{wallet.address[:10]}"

        # Remove existing policy of same type if any
        await self._remove_policies_by_prefix(
            prefix=f"spending_limit_{window}_{wallet.address[:10]}",
            organization_id=wallet.turnkey_sub_org_id,
        )

        try:
            policy_id = await client.create_spending_limit_policy(
                wallet_address=wallet.address,
                limit_amount_wei=limit_wei,
                time_window_seconds=window_seconds,
                policy_name=policy_name,
                organization_id=wallet.turnkey_sub_org_id,
            )
            logger.info(
                f"Created {window} spending limit policy {policy_id} "
                f"for wallet {wallet.address}: ${limit_usd}"
            )
            return policy_id
        except Exception as e:
            logger.error(f"Failed to create spending limit policy: {e}")
            return None

    async def set_address_whitelist(
        self,
        wallet: Wallet,
        allowed_addresses: List[str],
    ) -> Optional[str]:
        """
        Set an address whitelist policy on a Turnkey wallet.

        Only transactions to addresses in the whitelist will be signed.
        Replaces any existing whitelist policy on this wallet.

        Args:
            wallet: Turnkey Wallet object
            allowed_addresses: List of allowed destination addresses

        Returns:
            Policy ID, or None on failure
        """
        if not wallet.is_turnkey_wallet:
            logger.warning("set_address_whitelist called on non-Turnkey wallet")
            return None

        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        policy_name = f"whitelist_{wallet.address[:10]}"

        # Remove existing whitelist policy
        await self._remove_policies_by_prefix(
            prefix=f"whitelist_{wallet.address[:10]}",
            organization_id=wallet.turnkey_sub_org_id,
        )

        try:
            policy_id = await client.create_address_whitelist_policy(
                wallet_address=wallet.address,
                allowed_addresses=allowed_addresses,
                policy_name=policy_name,
                organization_id=wallet.turnkey_sub_org_id,
            )
            logger.info(
                f"Created whitelist policy {policy_id} "
                f"for wallet {wallet.address}: {len(allowed_addresses)} addresses"
            )
            return policy_id
        except Exception as e:
            logger.error(f"Failed to create whitelist policy: {e}")
            return None

    async def remove_spending_limit(
        self,
        wallet: Wallet,
        window: str = "daily",
    ) -> bool:
        """Remove a spending limit policy from a wallet."""
        prefix = f"spending_limit_{window}_{wallet.address[:10]}"
        return await self._remove_policies_by_prefix(
            prefix=prefix,
            organization_id=wallet.turnkey_sub_org_id,
        )

    async def remove_address_whitelist(self, wallet: Wallet) -> bool:
        """Remove the address whitelist policy from a wallet."""
        prefix = f"whitelist_{wallet.address[:10]}"
        return await self._remove_policies_by_prefix(
            prefix=prefix,
            organization_id=wallet.turnkey_sub_org_id,
        )

    async def get_wallet_policies(self, wallet: Wallet) -> List[PolicyInfo]:
        """
        Get all policies for a specific wallet.

        Returns:
            List of PolicyInfo objects
        """
        if not wallet.is_turnkey_wallet:
            return []

        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        try:
            all_policies = await client.list_policies(
                organization_id=wallet.turnkey_sub_org_id,
            )
        except Exception as e:
            logger.error(f"Failed to list policies: {e}")
            return []

        wallet_prefix_short = wallet.address[:10]
        results = []

        for policy in all_policies:
            name = policy.get("policyName", "")
            policy_id = policy.get("policyId", "")

            if wallet_prefix_short not in name:
                continue

            if name.startswith("spending_limit_hourly_"):
                results.append(
                    PolicyInfo(
                        policy_id=policy_id,
                        policy_name=name,
                        policy_type="spending_limit",
                        wallet_address=wallet.address,
                        time_window_seconds=3600,
                    )
                )
            elif name.startswith("spending_limit_daily_"):
                results.append(
                    PolicyInfo(
                        policy_id=policy_id,
                        policy_name=name,
                        policy_type="spending_limit",
                        wallet_address=wallet.address,
                        time_window_seconds=86400,
                    )
                )
            elif name.startswith("whitelist_"):
                results.append(
                    PolicyInfo(
                        policy_id=policy_id,
                        policy_name=name,
                        policy_type="address_whitelist",
                        wallet_address=wallet.address,
                    )
                )

        return results

    async def _remove_policies_by_prefix(
        self,
        prefix: str,
        organization_id: Optional[str] = None,
    ) -> bool:
        """Remove all policies whose name starts with prefix."""
        from bot.services.turnkey_client import get_turnkey_client

        client = get_turnkey_client()

        try:
            all_policies = await client.list_policies(
                organization_id=organization_id,
            )
        except Exception as e:
            logger.error(f"Failed to list policies for removal: {e}")
            return False

        removed = False
        for policy in all_policies:
            if policy.get("policyName", "").startswith(prefix):
                try:
                    await client.delete_policy(
                        policy_id=policy["policyId"],
                        organization_id=organization_id,
                    )
                    logger.info(f"Deleted policy {policy['policyId']} ({policy['policyName']})")
                    removed = True
                except Exception as e:
                    logger.error(f"Failed to delete policy {policy['policyId']}: {e}")

        return removed

    async def sync_app_limits_to_turnkey(
        self,
        user_id: int,
    ) -> None:
        """
        Sync the user's app-level spending limits to Turnkey policies
        for all their Turnkey wallets.

        Reads per_swap_limit_usd and daily_limit_usd from UserSettings
        and creates corresponding Turnkey policies.
        """
        from bot.models.favorites import UserSettings

        with get_session() as session:
            user_settings = (
                session.query(UserSettings).filter(UserSettings.user_id == user_id).first()
            )
            if not user_settings:
                return

            per_swap = user_settings.per_swap_limit_usd
            daily = user_settings.daily_limit_usd

            wallets = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user_id,
                    Wallet.wallet_provider == "turnkey",
                    Wallet.is_active == True,
                )
                .all()
            )

        for wallet in wallets:
            # Set daily limit
            if daily and daily > 0:
                await self.set_spending_limit(wallet, daily, "daily")

            # Per-swap limit is enforced at app level since Turnkey
            # doesn't natively support per-transaction limits separate
            # from cumulative windows. We keep the app-level check.


# Global instance
turnkey_policy_service = TurnkeyPolicyService()
