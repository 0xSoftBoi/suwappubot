"""Across Protocol API client for cheap cross-chain bridging.

Across uses an intent-based system where relayers compete to fill orders,
resulting in very low fees (~0.04%) and fast finality (~2 minutes).

Key benefits:
- Very low fees compared to other bridges
- Fast finality via relayer competition
- Supports major tokens: ETH, WETH, USDC, USDT, WBTC, DAI
"""

import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from decimal import Decimal

from bot.config.chains import get_chain_by_name
from bot.config.tokens import get_token_decimals
from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Across Protocol API
ACROSS_API_URL = "https://app.across.to/api"

# HyperLiquid HyperCore destination chain id used by the Across Swap API. A
# deposit to this "chain" is auto-credited to the recipient's HyperCore account
# (the account is created on first deposit if it doesn't exist).
HYPERCORE_CHAIN_ID = 1337

# The output token to request for a HyperCore USDC deposit ("USDC-SPOT"). Funds
# arrive as a USDC *spot* balance on HyperCore. This is the HyperCore USDC system
# address (token index 0), verified live via Across /swap/tokens?chainId=1337 —
# the USDC-SPOT token has 8 decimals on chain 1337 (NOT 6). (USDC-PERPS, for
# direct-to-perp deposits, is 0x2100...0000.)
HYPERCORE_USDC_SPOT_TOKEN = "0x2000000000000000000000000000000000000000"

# Decimals of the chain-1337 USDC-SPOT output token (8, per the live token list).
HYPERCORE_USDC_DECIMALS = 8

# Across-supported chain IDs
ACROSS_CHAIN_IDS = {
    "ethereum": 1,
    "optimism": 10,
    "polygon": 137,
    "arbitrum": 42161,
    "base": 8453,
    "linea": 59144,
    "zksync": 324,
    "scroll": 534352,
}

# Across SpokePool addresses (where deposits are made)
SPOKE_POOL_ADDRESSES = {
    "ethereum": "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    "optimism": "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
    "polygon": "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
    "arbitrum": "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    "base": "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
    "linea": "0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75",
    "zksync": "0xE0B015E54d54fc84a6cB9B666099c46adE9335FF",
    "scroll": "0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96",
}

