"""TIP-20 token interactions for Tempo.

TIP-20 extends ERC-20 with: currency identifiers, payment lanes,
transfer memos, compliance policies, and reward distribution.
Standard ERC-20 calls work, but TIP-20 extensions provide richer functionality.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from eth_account import Account
from web3 import Web3

from bot.services.tempo_dex_api import _get_tempo_web3

logger = logging.getLogger(__name__)

# TIP-20 Factory (pre-deployed system contract)
TIP20_FACTORY_ADDRESS = "0x20Fc000000000000000000000000000000000000"

# TIP-20 extended ABI (superset of ERC-20)
TIP20_ABI = [
    # Standard ERC-20 methods
    {
        "inputs": [],
        "name": "name",
        "outputs": [{"name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    # TIP-20 extensions
    {
        "inputs": [],
        "name": "currency",
        "outputs": [{"name": "", "type": "bytes3"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "compliancePolicy",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        # Verified against tempoxyz/tempo-std ITIP20.sol: the memo is a fixed
        # bytes32 (NOT variable-length bytes), and the call has no return value.
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "memo", "type": "bytes32"},
        ],
        "name": "transferWithMemo",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    # EIP-2612 Permit (TIP-1004, Tempo T2 upgrade)
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
            {"name": "v", "type": "uint8"},
            {"name": "r", "type": "bytes32"},
            {"name": "s", "type": "bytes32"},
        ],
        "name": "permit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "nonces",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "DOMAIN_SEPARATOR",
        "outputs": [{"name": "", "type": "bytes32"}],
        "stateMutability": "view",
        "type": "function",
    },
    # ERC-20 allowance (needed for permit flow)
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    # ERC-20 approve
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

# TIP-20 Factory ABI
TIP20_FACTORY_ABI = [
    {
        "inputs": [{"name": "token", "type": "address"}],
        "name": "isTIP20",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
]


@dataclass
class TIP20Info:
    """Information about a TIP-20 token."""

    address: str
    name: str
    symbol: str
    decimals: int
    currency_code: str  # ISO 4217 currency code (e.g. "USD", "EUR")
    compliance_policy: Optional[str]  # Address of compliance policy contract
    is_tip20: bool  # Whether it's a full TIP-20 or just ERC-20


class TempoTIP20:
    """Client for TIP-20 token interactions on Tempo."""

    async def get_tip20_info(self, token_address: str) -> TIP20Info:
        """Fetch TIP-20 token information.

        Falls back gracefully if the token is a standard ERC-20
        without TIP-20 extensions.
        """
        web3 = _get_tempo_web3()
        addr = Web3.to_checksum_address(token_address)

        token = web3.eth.contract(address=addr, abi=TIP20_ABI)
        factory = web3.eth.contract(
            address=Web3.to_checksum_address(TIP20_FACTORY_ADDRESS),
            abi=TIP20_FACTORY_ABI,
        )

        loop = asyncio.get_event_loop()

        # Standard ERC-20 fields (offload blocking calls)
        name = await loop.run_in_executor(None, token.functions.name().call)
        symbol = await loop.run_in_executor(None, token.functions.symbol().call)
        decimals = await loop.run_in_executor(None, token.functions.decimals().call)

        # Check if it's a TIP-20 via factory
        try:
            is_tip20 = await loop.run_in_executor(None, factory.functions.isTIP20(addr).call)
        except Exception:
            is_tip20 = False

        # TIP-20 extensions (may not exist on plain ERC-20s)
        currency_code = ""
        compliance_policy = None

        if is_tip20:
            try:
                raw_currency = await loop.run_in_executor(None, token.functions.currency().call)
                currency_code = raw_currency.decode("utf-8").rstrip("\x00")
            except Exception as e:
                logger.debug(f"TIP-20 currency() call failed: {e}")

            try:
                compliance_policy = await loop.run_in_executor(
                    None, token.functions.compliancePolicy().call
                )
                if compliance_policy == "0x" + "0" * 40:
                    compliance_policy = None
            except Exception as e:
                logger.debug(f"TIP-20 compliancePolicy() call failed: {e}")

        return TIP20Info(
            address=token_address,
            name=name,
            symbol=symbol,
            decimals=decimals,
            currency_code=currency_code,
            compliance_policy=compliance_policy,
            is_tip20=is_tip20,
        )

    @staticmethod
    def encode_memo(memo: str) -> bytes:
        """Encode a payment memo as the fixed 32-byte field TIP-20 expects.

        UTF-8, right-padded with zeros (truncated to 32 bytes). An empty memo is
        32 zero bytes — still a valid transferWithMemo. This mirrors ethers'
        ``encodeBytes32String`` used in the Tempo docs/examples.
        """
        raw = (memo or "").encode("utf-8")[:32]
        return raw.ljust(32, b"\x00")

    def build_transfer_with_memo(
        self,
        token_address: str,
        to: str,
        amount: int,
        memo: str,
    ) -> dict:
        """Build a TIP-20 transferWithMemo transaction.

        Args:
            token_address: TIP-20 token contract address
            to: Recipient address
            amount: Amount in smallest unit
            memo: Payment memo string (encoded as a fixed bytes32)
        """
        web3 = _get_tempo_web3()
        addr = Web3.to_checksum_address(token_address)
        token = web3.eth.contract(address=addr, abi=TIP20_ABI)

        data = token.encode_abi(
            "transferWithMemo",
            args=[
                Web3.to_checksum_address(to),
                amount,
                self.encode_memo(memo),
            ],
        )

        return {
            "to": addr,
            "data": data,
            "value": 0,
        }

    async def build_permit_signature(
        self,
        token_address: str,
        owner_key: str,
        spender: str,
        value: int,
        deadline: Optional[int] = None,
    ) -> Tuple[int, bytes, bytes, int]:
        """Build an EIP-2612 permit signature for gasless approval.

        Args:
            token_address: TIP-20 token contract
            owner_key: Owner's private key (hex)
            spender: Address being approved to spend
            value: Amount to approve
            deadline: Unix timestamp (defaults to 1 hour from now)

        Returns:
            (v, r, s, deadline) tuple for use in permit() call
        """
        if deadline is None:
            deadline = int(time.time()) + 3600

        web3 = _get_tempo_web3()
        addr = Web3.to_checksum_address(token_address)
        token = web3.eth.contract(address=addr, abi=TIP20_ABI)

        loop = asyncio.get_event_loop()
        owner = Account.from_key(owner_key).address

        nonce = await loop.run_in_executor(None, token.functions.nonces(owner).call)
        domain_separator = await loop.run_in_executor(  # noqa: F841
            None, token.functions.DOMAIN_SEPARATOR().call
        )  # noqa: F841
        name = await loop.run_in_executor(None, token.functions.name().call)
        chain_id = await loop.run_in_executor(None, lambda: web3.eth.chain_id)

        typed_data = {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "Permit": [
                    {"name": "owner", "type": "address"},
                    {"name": "spender", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "nonce", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                ],
            },
            "primaryType": "Permit",
            "domain": {
                "name": name,
                "version": "1",
                "chainId": chain_id,
                "verifyingContract": addr,
            },
            "message": {
                "owner": owner,
                "spender": Web3.to_checksum_address(spender),
                "value": value,
                "nonce": nonce,
                "deadline": deadline,
            },
        }

        signed = Account.sign_typed_data(
            owner_key,
            full_message=typed_data,
        )

        return (signed.v, signed.r, signed.s, deadline)


# Global instance
tempo_tip20 = TempoTIP20()
