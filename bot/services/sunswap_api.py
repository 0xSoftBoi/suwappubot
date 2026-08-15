"""SunSwap V2 API client for TRON on-chain swaps.

SunSwap V2 is the dominant DEX on TRON (89%+ volume), with a Uniswap V2-compatible
Router interface. All calls go through TronGrid (already used for balances).

Supported swap types:
- TRC20 <-> TRC20 (swapExactTokensForTokens)
- TRX -> TRC20 (swapExactETHForTokens)
- TRC20 -> TRX (swapExactTokensForETH)
"""

import logging
from typing import Optional
from dataclasses import dataclass

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.performance import track_time, MetricNames
from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager

logger = logging.getLogger(__name__)

# SunSwap V2 Router on TRON mainnet
SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax"

# Wrapped TRX (WTRX) — used as intermediate for TRX swaps
WTRX_ADDRESS = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"

# TronGrid base URL
TRONGRID_BASE = "https://api.trongrid.io"

# Function selectors (keccak256 first 4 bytes)
SELECTOR_GET_AMOUNTS_OUT = "d06ca61f"  # getAmountsOut(uint256,address[])
SELECTOR_SWAP_EXACT_TOKENS_FOR_TOKENS = (
    "38ed1739"  # swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
)
SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS = (
    "7ff36ab5"  # swapExactETHForTokens(uint256,address[],address,uint256)
)
SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH = (
    "18cbafe5"  # swapExactTokensForETH(uint256,uint256,address[],address,uint256)
)
SELECTOR_APPROVE = "095ea7b3"  # approve(address,uint256)
SELECTOR_ALLOWANCE = "dd62ed3e"  # allowance(address,address)


@dataclass
class SunSwapQuote:
    """Quote from SunSwap V2 Router."""

    amount_in: str
    amount_out: str
    amount_out_min: str
    path: list[str]  # Token addresses in swap path
    price_impact: float
    raw_response: dict


