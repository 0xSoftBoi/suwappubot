"""CoW Protocol (Coincidence of Wants) API client for MEV-protected batch auction swaps.

CoW Protocol provides:
- Batch auctions where orders are matched peer-to-peer when possible (zero fees)
- Solver competition for best execution when no P2P match
- Surplus sharing - any price improvement goes to users
- MEV protection - private mempool, no front-running

Orders are gasless - users sign with EIP-712, protocol submits on-chain.
"""

import logging
import time
import json
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from web3 import Web3
from eth_account.messages import encode_typed_data

from bot.config.settings import settings
from bot.config.chains import get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, get_decimals_by_address
from bot.utils.http_client import get_session, with_retry
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# CoW Protocol API endpoints per chain
COW_API_URLS = {
    "ethereum": "https://api.cow.fi/mainnet",
    "arbitrum": "https://api.cow.fi/arbitrum_one",
    "base": "https://api.cow.fi/base",
    "gnosis": "https://api.cow.fi/xdai",
}

# CoW Protocol Settlement contract addresses
COW_SETTLEMENT_ADDRESSES = {
    "ethereum": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    "arbitrum": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    "base": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    "gnosis": "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
}

# CoW Protocol Vault Relayer (for token approvals)
COW_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"

# Order kinds
ORDER_KIND_SELL = "sell"
ORDER_KIND_BUY = "buy"

# Signing schemes
SIGNING_SCHEME_EIP712 = "eip712"
SIGNING_SCHEME_PRESIGN = "presign"


@dataclass
class CoWQuote:
    """Quote from CoW Protocol."""
    quote_id: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_human: float
    fee_amount: str  # Fee taken from sell token
    fee_amount_human: float
    valid_to: int  # Unix timestamp
    kind: str  # "sell" or "buy"
    sell_token_balance: str
    buy_token_balance: str
    partially_fillable: bool
    receiver: str
    app_data: str
    raw_quote: Dict[str, Any]


@dataclass
class CoWOrder:
    """Submitted order to CoW Protocol."""
    order_uid: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    status: str  # open, fulfilled, cancelled, expired
    created_at: datetime
    valid_to: int
    executed_sell_amount: Optional[str]
    executed_buy_amount: Optional[str]
    raw_response: Dict[str, Any]


@dataclass
class CoWOrderStatus:
    """Status of a CoW order."""
    order_uid: str
    status: str  # open, fulfilled, cancelled, expired, presignaturePending
    filled_amount: str
    executed_surplus_fee: Optional[str]
    invalidated: bool
    raw_response: Dict[str, Any]