# Supported tokens with their addresses per chain
ACROSS_TOKENS = {
    "ETH": {
        "ethereum": "0x0000000000000000000000000000000000000000",  # Native
        "optimism": "0x0000000000000000000000000000000000000000",
        "arbitrum": "0x0000000000000000000000000000000000000000",
        "base": "0x0000000000000000000000000000000000000000",
        "linea": "0x0000000000000000000000000000000000000000",
        "scroll": "0x0000000000000000000000000000000000000000",
    },
    "WETH": {
        "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "optimism": "0x4200000000000000000000000000000000000006",
        "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "base": "0x4200000000000000000000000000000000000006",
        "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        "linea": "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f",
        "scroll": "0x5300000000000000000000000000000000000004",
    },
    "USDC": {
        "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "linea": "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
        "scroll": "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4",
    },
    "USDT": {
        "ethereum": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "optimism": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        "arbitrum": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "polygon": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
    "WBTC": {
        "ethereum": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        "optimism": "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
        "arbitrum": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        "polygon": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    },
    "DAI": {
        "ethereum": "0x6B175474E89094C44Da98b954EescdeCB5f6d00",
        "optimism": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        "arbitrum": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        "polygon": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        "base": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    },
}


@dataclass
class AcrossQuote:
    """Quote from Across Protocol."""
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    from_amount_human: float
    to_amount_human: float
    relay_fee: str  # Fee taken by relayer
    relay_fee_pct: float  # Fee as percentage
    relay_fee_usd: float
    gas_cost_usd: float
    total_cost_usd: float
    estimated_fill_time: int  # seconds
    spoke_pool: str
    deposit_id: Optional[int]
    raw_quote: Dict[str, Any]


@dataclass
class AcrossStatus:
    """Status of an Across deposit."""
    deposit_id: int
    status: str  # PENDING, FILLED, EXPIRED
    fill_tx_hash: Optional[str]
    raw_response: Dict[str, Any]


@dataclass
class HyperCoreDepositQuote:
    """A quote + ready-to-send transactions for funding a HyperCore account.

    Produced by the Across Swap API. `approval_txns` (zero or more) must be sent
    before `swap_tx`. All tx dicts carry {to, data, value, chainId} on the
    origin chain; the relayer credits HyperCore on the destination side.
    """
    from_chain: str
    input_token: str
    output_token: str
    recipient: str  # the HyperCore account that gets credited
    input_amount: str  # smallest units, origin token
    expected_output: str  # smallest units of USDC credited to HyperCore
    min_output: str  # minimum guaranteed output (slippage floor)
    input_amount_human: float
    expected_output_human: float
    estimated_fill_time: int  # seconds
    approval_txns: List[Dict[str, Any]]
    swap_tx: Dict[str, Any]
    raw_quote: Dict[str, Any]


class AcrossError(Exception):
    """Exception for Across API errors."""
    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class AcrossAPI:
    """Client for Across Protocol cross-chain bridging.
    
    Across is one of the cheapest bridges due to its intent-based design
    where relayers compete to fill orders quickly.
    """
    
    def __init__(self):
        self.api_url = ACROSS_API_URL
    
    def is_supported_route(
        self,
        from_chain: str,
        to_chain: str,
        token: str
    ) -> bool:
        """Check if Across supports this route."""
        from_chain_l = from_chain.lower()
        to_chain_l = to_chain.lower()
        token_u = token.upper()
        
        # Check chains
        if from_chain_l not in ACROSS_CHAIN_IDS or to_chain_l not in ACROSS_CHAIN_IDS:
            return False
        
        if from_chain_l == to_chain_l:
            return False
        
        # Check token on both chains
        if token_u not in ACROSS_TOKENS:
            return False
        
        token_addrs = ACROSS_TOKENS[token_u]
        return from_chain_l in token_addrs and to_chain_l in token_addrs
    
    def get_supported_tokens(self, chain: str) -> List[str]:
        """Get tokens supported on a chain."""
        chain_l = chain.lower()
        supported = []
        for token, chains in ACROSS_TOKENS.items():
            if chain_l in chains:
                supported.append(token)
        return supported
    
    def get_chain_id(self, chain: str) -> int:
        """Get Across chain ID."""
        chain_id = ACROSS_CHAIN_IDS.get(chain.lower())
        if chain_id is None:
            raise AcrossError(f"Chain not supported by Across: {chain}")
        return chain_id
    
    def get_spoke_pool(self, chain: str) -> str:
        """Get SpokePool address for a chain."""
        address = SPOKE_POOL_ADDRESSES.get(chain.lower())
        if not address:
            raise AcrossError(f"No SpokePool for chain: {chain}")
        return address
    
    def get_token_address(self, token: str, chain: str) -> str:
        """Get token address on a chain."""
        token_u = token.upper()
        chain_l = chain.lower()
        
        if token_u not in ACROSS_TOKENS:
            raise AcrossError(f"Token not supported: {token}")
        
        address = ACROSS_TOKENS[token_u].get(chain_l)
        if not address:
            raise AcrossError(f"Token {token} not available on {chain}")
        
        return address
    
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: str,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> AcrossQuote:
        """
        Get a quote from Across Protocol.
        
        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            token: Token symbol (ETH, USDC, etc.)
            amount: Amount in smallest unit
            from_address: Sender address
            to_address: Recipient (defaults to sender)
            
        Returns:
            AcrossQuote with bridge details
        """
        if not self.is_supported_route(from_chain, to_chain, token):
            raise AcrossError(
                f"Route not supported: {token} from {from_chain} to {to_chain}"
            )
        
        to_address = to_address or from_address
        
        from_chain_id = self.get_chain_id(from_chain)
        to_chain_id = self.get_chain_id(to_chain)
        token_address = self.get_token_address(token, from_chain)
        
        await api_limiter.wait_and_acquire("across")
        
        session = await get_session()
        
        # Get suggested fees from Across API
        params = {
            "token": token_address,
            "originChainId": from_chain_id,
            "destinationChainId": to_chain_id,
            "amount": amount,
            "recipient": to_address,
            "message": "0x",  # No message
        }
        
        async with session.get(
            f"{self.api_url}/suggested-fees",
            params=params
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise AcrossError(f"Across API error: {error_text}")
            
            data = await response.json()
        
        # Parse the response
        total_relay_fee = int(data.get("totalRelayFee", {}).get("total", "0"))
        relay_fee_pct = float(data.get("totalRelayFee", {}).get("pct", "0"))
        
        # Calculate output amount
        input_amount = int(amount)
        output_amount = input_amount - total_relay_fee
        
        # Get decimals for human-readable amounts
        decimals = get_token_decimals(token, from_chain) or 18
        from_amount_human = input_amount / (10 ** decimals)
        to_amount_human = output_amount / (10 ** decimals)
        
        # Estimate gas cost (deposit tx)
        gas_estimates = {
            "ethereum": 3.0,
            "arbitrum": 0.20,
            "optimism": 0.20,
            "base": 0.15,
            "polygon": 0.05,
            "linea": 0.15,
            "scroll": 0.20,
        }
        gas_cost = gas_estimates.get(from_chain.lower(), 0.50)
        
        # Calculate relay fee in USD (rough estimate)
        # Assuming token prices (would be better to fetch from price service)
        token_prices = {
            "ETH": 2000,
            "WETH": 2000,
            "USDC": 1,
            "USDT": 1,
            "WBTC": 40000,
            "DAI": 1,
        }
        token_price = token_prices.get(token.upper(), 1)
        relay_fee_human = total_relay_fee / (10 ** decimals)
        relay_fee_usd = relay_fee_human * token_price
        
        return AcrossQuote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=amount,
            to_amount=str(output_amount),
            from_amount_human=from_amount_human,
            to_amount_human=to_amount_human,
            relay_fee=str(total_relay_fee),
            relay_fee_pct=relay_fee_pct / 1e18 * 100,  # Convert to percentage
            relay_fee_usd=relay_fee_usd,
            gas_cost_usd=gas_cost,
            total_cost_usd=relay_fee_usd + gas_cost,
            estimated_fill_time=data.get("estimatedFillTimeSec", 120),
            spoke_pool=self.get_spoke_pool(from_chain),
            deposit_id=None,  # Assigned after deposit
            raw_quote=data,
        )
    
    async def get_limits(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
    ) -> Dict[str, Any]:
        """Get deposit limits for a route."""
        from_chain_id = self.get_chain_id(from_chain)
        to_chain_id = self.get_chain_id(to_chain)
        token_address = self.get_token_address(token, from_chain)
        
        await api_limiter.wait_and_acquire("across")
        
        session = await get_session()
        
        params = {
            "token": token_address,
            "originChainId": from_chain_id,
            "destinationChainId": to_chain_id,
        }
        
        async with session.get(
            f"{self.api_url}/limits",
            params=params
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise AcrossError(f"Across limits error: {error_text}")
            
            return await response.json()
    
    @staticmethod
    def _normalize_tx(tx: Dict[str, Any], default_chain_id: int) -> Dict[str, Any]:
        """Normalize an Across Swap API tx object to {to, data, value, chainId}."""
        if not tx or not tx.get("to") or not tx.get("data"):
            raise AcrossError(f"Malformed transaction in Across response: {tx}")
        return {
            "to": tx["to"],
            "data": tx["data"],
            "value": int(tx.get("value", 0) or 0),
            "chainId": int(tx.get("chainId", default_chain_id) or default_chain_id),
        }

    async def get_hypercore_usdc_deposit(
        self,
        from_chain: str,
        input_token_address: str,
        amount: str,
        recipient: str,
        depositor: Optional[str] = None,
        slippage_pct: float = 0.5,
    ) -> HyperCoreDepositQuote:
        """Quote a USDC deposit into a HyperLiquid HyperCore account via Across.

        Uses the Across Swap API (`/swap/approval`) targeting `destinationChainId`
        1337. The bridged funds land as a USDC *spot* balance on HyperCore and
        the account is auto-created if it doesn't exist.

        Args:
            from_chain: source chain name (must be Across-supported).
            input_token_address: the token being bridged on the origin chain
                (typically the chain's USDC address).
            amount: input amount in smallest units (string).
            recipient: the HyperCore account (EVM address) to credit.
            depositor: origin-chain sender; defaults to `recipient`.
            slippage_pct: max slippage tolerance, percent (e.g. 0.5 = 0.5%).

        Returns:
            HyperCoreDepositQuote with approval_txns + swap_tx ready to sign/send.
        """
        if not recipient or not recipient.startswith("0x"):
            raise AcrossError(f"Invalid HyperCore recipient address: {recipient!r}")

        origin_chain_id = self.get_chain_id(from_chain)
        depositor = depositor or recipient

        await api_limiter.wait_and_acquire("across")
        session = await get_session()

        params = {
            "tradeType": "minOutput",
            "amount": str(amount),
            "inputToken": input_token_address,
            "outputToken": HYPERCORE_USDC_SPOT_TOKEN,
            "originChainId": origin_chain_id,
            "destinationChainId": HYPERCORE_CHAIN_ID,
            "depositor": depositor,
            "recipient": recipient,
            "slippageTolerance": slippage_pct,
        }
        integrator_id = getattr(settings, "across_integrator_id", None)
        if integrator_id:
            params["integratorId"] = integrator_id

        headers = {}
        api_key = getattr(settings, "across_api_key", None)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        async with session.get(
            f"{self.api_url}/swap/approval", params=params, headers=headers
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise AcrossError(f"Across swap/approval error ({response.status}): {error_text}")
            data = await response.json()

        # The swap tx may be returned as `swapTx` (object) or as the last entry
        # of a `steps` array; approvals come as `approvalTxns` (list).
        swap_tx_raw = data.get("swapTx") or data.get("tx")
        if not swap_tx_raw and isinstance(data.get("steps"), list) and data["steps"]:
            swap_tx_raw = data["steps"][-1].get("tx") or data["steps"][-1]
        swap_tx = self._normalize_tx(swap_tx_raw, origin_chain_id)

        approval_txns = [
            self._normalize_tx(t, origin_chain_id)
            for t in (data.get("approvalTxns") or [])
            if t
        ]

        # Output amount fields (best-effort across response shapes).
        expected_output = str(
            data.get("expectedOutputAmount")
            or data.get("outputAmount")
            or (data.get("steps", [{}])[-1] if data.get("steps") else {}).get("outputAmount")
            or "0"
        )
        min_output = str(data.get("minOutputAmount") or expected_output)

        # Origin USDC is 6dp; the HyperCore USDC-SPOT output token is 8dp.
        in_decimals = get_token_decimals("USDC", from_chain) or 6
        input_human = int(amount) / (10 ** in_decimals)
        output_human = (
            int(expected_output) / (10 ** HYPERCORE_USDC_DECIMALS)
            if expected_output.isdigit()
            else 0.0
        )

        return HyperCoreDepositQuote(
            from_chain=from_chain,
            input_token=input_token_address,
            output_token=HYPERCORE_USDC_SPOT_TOKEN,
            recipient=recipient,
            input_amount=str(amount),
            expected_output=expected_output,
            min_output=min_output,
            input_amount_human=input_human,
            expected_output_human=output_human,
            estimated_fill_time=int(
                data.get("expectedFillTime") or data.get("estimatedFillTimeSec") or 60
            ),
            approval_txns=approval_txns,
            swap_tx=swap_tx,
            raw_quote=data,
        )

    def build_deposit_calldata(
        self,
        quote: AcrossQuote,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build deposit transaction calldata.
        
        This creates the transaction to deposit tokens into the SpokePool.
        A relayer will then fill the order on the destination chain.
        """
        from web3 import Web3
        
        to_address = to_address or from_address
        
        # SpokePool depositV3 function
        # function depositV3(
        #     address depositor,
        #     address recipient,
        #     address inputToken,
        #     address outputToken,
        #     uint256 inputAmount,
        #     uint256 outputAmount,
        #     uint256 destinationChainId,
        #     address exclusiveRelayer,
        #     uint32 quoteTimestamp,
        #     uint32 fillDeadline,
        #     uint32 exclusivityDeadline,
        #     bytes message
        # )
        
        DEPOSIT_V3_ABI = [
            {
                "inputs": [
                    {"name": "depositor", "type": "address"},
                    {"name": "recipient", "type": "address"},
                    {"name": "inputToken", "type": "address"},
                    {"name": "outputToken", "type": "address"},
                    {"name": "inputAmount", "type": "uint256"},
                    {"name": "outputAmount", "type": "uint256"},
                    {"name": "destinationChainId", "type": "uint256"},
                    {"name": "exclusiveRelayer", "type": "address"},
                    {"name": "quoteTimestamp", "type": "uint32"},
                    {"name": "fillDeadline", "type": "uint32"},
                    {"name": "exclusivityDeadline", "type": "uint32"},
                    {"name": "message", "type": "bytes"},
                ],
                "name": "depositV3",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            }
        ]
        
        spoke_pool = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.spoke_pool),
            abi=DEPOSIT_V3_ABI
        )
        
        input_token = self.get_token_address(quote.from_token, quote.from_chain)
        output_token = self.get_token_address(quote.to_token, quote.to_chain)
        dest_chain_id = self.get_chain_id(quote.to_chain)
        
        # Get timestamps from quote
        quote_timestamp = quote.raw_quote.get("timestamp", 0)
        fill_deadline = quote.raw_quote.get("fillDeadline", 0)
        exclusivity_deadline = quote.raw_quote.get("exclusivityDeadline", 0)
        exclusive_relayer = quote.raw_quote.get("exclusiveRelayer", "0x0000000000000000000000000000000000000000")
        
        data = spoke_pool.encode_abi(
            fn_name="depositV3",
            args=[
                Web3.to_checksum_address(from_address),
                Web3.to_checksum_address(to_address),
                Web3.to_checksum_address(input_token),
                Web3.to_checksum_address(output_token),
                int(quote.from_amount),
                int(quote.to_amount),
                dest_chain_id,
                Web3.to_checksum_address(exclusive_relayer),
                quote_timestamp,
                fill_deadline,
                exclusivity_deadline,
                b"",  # Empty message
            ]
        )
        
        # Value is the input amount if depositing ETH
        is_eth = quote.from_token.upper() in ["ETH", "WETH"] and input_token == "0x0000000000000000000000000000000000000000"
        value = int(quote.from_amount) if is_eth else 0
        
        return {
            "to": Web3.to_checksum_address(quote.spoke_pool),
            "data": data,
            "value": value,
        }
    
    async def get_deposit_status(
        self,
        from_chain: str,
        deposit_id: int,
    ) -> AcrossStatus:
        """Check the status of a deposit."""
        from_chain_id = self.get_chain_id(from_chain)
        
        await api_limiter.wait_and_acquire("across")
        
        session = await get_session()
        
        async with session.get(
            f"{self.api_url}/deposit/status",
            params={
                "originChainId": from_chain_id,
                "depositId": deposit_id,
            }
        ) as response:
            if response.status == 404:
                return AcrossStatus(
                    deposit_id=deposit_id,
                    status="PENDING",
                    fill_tx_hash=None,
                    raw_response={},
                )
            
            data = await response.json()
            
            return AcrossStatus(
                deposit_id=deposit_id,
                status=data.get("status", "PENDING").upper(),
                fill_tx_hash=data.get("fillTx"),
                raw_response=data,
            )


# Global instance
across_api = AcrossAPI()

