"""Arbitrum canonical bridge (L1 -> Arbitrum deposit direction ONLY).

This is the official Arbitrum GatewayRouter contract, not a REST aggregator.
Only the L1->Arbitrum ERC20 deposit direction is implemented here.

IMPORTANT: the Arbitrum -> L1 withdrawal direction is intentionally NOT
offered as a swap route. A canonical L2->L1 withdrawal has a ~7-day fraud
challenge period before funds are claimable on L1 — presenting that as a
normal swap quote would be misleading to users expecting near-immediate
settlement. `get_quote` returns None and `is_supported_route` returns False
for the withdrawal direction; do not fake a quote for it.
"""

import logging
from typing import Any, Dict, Optional

from eth_abi import encode as abi_encode
from web3 import Web3

from bot.config.settings import settings
from bot.services.bridge.base import BridgeError, BridgeProvider, BridgeQuote

logger = logging.getLogger(__name__)

# Arbitrum One L1 GatewayRouter (mainnet Ethereum).
L1_GATEWAY_ROUTER = "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef"

# Minimal ABI for the outboundTransfer deposit entrypoint.
GATEWAY_ROUTER_ABI = [
    {
        "inputs": [
            {"name": "_token", "type": "address"},
            {"name": "_to", "type": "address"},
            {"name": "_amount", "type": "uint256"},
            {"name": "_maxGas", "type": "uint256"},
            {"name": "_gasPriceBid", "type": "uint256"},
            {"name": "_data", "type": "bytes"},
        ],
        "name": "outboundTransfer",
        "outputs": [{"name": "", "type": "bytes"}],
        "stateMutability": "payable",
        "type": "function",
    }
]


class ArbitrumNativeError(BridgeError):
    """Exception for Arbitrum native bridge errors."""


class ArbitrumNativeBridge(BridgeProvider):
    """Client for the canonical Arbitrum L1->L2 deposit bridge."""

    def __init__(self):
        self.gateway_router = L1_GATEWAY_ROUTER

    @property
    def name(self) -> str:
        return "arbitrum_native"

    @property
    def enabled(self) -> bool:
        # Default OFF: get_quote cannot yet fetch live L2 gas parameters
        # (maxSubmissionCost / maxGas / gasPriceBid via NodeInterface.
        # estimateRetryableTicket), so a "quote" would carry placeholder
        # calldata that reverts on submission and burns the user's L1 gas.
        return settings.arbitrum_native_bridge_enabled

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        # Deposit direction ONLY: L1 (ethereum) -> arbitrum. The reverse
        # (withdrawal) is rejected here so callers/router.py can skip it
        # cheaply instead of calling get_quote and getting None back.
        return from_chain.lower() == "ethereum" and to_chain.lower() == "arbitrum"

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        # DISABLED / not submittable: outboundTransfer is payable and requires
        # msg.value >= maxSubmissionCost + maxGas*gasPriceBid, plus `_data`
        # must be abi.encode(maxSubmissionCost, extraData) — not empty bytes.
        # We do not yet fetch live L2 gas parameters (NodeInterface.
        # estimateRetryableTicket), so any quote emitted here would carry
        # placeholder calldata that reverts on submission and burns the
        # user's L1 gas. Fail closed: never emit a fabricated 1:1 quote.
        #
        # This also gates on the `enabled` flag (default False) so the
        # registry skips this provider entirely until live gas estimation
        # is wired in and verified.
        if not self.enabled:
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            # Covers both the withdrawal direction (arbitrum -> ethereum) and
            # any unrelated chain pair. Withdrawals have a ~7-day challenge
            # period and are deliberately not offered as a swap route here.
            return None

        logger.debug(
            "Arbitrum native bridge: get_quote unimplemented (no live L2 gas "
            "estimation wired in yet); refusing to emit a quote."
        )
        return None

    def build_deposit_transaction(
        self,
        token_address: str,
        recipient: str,
        amount: str,
        max_gas: int,
        gas_price_bid: int,
        max_submission_cost: int,
        extra_data: bytes = b"",
    ) -> Dict[str, Any]:
        """Build the outboundTransfer deposit calldata for the GatewayRouter.

        `max_gas`, `gas_price_bid`, and `max_submission_cost` MUST be fetched
        live (e.g. via NodeInterface.estimateRetryableTicket) and passed in
        explicitly — there are deliberately no defaults, since a stale/zero
        value produces a transaction that reverts on submission and burns the
        user's L1 gas.

        `outboundTransfer` is payable: `msg.value` must cover
        `max_submission_cost + max_gas * gas_price_bid`, and `_data` must be
        `abi.encode(uint256 maxSubmissionCost, bytes extraData)` per the
        Arbitrum GatewayRouter/L1GatewayRouter deposit ABI — not empty bytes.
        """
        if max_gas <= 0:
            raise ArbitrumNativeError("max_gas must be a positive live gas estimate")
        if gas_price_bid <= 0:
            raise ArbitrumNativeError("gas_price_bid must be a positive live gas estimate")
        if max_submission_cost <= 0:
            raise ArbitrumNativeError(
                "max_submission_cost must be a positive live retryable-ticket estimate"
            )

        router = Web3().eth.contract(
            address=Web3.to_checksum_address(self.gateway_router),
            abi=GATEWAY_ROUTER_ABI,
        )

        inner_data = abi_encode(["uint256", "bytes"], [max_submission_cost, extra_data])

        data = router.encode_abi(
            "outboundTransfer",
            args=[
                Web3.to_checksum_address(token_address),
                Web3.to_checksum_address(recipient),
                int(amount),
                max_gas,
                gas_price_bid,
                inner_data,
            ],
        )

        value = max_submission_cost + max_gas * gas_price_bid

        return {
            "to": Web3.to_checksum_address(self.gateway_router),
            "data": data,
            "value": value,
        }

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """Canonical bridge status tracking is not implemented; callers
        should track the L1 tx hash (`tracking_id`) via the L1 explorer /
        Arbitrum's own retryable-ticket lookup instead.
        """
        return {"status": "UNKNOWN", "note": "Track via L1 tx hash / Arbitrum retryable ticket."}


# Global instance
arbitrum_native_api = ArbitrumNativeBridge()
