"""HyperLiquid API client for perpetual trading."""

import logging
import time
from typing import Optional
from dataclasses import dataclass
from decimal import Decimal

import httpx
from eth_account import Account
from eth_account.messages import encode_structured_data
from eth_utils import keccak

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
    ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
    ASSET_CACHE_TTL_SECONDS = 3600

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
    FALLBACK_ASSET_INDICES = {
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

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._asset_indices_cache: dict[str, int] = {}
        self._asset_indices_cache_ts = 0.0

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
            asset_index = await self._get_asset_index(asset)

            # Build order
            order = {
                "a": asset_index,
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
            asset_index = await self._get_asset_index(asset)

            action = {
                "type": "cancel",
                "cancels": [{
                    "a": asset_index,
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
                "asset": await self._get_asset_index(asset),
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

    async def _get_asset_index(self, asset: str) -> int:
        """Get the numeric asset index for HyperLiquid with a TTL cache."""
        normalized = asset.upper()
        now = time.time()

        if self._asset_indices_cache and now - self._asset_indices_cache_ts < self.ASSET_CACHE_TTL_SECONDS:
            return self._asset_indices_cache.get(normalized, self.FALLBACK_ASSET_INDICES.get(normalized, 0))

        dynamic_indices = await self._fetch_asset_indices()
        if dynamic_indices:
            self._asset_indices_cache = dynamic_indices
            self._asset_indices_cache_ts = now

            for symbol, fallback_index in self.FALLBACK_ASSET_INDICES.items():
                dynamic_index = dynamic_indices.get(symbol)
                if dynamic_index is not None and dynamic_index != fallback_index:
                    logger.warning(
                        "HyperLiquid asset index drift detected for %s: fallback=%s dynamic=%s",
                        symbol,
                        fallback_index,
                        dynamic_index,
                    )

            return dynamic_indices.get(normalized, self.FALLBACK_ASSET_INDICES.get(normalized, 0))

        return self.FALLBACK_ASSET_INDICES.get(normalized, 0)

    async def _fetch_asset_indices(self) -> dict[str, int]:
        """Fetch asset metadata from HyperLiquid and derive current indices."""
        try:
            client = await self._get_client()
            response = await client.post(self.INFO_URL, json={"type": "meta"})
            if response.status_code != 200:
                logger.warning("Failed to fetch HyperLiquid meta for asset indices: %s", response.status_code)
                return {}

            data = response.json()
            universe = data.get("universe", [])
            return {
                asset_info.get("name", "").upper(): idx
                for idx, asset_info in enumerate(universe)
                if asset_info.get("name")
            }
        except Exception as e:
            logger.warning(f"Failed to refresh HyperLiquid asset indices: {e}")
            return {}

    def _sign_action(self, action: dict, nonce: int, api_secret: str) -> dict:
        """Sign an action for HyperLiquid API using the official EIP-712 flow."""
        account = Account.from_key(api_secret)
        payload = {
            "domain": {
                "chainId": 1337,
                "name": "Exchange",
                "verifyingContract": self.ZERO_ADDRESS,
                "version": "1",
            },
            "types": {
                "Agent": [
                    {"name": "source", "type": "string"},
                    {"name": "connectionId", "type": "bytes32"},
                ],
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
            },
            "primaryType": "Agent",
            "message": {
                "source": "a" if self._is_mainnet() else "b",
                "connectionId": self._action_hash(action, nonce),
            },
        }
        signable = encode_structured_data(payload)
        signed = account.sign_message(signable)
        return {"r": hex(signed.r), "s": hex(signed.s), "v": signed.v}

    def _action_hash(self, action: dict, nonce: int, vault_address: Optional[str] = None, expires_after: Optional[int] = None) -> bytes:
        """Hash an action exactly as HyperLiquid expects before EIP-712 signing."""
        data = self._msgpack_pack(action)
        data += int(nonce).to_bytes(8, "big")
        if vault_address is None:
            data += b"\x00"
        else:
            data += b"\x01" + self._address_to_bytes(vault_address)
        if expires_after is not None:
            data += b"\x00" + int(expires_after).to_bytes(8, "big")
        return keccak(data)

    def _is_mainnet(self) -> bool:
        """Return whether the client is configured for mainnet semantics."""
        return "api.hyperliquid.xyz" in self.BASE_URL and "testnet" not in self.BASE_URL

    def _address_to_bytes(self, address: str) -> bytes:
        """Convert a hex address string to raw bytes."""
        normalized = address[2:] if address.startswith("0x") else address
        return bytes.fromhex(normalized.lower())

    def _msgpack_pack(self, value) -> bytes:
        """Pack a minimal deterministic MessagePack subset for HyperLiquid actions."""
        if value is None:
            return b"\xc0"
        if value is False:
            return b"\xc2"
        if value is True:
            return b"\xc3"
        if isinstance(value, int):
            return self._pack_int(value)
        if isinstance(value, float):
            raise TypeError("HyperLiquid action hashing expects normalized strings instead of floats")
        if isinstance(value, Decimal):
            return self._pack_str(self._normalize_decimal(value))
        if isinstance(value, str):
            return self._pack_str(value)
        if isinstance(value, bytes):
            return self._pack_bytes(value)
        if isinstance(value, list):
            return self._pack_array(value)
        if isinstance(value, dict):
            return self._pack_map(value)
        raise TypeError(f"Unsupported type for HyperLiquid msgpack encoding: {type(value)!r}")

    def _pack_int(self, value: int) -> bytes:
        if 0 <= value <= 0x7F:
            return bytes([value])
        if -32 <= value < 0:
            return (256 + value).to_bytes(1, "big")
        if 0 <= value <= 0xFF:
            return b"\xcc" + value.to_bytes(1, "big")
        if 0 <= value <= 0xFFFF:
            return b"\xcd" + value.to_bytes(2, "big")
        if 0 <= value <= 0xFFFFFFFF:
            return b"\xce" + value.to_bytes(4, "big")
        if 0 <= value <= 0xFFFFFFFFFFFFFFFF:
            return b"\xcf" + value.to_bytes(8, "big")
        if -128 <= value < 0:
            return b"\xd0" + value.to_bytes(1, "big", signed=True)
        if -32768 <= value < -128:
            return b"\xd1" + value.to_bytes(2, "big", signed=True)
        if -2147483648 <= value < -32768:
            return b"\xd2" + value.to_bytes(4, "big", signed=True)
        return b"\xd3" + value.to_bytes(8, "big", signed=True)

    def _pack_str(self, value: str) -> bytes:
        data = value.encode("utf-8")
        length = len(data)
        if length <= 31:
            return bytes([0xA0 | length]) + data
        if length <= 0xFF:
            return b"\xd9" + length.to_bytes(1, "big") + data
        if length <= 0xFFFF:
            return b"\xda" + length.to_bytes(2, "big") + data
        return b"\xdb" + length.to_bytes(4, "big") + data

    def _pack_bytes(self, value: bytes) -> bytes:
        length = len(value)
        if length <= 0xFF:
            return b"\xc4" + length.to_bytes(1, "big") + value
        if length <= 0xFFFF:
            return b"\xc5" + length.to_bytes(2, "big") + value
        return b"\xc6" + length.to_bytes(4, "big") + value

    def _pack_array(self, value: list) -> bytes:
        length = len(value)
        if length <= 15:
            prefix = bytes([0x90 | length])
        elif length <= 0xFFFF:
            prefix = b"\xdc" + length.to_bytes(2, "big")
        else:
            prefix = b"\xdd" + length.to_bytes(4, "big")
        return prefix + b"".join(self._msgpack_pack(item) for item in value)

    def _pack_map(self, value: dict) -> bytes:
        length = len(value)
        if length <= 15:
            prefix = bytes([0x80 | length])
        elif length <= 0xFFFF:
            prefix = b"\xde" + length.to_bytes(2, "big")
        else:
            prefix = b"\xdf" + length.to_bytes(4, "big")
        encoded = []
        for key, item in value.items():
            encoded.append(self._msgpack_pack(key))
            encoded.append(self._msgpack_pack(item))
        return prefix + b"".join(encoded)

    def _normalize_decimal(self, value: Decimal) -> str:
        """Normalize decimal text for consistent wire encoding."""
        return f"{value.normalize():f}"

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Global instance
hyperliquid_client = HyperLiquidClient()