class CoWError(Exception):
    """Exception for CoW Protocol errors."""
    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class CoWProtocolAPI:
    """Client for CoW Protocol MEV-protected batch auctions.
    
    CoW Protocol is special because:
    - P2P matching means zero fees when orders match
    - Batch auctions prevent MEV extraction
    - Solvers compete to give users the best price
    - Orders are gasless (user just signs)
    """
    
    def __init__(self):
        self.app_data = self._generate_app_data()
    
    def _generate_app_data(self) -> str:
        """Generate app data hash for order tracking."""
        # App data identifies the integrator
        app_data = {
            "appCode": "suwappu",
            "version": "1.0.0",
            "metadata": {}
        }
        # appData is keccak256 of the canonical JSON document. Use Web3.to_hex so
        # we always emit the full 0x-prefixed 32-byte hash — the previous
        # `"0x" + keccak(...).hex()[:64]` silently dropped 2 hex chars on web3
        # versions whose HexBytes.hex() already includes the 0x prefix.
        app_data_json = json.dumps(app_data, separators=(",", ":"), sort_keys=True)
        return Web3.to_hex(Web3.keccak(text=app_data_json))
    
    def is_supported_chain(self, chain: str) -> bool:
        """Check if CoW supports this chain."""
        return chain.lower() in COW_API_URLS
    
    def get_api_url(self, chain: str) -> str:
        """Get API URL for a chain."""
        url = COW_API_URLS.get(chain.lower())
        if not url:
            raise CoWError(f"Chain not supported by CoW: {chain}")
        return url
    
    def get_settlement_address(self, chain: str) -> str:
        """Get settlement contract address."""
        address = COW_SETTLEMENT_ADDRESSES.get(chain.lower())
        if not address:
            raise CoWError(f"No settlement contract for chain: {chain}")
        return address
    
    def get_supported_chains(self) -> List[str]:
        """Get list of supported chains."""
        return list(COW_API_URLS.keys())
    
    async def get_quote(
        self,
        chain: str,
        from_token: str,
        to_token: str,
        amount: str,
        from_address: str,
        kind: str = ORDER_KIND_SELL,
        receiver: Optional[str] = None,
    ) -> CoWQuote:
        """
        Get a quote from CoW Protocol.
        
        Args:
            chain: Chain name (ethereum, arbitrum, base, gnosis)
            from_token: Sell token address
            to_token: Buy token address
            amount: Amount in smallest units
            from_address: Sender address
            kind: "sell" (exact input) or "buy" (exact output)
            receiver: Receiver address (defaults to from_address)
            
        Returns:
            CoWQuote with pricing details
        """
        if not self.is_supported_chain(chain):
            raise CoWError(f"Chain not supported: {chain}")
        
        api_url = self.get_api_url(chain)
        receiver = receiver or from_address
        
        await api_limiter.wait_and_acquire("cow")
        
        session = await get_session()
        
        # Build quote request
        quote_request = {
            "sellToken": Web3.to_checksum_address(from_token),
            "buyToken": Web3.to_checksum_address(to_token),
            "receiver": Web3.to_checksum_address(receiver),
            "from": Web3.to_checksum_address(from_address),
            "kind": kind,
            "partiallyFillable": False,
            "sellTokenBalance": "erc20",
            "buyTokenBalance": "erc20",
            "signingScheme": SIGNING_SCHEME_EIP712,
        }
        
        if kind == ORDER_KIND_SELL:
            quote_request["sellAmountBeforeFee"] = amount
        else:
            quote_request["buyAmountAfterFee"] = amount
        
        async def _do_quote():
            import aiohttp as _aiohttp
            async with session.post(
                f"{api_url}/api/v1/quote",
                json=quote_request,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise _aiohttp.ClientResponseError(
                        response.request_info,
                        response.history,
                        status=response.status,
                        message=error_text[:200],
                    )
                return await response.json()

        try:
            data = await with_retry(_do_quote, label="CoW quote", base_delay=0.5)
        except Exception as exc:
            raise CoWError(f"CoW quote error: {exc}") from exc
        
        quote = data.get("quote", {})
        
        # Parse amounts
        sell_amount = quote.get("sellAmount", "0")
        buy_amount = quote.get("buyAmount", "0")
        fee_amount = quote.get("feeAmount", "0")
        
        # Get decimals for human-readable amounts using address lookup
        buy_decimals = get_decimals_by_address(to_token, chain)
        buy_amount_human = int(buy_amount) / (10 ** buy_decimals)
        sell_decimals = get_decimals_by_address(from_token, chain)
        fee_amount_human = int(fee_amount) / (10 ** sell_decimals)
        
        return CoWQuote(
            quote_id=data.get("id", ""),
            from_token=from_token,
            to_token=to_token,
            from_amount=sell_amount,
            to_amount=buy_amount,
            to_amount_human=buy_amount_human,
            fee_amount=fee_amount,
            fee_amount_human=fee_amount_human,
            valid_to=quote.get("validTo", int(time.time()) + 1800),
            kind=kind,
            sell_token_balance=quote.get("sellTokenBalance", "erc20"),
            buy_token_balance=quote.get("buyTokenBalance", "erc20"),
            partially_fillable=quote.get("partiallyFillable", False),
            receiver=receiver,
            app_data=self.app_data,
            raw_quote=data,
        )
    
    def build_order_data(
        self,
        quote: CoWQuote,
        valid_to: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Build order data for signing."""
        valid_to = valid_to or quote.valid_to
        
        return {
            "sellToken": Web3.to_checksum_address(quote.from_token),
            "buyToken": Web3.to_checksum_address(quote.to_token),
            "receiver": Web3.to_checksum_address(quote.receiver),
            "sellAmount": quote.from_amount,
            "buyAmount": quote.to_amount,
            "validTo": valid_to,
            "appData": quote.app_data,
            "feeAmount": quote.fee_amount,
            "kind": quote.kind,
            "partiallyFillable": quote.partially_fillable,
            "sellTokenBalance": quote.sell_token_balance,
            "buyTokenBalance": quote.buy_token_balance,
        }
    
    def get_order_typed_data(
        self,
        chain: str,
        order_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Get EIP-712 typed data for order signing."""
        chain_config = get_chain_by_name(chain)
        chain_id = chain_config.chain_id if chain_config else 1
        
        return {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "Order": [
                    {"name": "sellToken", "type": "address"},
                    {"name": "buyToken", "type": "address"},
                    {"name": "receiver", "type": "address"},
                    {"name": "sellAmount", "type": "uint256"},
                    {"name": "buyAmount", "type": "uint256"},
                    {"name": "validTo", "type": "uint32"},
                    {"name": "appData", "type": "bytes32"},
                    {"name": "feeAmount", "type": "uint256"},
                    {"name": "kind", "type": "string"},
                    {"name": "partiallyFillable", "type": "bool"},
                    {"name": "sellTokenBalance", "type": "string"},
                    {"name": "buyTokenBalance", "type": "string"},
                ],
            },
            "primaryType": "Order",
            "domain": {
                "name": "Gnosis Protocol",
                "version": "v2",
                "chainId": chain_id,
                "verifyingContract": self.get_settlement_address(chain),
            },
            "message": {
                "sellToken": order_data["sellToken"],
                "buyToken": order_data["buyToken"],
                "receiver": order_data["receiver"],
                "sellAmount": int(order_data["sellAmount"]),
                "buyAmount": int(order_data["buyAmount"]),
                "validTo": order_data["validTo"],
                "appData": order_data["appData"],
                "feeAmount": int(order_data["feeAmount"]),
                "kind": order_data["kind"],
                "partiallyFillable": order_data["partiallyFillable"],
                "sellTokenBalance": order_data["sellTokenBalance"],
                "buyTokenBalance": order_data["buyTokenBalance"],
            },
        }
    
    async def submit_order(
        self,
        chain: str,
        quote: CoWQuote,
        signature: str,
        from_address: str,
    ) -> CoWOrder:
        """
        Submit a signed order to CoW Protocol.
        
        Args:
            chain: Chain name
            quote: Quote from get_quote
            signature: EIP-712 signature of the order
            from_address: Sender address
            
        Returns:
            CoWOrder with order UID
        """
        api_url = self.get_api_url(chain)
        
        await api_limiter.wait_and_acquire("cow")
        
        session = await get_session()
        
        order_data = self.build_order_data(quote)
        
        order_request = {
            **order_data,
            "from": Web3.to_checksum_address(from_address),
            "signature": signature,
            "signingScheme": SIGNING_SCHEME_EIP712,
        }
        
        async with session.post(
            f"{api_url}/api/v1/orders",
            json=order_request
        ) as response:
            if response.status not in [200, 201]:
                error_text = await response.text()
                raise CoWError(f"CoW order submission error: {error_text}")
            
            # Response is the order UID as a string
            order_uid = await response.text()
            order_uid = order_uid.strip('"')
        
        return CoWOrder(
            order_uid=order_uid,
            from_token=quote.from_token,
            to_token=quote.to_token,
            from_amount=quote.from_amount,
            to_amount=quote.to_amount,
            status="open",
            created_at=datetime.now(timezone.utc),
            valid_to=quote.valid_to,
            executed_sell_amount=None,
            executed_buy_amount=None,
            raw_response={"uid": order_uid},
        )
    
    async def get_order_status(
        self,
        chain: str,
        order_uid: str,
    ) -> CoWOrderStatus:
        """
        Get the status of an order.
        
        Args:
            chain: Chain name
            order_uid: Order UID from submit_order
            
        Returns:
            CoWOrderStatus with current status
        """
        api_url = self.get_api_url(chain)
        
        await api_limiter.wait_and_acquire("cow")
        
        session = await get_session()
        
        async with session.get(
            f"{api_url}/api/v1/orders/{order_uid}"
        ) as response:
            if response.status == 404:
                return CoWOrderStatus(
                    order_uid=order_uid,
                    status="not_found",
                    filled_amount="0",
                    executed_surplus_fee=None,
                    invalidated=False,
                    raw_response={},
                )
            
            if response.status != 200:
                error_text = await response.text()
                raise CoWError(f"CoW status error: {error_text}")
            
            data = await response.json()
        
        return CoWOrderStatus(
            order_uid=order_uid,
            status=data.get("status", "unknown"),
            filled_amount=data.get("executedSellAmount", "0"),
            executed_surplus_fee=data.get("executedSurplusFee"),
            invalidated=data.get("invalidated", False),
            raw_response=data,
        )
    
    async def cancel_order(
        self,
        chain: str,
        order_uid: str,
        signature: str,
    ) -> bool:
        """Cancel an order."""
        api_url = self.get_api_url(chain)
        
        await api_limiter.wait_and_acquire("cow")
        
        session = await get_session()
        
        async with session.delete(
            f"{api_url}/api/v1/orders/{order_uid}",
            json={"signature": signature, "signingScheme": SIGNING_SCHEME_EIP712}
        ) as response:
            return response.status == 200
    
    def build_approval_transaction(
        self,
        chain: str,
        token_address: str,
        amount: str,
    ) -> Dict[str, Any]:
        """Build approval transaction for CoW vault relayer."""
        erc20_approve_abi = [{
            "inputs": [
                {"name": "spender", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "approve",
            "outputs": [{"name": "", "type": "bool"}],
            "stateMutability": "nonpayable",
            "type": "function"
        }]
        
        token_contract = Web3().eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=erc20_approve_abi
        )
        
        data = token_contract.encode_abi(
            fn_name="approve",
            args=[
                Web3.to_checksum_address(COW_VAULT_RELAYER),
                int(amount) if amount != "max" else 2**256 - 1
            ]
        )
        
        return {
            "to": Web3.to_checksum_address(token_address),
            "data": data,
            "value": 0,
        }


# Global instance
cow_api = CoWProtocolAPI()