class SunSwapError(Exception):
    """Exception raised for SunSwap API errors."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


def _tron_address_to_hex(base58_address: str) -> str:
    """Convert TRON base58check address to hex (without 41 prefix, zero-padded to 32 bytes).

    TronGrid's triggerconstantcontract expects addresses as 32-byte hex-encoded
    ABI parameters (left-padded with zeros).
    """
    import base58 as b58

    decoded = b58.b58decode_check(base58_address)
    # decoded[0] is 0x41 (TRON prefix), rest is 20-byte address
    addr_hex = decoded[1:].hex()
    return addr_hex.zfill(64)


def _hex_to_tron_address(hex_addr: str) -> str:
    """Convert 20-byte hex address back to TRON base58check format."""
    import base58 as b58
    import hashlib

    # Strip leading zeros to get 20-byte address, then add 0x41 prefix
    addr_bytes = bytes.fromhex(hex_addr[-40:])
    prefixed = b"\x41" + addr_bytes
    # Double SHA256 for checksum
    h1 = hashlib.sha256(prefixed).digest()
    h2 = hashlib.sha256(h1).digest()
    return b58.b58encode(prefixed + h2[:4]).decode()


def _encode_uint256(value: int) -> str:
    """Encode uint256 as 32-byte hex string."""
    return hex(value)[2:].zfill(64)


def _encode_address_array(addresses: list[str]) -> str:
    """ABI-encode a dynamic address[] parameter.

    Layout:
    - offset to array data (32 bytes)
    - array length (32 bytes)
    - each address (32 bytes each)
    """
    length = _encode_uint256(len(addresses))
    encoded_addrs = "".join(_tron_address_to_hex(addr) for addr in addresses)
    return length + encoded_addrs


class SunSwapAPI:
    """Client for SunSwap V2 DEX on TRON."""

    def __init__(self):
        self.router = SUNSWAP_V2_ROUTER
        self.wtrx = WTRX_ADDRESS
        self.base_url = rpc_manager.get_rpc_url("tron") or TRONGRID_BASE

    def _get_headers(self) -> dict:
        """Get request headers, including API key if configured."""
        headers = {"Content-Type": "application/json"}
        if hasattr(settings, "trongrid_api_key") and settings.trongrid_api_key:
            headers["TRON-PRO-API-KEY"] = settings.trongrid_api_key
        return headers

    def _is_native_trx(self, token_address: str) -> bool:
        """Check if token is native TRX."""
        return token_address.lower() in ("native", "trx", "")

    def _resolve_path(self, from_token: str, to_token: str) -> list[str]:
        """Build swap path, substituting WTRX for native TRX."""
        from_addr = self.wtrx if self._is_native_trx(from_token) else from_token
        to_addr = self.wtrx if self._is_native_trx(to_token) else to_token

        if from_addr == to_addr:
            raise SunSwapError("Cannot swap token to itself")

        return [from_addr, to_addr]

    @track_time(MetricNames.API_SUNSWAP)
    async def _trigger_constant_contract(
        self,
        contract_address: str,
        function_selector: str,
        parameter: str,
        owner_address: str = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",  # Dummy for view calls
    ) -> dict:
        """Call a read-only contract function via TronGrid triggerconstantcontract.

        This is free (no energy cost) and returns the function result.
        """
        await api_limiter.wait_and_acquire("sunswap")

        session = await get_session()
        payload = {
            "owner_address": owner_address,
            "contract_address": contract_address,
            "function_selector": function_selector,
            "parameter": parameter,
            "visible": True,
        }

        async with session.post(
            f"{self.base_url}/wallet/triggerconstantcontract",
            json=payload,
            headers=self._get_headers(),
        ) as resp:
            data = await resp.json()

            if resp.status != 200:
                raise SunSwapError(f"TronGrid error: {resp.status}", data)

            result = data.get("result", {})
            if not result.get("result", True):
                msg = result.get("message", "")
                if isinstance(msg, str) and msg.startswith("0x"):
                    msg = bytes.fromhex(msg[2:]).decode("utf-8", errors="replace")
                raise SunSwapError(f"Contract call failed: {msg}", data)

            return data

    async def get_amounts_out(self, amount_in: int, path: list[str]) -> list[int]:
        """Call Router.getAmountsOut() to get expected output amounts.

        Args:
            amount_in: Input amount in smallest unit (sun for TRX, base units for TRC20)
            path: List of token addresses (WTRX for native TRX)

        Returns:
            List of amounts for each step in the path
        """
        # ABI encode: getAmountsOut(uint256 amountIn, address[] path)
        # Parameters: amountIn (32B) + offset to path (32B) + path array
        amount_hex = _encode_uint256(amount_in)
        offset_hex = _encode_uint256(64)  # offset = 2 * 32 bytes
        path_encoded = _encode_address_array(path)

        parameter = amount_hex + offset_hex + path_encoded

        data = await self._trigger_constant_contract(
            contract_address=self.router,
            function_selector="getAmountsOut(uint256,address[])",
            parameter=parameter,
        )

        # Parse result: returns uint256[] (dynamic array)
        constant_result = data.get("constant_result", [])
        if not constant_result:
            raise SunSwapError("Empty result from getAmountsOut", data)

        result_hex = constant_result[0]
        # Dynamic array: offset (32B) + length (32B) + elements (32B each)
        # Skip offset (first 64 chars)
        array_length = int(result_hex[64:128], 16)
        amounts = []
        for i in range(array_length):
            start = 128 + i * 64
            amounts.append(int(result_hex[start : start + 64], 16))

        return amounts

    async def get_quote(
        self,
        from_token: str,
        to_token: str,
        amount_raw: str,
        slippage_bps: int = 50,
    ) -> SunSwapQuote:
        """Get a swap quote from SunSwap V2.

        Args:
            from_token: Source token address (or "native" for TRX)
            to_token: Destination token address (or "native" for TRX)
            amount_raw: Input amount in smallest units
            slippage_bps: Slippage tolerance in basis points (50 = 0.5%)

        Returns:
            SunSwapQuote with expected output and minimum output
        """
        path = self._resolve_path(from_token, to_token)
        amount_in = int(amount_raw)

        amounts = await self.get_amounts_out(amount_in, path)

        if len(amounts) < 2:
            raise SunSwapError("Insufficient liquidity for this pair")

        amount_out = amounts[-1]
        # Apply slippage
        amount_out_min = amount_out * (10000 - slippage_bps) // 10000

        # Estimate price impact (simple heuristic based on pool depth)
        # For a more accurate value we'd need pool reserves, but this is MVP
        price_impact = 0.0

        return SunSwapQuote(
            amount_in=str(amount_in),
            amount_out=str(amount_out),
            amount_out_min=str(amount_out_min),
            path=path,
            price_impact=price_impact,
            raw_response={
                "amounts": [str(a) for a in amounts],
                "path": path,
                "slippage_bps": slippage_bps,
            },
        )

    async def get_allowance(
        self,
        token_address: str,
        owner_address: str,
        spender_address: str = SUNSWAP_V2_ROUTER,
    ) -> int:
        """Check TRC20 allowance for the Router."""
        parameter = _tron_address_to_hex(owner_address) + _tron_address_to_hex(spender_address)

        data = await self._trigger_constant_contract(
            contract_address=token_address,
            function_selector="allowance(address,address)",
            parameter=parameter,
            owner_address=owner_address,
        )

        constant_result = data.get("constant_result", [])
        if not constant_result:
            return 0

        return int(constant_result[0], 16)

    @track_time(MetricNames.API_SUNSWAP)
    async def build_approve_transaction(
        self,
        token_address: str,
        owner_address: str,
        amount: int = 2**256 - 1,  # Max approval
    ) -> dict:
        """Build a TRC20 approve transaction for the Router.

        Returns raw transaction dict ready for signing.
        """
        await api_limiter.wait_and_acquire("sunswap")

        parameter = _tron_address_to_hex(self.router) + _encode_uint256(amount)

        session = await get_session()
        payload = {
            "owner_address": owner_address,
            "contract_address": token_address,
            "function_selector": "approve(address,uint256)",
            "parameter": parameter,
            "fee_limit": 100_000_000,  # 100 TRX max fee
            "call_value": 0,
            "visible": True,
        }

        async with session.post(
            f"{self.base_url}/wallet/triggersmartcontract",
            json=payload,
            headers=self._get_headers(),
        ) as resp:
            data = await resp.json()

            if resp.status != 200:
                raise SunSwapError(f"TronGrid error building approve tx: {resp.status}", data)

            result = data.get("result", {})
            if not result.get("result", False):
                msg = result.get("message", "")
                if isinstance(msg, str) and msg.startswith("0x"):
                    msg = bytes.fromhex(msg[2:]).decode("utf-8", errors="replace")
                raise SunSwapError(f"Failed to build approve tx: {msg}", data)

            return data.get("transaction", {})

    @track_time(MetricNames.API_SUNSWAP)
    async def build_swap_transaction(
        self,
        from_address: str,
        from_token: str,
        to_token: str,
        amount_in: int,
        amount_out_min: int,
        path: list[str],
        deadline_offset: int = 300,  # 5 minutes
    ) -> dict:
        """Build a swap transaction on SunSwap V2 Router.

        Chooses the correct Router method based on whether TRX is involved:
        - TRX -> TRC20: swapExactETHForTokens
        - TRC20 -> TRX: swapExactTokensForETH
        - TRC20 -> TRC20: swapExactTokensForTokens

        Returns raw transaction dict ready for signing.
        """
        await api_limiter.wait_and_acquire("sunswap")

        import time

        deadline = int(time.time()) + deadline_offset

        is_from_trx = self._is_native_trx(from_token)
        is_to_trx = self._is_native_trx(to_token)

        if is_from_trx:
            # swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
            function_selector = "swapExactETHForTokens(uint256,address[],address,uint256)"
            # Parameters: amountOutMin + offset_to_path + to + deadline + path_array
            offset_to_path = _encode_uint256(128)  # 4 * 32 = 128
            parameter = (
                _encode_uint256(amount_out_min)
                + offset_to_path
                + _tron_address_to_hex(from_address)
                + _encode_uint256(deadline)
                + _encode_address_array(path)
            )
            call_value = amount_in  # Send TRX as callValue
        elif is_to_trx:
            # swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
            function_selector = "swapExactTokensForETH(uint256,uint256,address[],address,uint256)"
            offset_to_path = _encode_uint256(160)  # 5 * 32 = 160
            parameter = (
                _encode_uint256(amount_in)
                + _encode_uint256(amount_out_min)
                + offset_to_path
                + _tron_address_to_hex(from_address)
                + _encode_uint256(deadline)
                + _encode_address_array(path)
            )
            call_value = 0
        else:
            # swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
            function_selector = (
                "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
            )
            offset_to_path = _encode_uint256(160)  # 5 * 32 = 160
            parameter = (
                _encode_uint256(amount_in)
                + _encode_uint256(amount_out_min)
                + offset_to_path
                + _tron_address_to_hex(from_address)
                + _encode_uint256(deadline)
                + _encode_address_array(path)
            )
            call_value = 0

        session = await get_session()
        payload = {
            "owner_address": from_address,
            "contract_address": self.router,
            "function_selector": function_selector,
            "parameter": parameter,
            "fee_limit": 150_000_000,  # 150 TRX max fee (~$6 for swaps)
            "call_value": call_value,
            "visible": True,
        }

        async with session.post(
            f"{self.base_url}/wallet/triggersmartcontract",
            json=payload,
            headers=self._get_headers(),
        ) as resp:
            data = await resp.json()

            if resp.status != 200:
                raise SunSwapError(f"TronGrid error building swap tx: {resp.status}", data)

            result = data.get("result", {})
            if not result.get("result", False):
                msg = result.get("message", "")
                if isinstance(msg, str) and msg.startswith("0x"):
                    msg = bytes.fromhex(msg[2:]).decode("utf-8", errors="replace")
                raise SunSwapError(f"Failed to build swap tx: {msg}", data)

            return data.get("transaction", {})

    async def sign_and_broadcast(self, transaction: dict, private_key_hex: str) -> str:
        """Sign a TRON transaction and broadcast it.

        Args:
            transaction: Raw transaction dict from build_*_transaction
            private_key_hex: Hex-encoded private key

        Returns:
            Transaction ID (hash)
        """
        from tronpy.keys import PrivateKey as TronPrivateKey

        pk = TronPrivateKey(bytes.fromhex(private_key_hex.replace("0x", "")))
        tx_id = transaction.get("txID", "")
        raw_data_hex = transaction.get("raw_data_hex", "")

        # Sign the txID
        signature = pk.sign(bytes.fromhex(tx_id))

        signed_payload = {
            "raw_data": transaction.get("raw_data", {}),
            "raw_data_hex": raw_data_hex,
            "txID": tx_id,
            "signature": [signature.hex()],
        }

        session = await get_session()
        async with session.post(
            f"{self.base_url}/wallet/broadcasttransaction",
            json=signed_payload,
            headers=self._get_headers(),
        ) as resp:
            result = await resp.json()
            if result.get("result") is True:
                return result.get("txid", tx_id)

            error_msg = result.get("message", "Unknown error")
            if isinstance(error_msg, str) and error_msg.startswith("0x"):
                error_msg = bytes.fromhex(error_msg[2:]).decode("utf-8", errors="replace")
            raise SunSwapError(f"TRON broadcast failed: {error_msg}", result)
