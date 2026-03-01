"""Sui blockchain swap service using Aftermath or Cetus DEX aggregator."""

import logging
import json
from typing import Optional
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class SuiQuote:
    """Quote from Sui DEX aggregator."""
    from_token: str  # Coin type (e.g., "0x2::sui::SUI")
    to_token: str
    amount_in: int
    expected_amount_out: int
    minimum_amount_out: int
    price_impact: float
    route: dict
    provider: str


class SuiSwapService:
    """Swap service for Sui blockchain using DEX aggregators."""

    BASE_URL = "https://aftermath.finance/api"  # Aftermath Finance API
    CETUS_URL = "https://api-sui.cetus.zone/v2"  # Cetus DEX API (backup)

    SUI_COIN_TYPE = "0x2::sui::SUI"
    USDC_COIN_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def get_quote(
        self,
        from_token: str,
        to_token: str,
        amount: int,
        slippage_bps: int = 50,
    ) -> Optional[SuiQuote]:
        """Get swap quote from Sui DEX aggregator."""
        try:
            client = await self._get_client()

            # Try Aftermath Finance first
            response = await client.post(
                f"{self.BASE_URL}/router/quote",
                json={
                    "coinInType": from_token,
                    "coinOutType": to_token,
                    "coinInAmount": str(amount),
                    "slippageTolerance": slippage_bps / 10000,
                },
            )

            if response.status_code == 200:
                data = response.json()
                return SuiQuote(
                    from_token=from_token,
                    to_token=to_token,
                    amount_in=amount,
                    expected_amount_out=int(data.get("coinOutAmount", 0)),
                    minimum_amount_out=int(float(data.get("coinOutAmount", 0)) * (1 - slippage_bps / 10000)),
                    price_impact=float(data.get("priceImpact", 0)),
                    route=data.get("route", {}),
                    provider="aftermath",
                )

            # Fallback to Cetus
            return await self._get_cetus_quote(from_token, to_token, amount, slippage_bps)

        except Exception as e:
            logger.error(f"Sui quote failed: {e}")
            return None

    async def _get_cetus_quote(
        self,
        from_token: str,
        to_token: str,
        amount: int,
        slippage_bps: int,
    ) -> Optional[SuiQuote]:
        """Fallback quote from Cetus DEX."""
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.CETUS_URL}/router/swap",
                params={
                    "from": from_token,
                    "target": to_token,
                    "amount": str(amount),
                    "by_amount_in": True,
                },
            )

            if response.status_code == 200:
                data = response.json()
                result = data.get("data", {})
                expected_out = int(result.get("amount_out", 0))
                return SuiQuote(
                    from_token=from_token,
                    to_token=to_token,
                    amount_in=amount,
                    expected_amount_out=expected_out,
                    minimum_amount_out=int(expected_out * (1 - slippage_bps / 10000)),
                    price_impact=float(result.get("price_impact", 0)),
                    route=result.get("routes", {}),
                    provider="cetus",
                )
            return None
        except Exception as e:
            logger.error(f"Cetus quote failed: {e}")
            return None

    async def execute_swap(
        self,
        quote: SuiQuote,
        sender_address: str,
        private_key_bytes: bytes,
    ) -> Optional[str]:
        """
        Execute a swap on Sui using the quote's route.

        Returns transaction digest on success.
        """
        try:
            # Build and submit transaction using Sui SDK
            # For now, use the Aftermath/Cetus API to build the transaction
            client = await self._get_client()

            if quote.provider == "aftermath":
                response = await client.post(
                    f"{self.BASE_URL}/router/swap",
                    json={
                        "coinInType": quote.from_token,
                        "coinOutType": quote.to_token,
                        "coinInAmount": str(quote.amount_in),
                        "slippageTolerance": 0.005,
                        "senderAddress": sender_address,
                        "route": quote.route,
                    },
                )
            else:
                # Cetus swap execution
                response = await client.post(
                    f"{self.CETUS_URL}/router/swap/build",
                    json={
                        "from": quote.from_token,
                        "target": quote.to_token,
                        "amount": str(quote.amount_in),
                        "by_amount_in": True,
                        "sender": sender_address,
                    },
                )

            if response.status_code == 200:
                tx_data = response.json()
                # The API returns a transaction block that needs to be signed
                # Sign with the user's private key and submit
                tx_bytes = tx_data.get("txBytes") or tx_data.get("data", {}).get("txBytes")

                if tx_bytes:
                    # Submit signed transaction to Sui RPC
                    signed_tx = await self._sign_and_submit(tx_bytes, private_key_bytes, sender_address)
                    return signed_tx

            logger.error(f"Swap execution failed: {response.status_code} {response.text[:200]}")
            return None

        except Exception as e:
            logger.error(f"Sui swap execution failed: {e}")
            return None

    async def _sign_and_submit(
        self,
        tx_bytes: str,
        private_key_bytes: bytes,
        sender_address: str,
    ) -> Optional[str]:
        """Sign transaction bytes and submit to Sui network."""
        try:
            import base64
            from nacl.signing import SigningKey

            # Decode transaction bytes
            tx_data = base64.b64decode(tx_bytes)

            # Sign with Ed25519
            signing_key = SigningKey(private_key_bytes[:32])
            signature = signing_key.sign(tx_data).signature

            # Build signature scheme flag + signature + public key
            pub_key = signing_key.verify_key.encode()
            sig_with_scheme = bytes([0x00]) + signature + pub_key  # 0x00 = Ed25519 scheme
            sig_b64 = base64.b64encode(sig_with_scheme).decode()
            tx_b64 = base64.b64encode(tx_data).decode()

            # Submit to Sui RPC
            from bot.config.settings import settings
            rpc_url = settings.get_rpc_url("sui")
            if not rpc_url:
                rpc_url = "https://fullnode.mainnet.sui.io:443"

            client = await self._get_client()
            response = await client.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "sui_executeTransactionBlock",
                    "params": [
                        tx_b64,
                        [sig_b64],
                        {"showEffects": True},
                        "WaitForLocalExecution",
                    ],
                },
            )

            if response.status_code == 200:
                result = response.json().get("result", {})
                digest = result.get("digest")
                effects = result.get("effects", {})
                status = effects.get("status", {}).get("status")

                if status == "success":
                    logger.info(f"Sui swap successful: {digest}")
                    return digest
                else:
                    logger.error(f"Sui tx failed: {effects.get('status', {})}")
                    return None

            return None
        except Exception as e:
            logger.error(f"Sui sign and submit failed: {e}")
            return None

    async def get_balance(self, address: str, coin_type: Optional[str] = None) -> int:
        """Get token balance for a Sui address."""
        try:
            from bot.config.settings import settings
            rpc_url = settings.get_rpc_url("sui")
            if not rpc_url:
                rpc_url = "https://fullnode.mainnet.sui.io:443"

            client = await self._get_client()

            if coin_type is None or coin_type == self.SUI_COIN_TYPE:
                # Get SUI balance
                response = await client.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "suix_getBalance",
                        "params": [address, self.SUI_COIN_TYPE],
                    },
                )
            else:
                response = await client.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "suix_getBalance",
                        "params": [address, coin_type],
                    },
                )

            if response.status_code == 200:
                result = response.json().get("result", {})
                return int(result.get("totalBalance", 0))

            return 0
        except Exception as e:
            logger.error(f"Sui balance check failed: {e}")
            return 0

    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Global instance
sui_swap_service = SuiSwapService()
