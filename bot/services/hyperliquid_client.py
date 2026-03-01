"""HyperLiquid API client for perpetual trading."""

import logging
import json
import time
import hashlib
from typing import Optional
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


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
                markets.append(HLMarketInfo(
                    name=name,
                    sz_decimals=asset_info.get("szDecimals", 2),
                    max_leverage=asset_info.get("maxLeverage", 50),
                    mark_price=0.0,  # Fetched separately
                    funding_rate=0.0,
                ))

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
                positions.append({
                    "market": position.get("coin", "") + "-USD",
                    "side": "long" if size > 0 else "short",
                    "size": abs(size),
                    "entry_price": float(position.get("entryPx", 0)),
                    "unrealized_pnl": float(position.get("unrealizedPnl", 0)),
                    "liquidation_price": float(position.get("liquidationPx", 0) or 0),
                    "leverage": int(float(position.get("leverage", {}).get("value", 1))),
                    "margin_used": float(position.get("marginUsed", 0)),
                })

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
    ) -> Optional[HLOrderResult]:
        """Place an order on HyperLiquid."""
        try:
            asset = self.MARKETS.get(market, market.split("-")[0])
            client = await self._get_client()

            is_buy = (side == "long" and not reduce_only) or (side == "short" and reduce_only)

            # Build order
            order = {
                "a": self._get_asset_index(asset),  # Asset index
                "b": is_buy,
                "p": str(price) if price else "0",
                "s": str(size),
                "r": reduce_only,
                "t": {
                    "limit": {"tif": "Gtc"} if order_type == "limit" else {"tif": "Ioc"},
                } if order_type in ("limit", "market") else {"trigger": {"triggerPx": str(price), "isMarket": True, "tpsl": "tp" if order_type == "take_profit" else "sl"}},
            }

            # Set leverage
            await self._set_leverage(client, address, api_key, api_secret, asset, leverage)

            # Build and sign the action
            action = {
                "type": "order",
                "orders": [order],
                "grouping": "na",
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
                "cancels": [{
                    "a": self._get_asset_index(asset),
                    "o": int(order_id),
                }],
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
                "asset": self._get_asset_index(asset),
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

    def _get_asset_index(self, asset: str) -> int:
        """Get the numeric asset index for HyperLiquid."""
        # HyperLiquid assigns sequential indices to assets
        # This is a simplified mapping — in production, fetch from /info endpoint
        asset_indices = {
            "BTC": 0, "ETH": 1, "SOL": 2, "ARB": 3, "AVAX": 4,
            "DOGE": 5, "MATIC": 6, "OP": 7, "SUI": 8, "APT": 9,
        }
        return asset_indices.get(asset, 0)

    def _sign_action(self, action: dict, nonce: int, api_secret: str) -> dict:
        """Sign an action for HyperLiquid API."""
        # Simplified signing — actual implementation uses EIP-712 typed data signing
        message = json.dumps(action, sort_keys=True) + str(nonce)
        signature = hashlib.sha256((message + api_secret).encode()).hexdigest()
        return {"r": "0x" + signature[:64], "s": "0x" + signature[64:], "v": 27}

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Global instance
hyperliquid_client = HyperLiquidClient()
