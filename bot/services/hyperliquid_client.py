"""HyperLiquid API client for perpetual trading."""

import logging
import time
from typing import Optional
from dataclasses import dataclass

import httpx

from bot.services.hyperliquid_signing import sign_l1_action, sign_approve_builder_fee

logger = logging.getLogger(__name__)

# Hyperliquid requires a builder address to hold at least this much perps account
# value (USDC) before it is permitted to collect builder fees. (This is an account
# *balance* requirement, not a trading-volume one — volume gating applies to the
# separate referral-code program, which needs $10k traded.)
BUILDER_MIN_ACCOUNT_VALUE_USD = 100.0


@dataclass
class HLMarketInfo:
    """HyperLiquid market information."""

    name: str  # e.g., "ETH"
    sz_decimals: int
    max_leverage: int
    mark_price: float
    funding_rate: float


@dataclass
class HLOrderResult:
    """Result of a HyperLiquid order placement."""

    order_id: str
    status: str  # "filled", "open", "cancelled"
    fill_price: Optional[float] = None
    filled_size: Optional[float] = None


class HyperLiquidClient:
    """Client for HyperLiquid perpetuals exchange."""

    BASE_URL = "https://api.hyperliquid.xyz"
    INFO_URL = f"{BASE_URL}/info"
    EXCHANGE_URL = f"{BASE_URL}/exchange"

    # Supported markets
    MARKETS = {
        "ETH-USD": "ETH",
        "BTC-USD": "BTC",
        "SOL-USD": "SOL",
        "ARB-USD": "ARB",
        "AVAX-USD": "AVAX",
        "DOGE-USD": "DOGE",
        "MATIC-USD": "MATIC",
        "OP-USD": "OP",
        "SUI-USD": "SUI",
        "APT-USD": "APT",
    }

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._asset_index_cache: dict[str, int] = {}
        self._asset_index_fetched_at: float = 0.0

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def get_markets(self) -> list[HLMarketInfo]:
        """Get all available markets."""
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={"type": "meta"},
            )

            if response.status_code != 200:
                return []

            data = response.json()
            markets = []
            universe = data.get("universe", [])

            for asset_info in universe:
                name = asset_info.get("name", "")
                markets.append(
                    HLMarketInfo(
                        name=name,
                        sz_decimals=asset_info.get("szDecimals", 2),
                        max_leverage=asset_info.get("maxLeverage", 50),
                        mark_price=0.0,  # Fetched separately
                        funding_rate=0.0,
                    )
                )

            return markets
        except Exception as e:
            logger.error(f"Failed to get HyperLiquid markets: {e}")
            return []

    async def get_mark_price(self, market: str) -> Optional[float]:
        """Get current mark price for a market."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            response = await client.post(
                self.INFO_URL,
                json={"type": "allMids"},
            )

            if response.status_code == 200:
                mids = response.json()
                for mid_info in mids:
                    if isinstance(mid_info, dict) and mid_info.get("coin") == asset:
                        return float(mid_info.get("mid", 0))
                # Try dict format
                if isinstance(mids, dict):
                    return float(mids.get(asset, 0))
            return None
        except Exception as e:
            logger.error(f"Failed to get mark price for {market}: {e}")
            return None

    async def get_account_state(self, address: str) -> Optional[dict]:
        """Get account state including positions and margin."""
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={
                    "type": "clearinghouseState",
                    "user": address,
                },
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "margin_summary": data.get("marginSummary", {}),
                    "positions": data.get("assetPositions", []),
                    "cross_margin_summary": data.get("crossMarginSummary", {}),
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get account state: {e}")
            return None

    async def get_open_positions(self, address: str) -> list[dict]:
        """Get all open positions for an account."""
        state = await self.get_account_state(address)
        if not state:
            return []

        positions = []
        for pos_info in state.get("positions", []):
            position = pos_info.get("position", {})
            if float(position.get("szi", 0)) != 0:
                size = float(position.get("szi", 0))
                positions.append(
                    {
                        "market": position.get("coin", "") + "-USD",
                        "side": "long" if size > 0 else "short",
                        "size": abs(size),
                        "entry_price": float(position.get("entryPx", 0)),
                        "unrealized_pnl": float(position.get("unrealizedPnl", 0)),
                        "liquidation_price": float(position.get("liquidationPx", 0) or 0),
                        "leverage": int(float(position.get("leverage", {}).get("value", 1))),
                        "margin_used": float(position.get("marginUsed", 0)),
                    }
                )

        return positions

    async def place_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        side: str,  # "long" or "short"
        size: float,
        price: Optional[float] = None,
        leverage: int = 1,
        order_type: str = "market",
        reduce_only: bool = False,
        tp_price: Optional[float] = None,
        sl_price: Optional[float] = None,
        builder_address: Optional[str] = None,
        builder_fee_tenths_bps: Optional[int] = None,
    ) -> Optional[HLOrderResult]:
        """Place an order on HyperLiquid.

        If ``builder_address`` and ``builder_fee_tenths_bps`` are provided, a
        builder fee is attached to the order (the user must have previously
        approved the builder via :meth:`approve_builder_fee`). ``builder_fee_tenths_bps``
        is denominated in tenths of a basis point (10 = 1 bp = 0.01%).
        """
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            is_buy = (side == "long" and not reduce_only) or (side == "short" and reduce_only)

            # Build order
            order = {
                "a": await self._resolve_asset_index(asset),  # Asset index
                "b": is_buy,
                "p": str(price) if price else "0",
                "s": str(size),
                "r": reduce_only,
                "t": (
                    {
                        "limit": {"tif": "Gtc"} if order_type == "limit" else {"tif": "Ioc"},
                    }
                    if order_type in ("limit", "market")
                    else {
                        "trigger": {
                            "triggerPx": str(price),
                            "isMarket": True,
                            "tpsl": "tp" if order_type == "take_profit" else "sl",
                        }
                    }
                ),
            }

            # Set leverage
            await self._set_leverage(client, address, api_key, api_secret, asset, leverage)

            # Build and sign the action
            action = {
                "type": "order",
                "orders": [order],
                "grouping": "na",
            }

            # Attach builder fee so Suwappu earns on the order. The builder
            # address must be lowercased to match the approveBuilderFee signature,
            # and the fee must not exceed the user's approved max fee rate.
            if builder_address and builder_fee_tenths_bps and builder_fee_tenths_bps > 0:
                action["builder"] = {
                    "b": builder_address.lower(),
                    "f": int(builder_fee_tenths_bps),
                }

            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )

            if response.status_code == 200:
                data = response.json()
                status_data = data.get("response", {}).get("data", {})
                statuses = status_data.get("statuses", [{}])

                if statuses:
                    order_status = statuses[0]
                    if "resting" in order_status:
                        return HLOrderResult(
                            order_id=str(order_status["resting"]["oid"]),
                            status="open",
                        )
                    elif "filled" in order_status:
                        return HLOrderResult(
                            order_id=str(order_status["filled"]["oid"]),
                            status="filled",
                            fill_price=float(order_status["filled"].get("avgPx", 0)),
                            filled_size=float(order_status["filled"].get("totalSz", 0)),
                        )

                logger.warning(f"Unexpected order response: {data}")
                return None

            logger.error(f"Order placement failed: {response.status_code} {response.text[:200]}")
            return None

        except Exception as e:
            logger.error(f"Failed to place order on HyperLiquid: {e}")
            return None

    async def cancel_order(
        self,
        address: str,
        api_key: str,
        api_secret: str,
        market: str,
        order_id: str,
    ) -> bool:
        """Cancel an open order."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            action = {
                "type": "cancel",
                "cancels": [
                    {
                        "a": await self._resolve_asset_index(asset),
                        "o": int(order_id),
                    }
                ],
            }

            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )

            return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to cancel order: {e}")
            return False

    async def approve_builder_fee(
        self,
        api_secret: str,
        builder_address: str,
        max_fee_rate: str = "0.1%",
    ) -> bool:
        """Approve a builder (and a max fee rate) for the signing user.

        This is a one-time, per-(user, builder) action that authorizes the builder
        to attach fees up to ``max_fee_rate`` to the user's future orders.

        Args:
            api_secret: The user's EVM private key.
            builder_address: Suwappu's builder wallet address.
            max_fee_rate: Max approved fee as a percent string, e.g. ``"0.1%"``.
        """
        try:
            client = await self._get_client()
            nonce = int(time.time() * 1000)
            action, signature = sign_approve_builder_fee(
                api_secret, builder_address, max_fee_rate, nonce, is_mainnet=True
            )

            response = await client.post(
                self.EXCHANGE_URL,
                json={"action": action, "nonce": nonce, "signature": signature},
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    return True
                logger.error(f"approveBuilderFee rejected: {data}")
                return False

            logger.error(f"approveBuilderFee failed: {response.status_code} {response.text[:200]}")
            return False
        except Exception as e:
            logger.error(f"Failed to approve builder fee: {e}")
            return False

    async def get_max_builder_fee(self, user_address: str, builder_address: str) -> int:
        """Return the max builder fee (tenths of a bp) the user has approved for the builder.

        Returns 0 when the user has not approved the builder.
        """
        try:
            client = await self._get_client()
            response = await client.post(
                self.INFO_URL,
                json={
                    "type": "maxBuilderFee",
                    "user": user_address,
                    "builder": builder_address.lower(),
                },
            )
            if response.status_code == 200:
                return int(response.json() or 0)
            return 0
        except Exception as e:
            logger.error(f"Failed to query maxBuilderFee: {e}")
            return 0

    async def get_account_value(self, address: str) -> float:
        """Return an address's perps account value (USDC) from clearinghouseState."""
        state = await self.get_account_state(address)
        if not state:
            return 0.0
        return float(state.get("margin_summary", {}).get("accountValue", 0) or 0)

    async def check_builder_eligibility(self, builder_address: str) -> dict:
        """Check whether the builder wallet meets Hyperliquid's requirement.

        A builder may only collect fees once its wallet holds at least 100 USDC of
        perps account value (and uses the standard account-abstraction mode).
        Returns the current account value, the requirement, and an ``eligible`` flag.
        """
        account_value = await self.get_account_value(builder_address)
        return {
            "builder_address": builder_address,
            "account_value_usd": account_value,
            "required_usd": BUILDER_MIN_ACCOUNT_VALUE_USD,
            "eligible": account_value >= BUILDER_MIN_ACCOUNT_VALUE_USD,
            "remaining_usd": max(0.0, BUILDER_MIN_ACCOUNT_VALUE_USD - account_value),
        }

    async def claim_rewards(self, api_secret: str) -> bool:
        """Claim accrued builder/referral rewards to the signer's spot balance.

        Builder-code fees are collected via the same ``claimRewards`` action as
        referral rewards. Must be signed by the builder wallet's own key. Rewards
        are claimable once they exceed $1.

        Args:
            api_secret: The builder wallet's EVM private key.
        """
        try:
            client = await self._get_client()
            action = {"type": "claimRewards"}
            nonce = int(time.time() * 1000)

            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    return True
                logger.error(f"claimRewards rejected: {data}")
                return False

            logger.error(f"claimRewards failed: {response.status_code} {response.text[:200]}")
            return False
        except Exception as e:
            logger.error(f"Failed to claim rewards: {e}")
            return False

    async def _set_leverage(
        self,
        client: httpx.AsyncClient,
        address: str,
        api_key: str,
        api_secret: str,
        asset: str,
        leverage: int,
    ):
        """Set leverage for an asset."""
        try:
            action = {
                "type": "updateLeverage",
                "asset": await self._resolve_asset_index(asset),
                "isCross": True,
                "leverage": leverage,
            }

            nonce = int(time.time() * 1000)

            await client.post(
                self.EXCHANGE_URL,
                json={
                    "action": action,
                    "nonce": nonce,
                    "signature": self._sign_action(action, nonce, api_secret),
                    "vaultAddress": None,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
        except Exception as e:
            logger.warning(f"Failed to set leverage: {e}")

    # Fallback indices used only if the /info metadata fetch fails. The
    # authoritative mapping is the position of each asset in meta.universe.
    _FALLBACK_ASSET_INDICES = {
        "BTC": 0,
        "ETH": 1,
        "SOL": 2,
        "ARB": 3,
        "AVAX": 4,
        "DOGE": 5,
        "MATIC": 6,
        "OP": 7,
        "SUI": 8,
        "APT": 9,
    }
    ASSET_INDEX_TTL = 3600.0  # seconds

    async def _resolve_asset_index(self, asset: str) -> int:
        """Resolve a HyperLiquid asset index dynamically from /info metadata.

        The index is the asset's position in ``meta.universe`` and can change as
        assets are listed. We cache the mapping with a TTL and fall back to the
        static map only if the fetch fails. An unknown asset raises rather than
        silently defaulting to index 0 (which would target BTC).
        """
        now = time.time()
        if (
            not self._asset_index_cache
            or (now - self._asset_index_fetched_at) > self.ASSET_INDEX_TTL
        ):
            try:
                client = await self._get_client()
                resp = await client.post(self.INFO_URL, json={"type": "meta"})
                if resp.status_code == 200:
                    universe = resp.json().get("universe", [])
                    mapping = {
                        info.get("name"): i for i, info in enumerate(universe) if info.get("name")
                    }
                    if mapping:
                        for name, fallback_idx in self._FALLBACK_ASSET_INDICES.items():
                            if name in mapping and mapping[name] != fallback_idx:
                                logger.warning(
                                    "HyperLiquid asset index drift for %s: dynamic=%s hardcoded=%s",
                                    name,
                                    mapping[name],
                                    fallback_idx,
                                )
                        self._asset_index_cache = mapping
                        self._asset_index_fetched_at = now
            except Exception as e:
                logger.warning("Failed to fetch HyperLiquid asset metadata, using fallback: %s", e)

        if asset in self._asset_index_cache:
            return self._asset_index_cache[asset]
        if asset in self._FALLBACK_ASSET_INDICES:
            logger.warning("Using fallback asset index for %s (metadata unavailable)", asset)
            return self._FALLBACK_ASSET_INDICES[asset]
        raise ValueError(f"Unknown HyperLiquid asset: {asset!r}")

    def _sign_action(self, action: dict, nonce: int, api_secret: str) -> dict:
        """Sign an L1 action for the HyperLiquid exchange API via EIP-712.

        ``api_secret`` is the account's EVM private key. Mainnet is assumed
        (BASE_URL points at api.hyperliquid.xyz) and there is no vault address.
        """
        return sign_l1_action(api_secret, action, None, nonce, is_mainnet=True)

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Global instance
hyperliquid_client = HyperLiquidClient()
