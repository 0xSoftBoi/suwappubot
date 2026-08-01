"""Jito Block Engine API client for Solana MEV protection.

Jito provides MEV protection by:
- Submitting transactions as bundles to block builders
- Preventing sandwich attacks (transactions execute atomically)
- Priority ordering via tips to validators

Without Jito, Solana swaps can lose 1-5% to MEV bots.
With Jito bundles, transactions are protected from front-running.
"""

import logging
import base64
import json
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass
from enum import Enum

from solders.transaction import Transaction, VersionedTransaction
from solders.message import Message, MessageV0
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta, CompiledInstruction
from solders.system_program import transfer, TransferParams
from solders.hash import Hash

from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Jito Block Engine endpoints
JITO_BLOCK_ENGINE_MAINNET = "https://mainnet.block-engine.jito.wtf"
JITO_BLOCK_ENGINE_AMSTERDAM = "https://amsterdam.mainnet.block-engine.jito.wtf"
JITO_BLOCK_ENGINE_FRANKFURT = "https://frankfurt.mainnet.block-engine.jito.wtf"
JITO_BLOCK_ENGINE_NY = "https://ny.mainnet.block-engine.jito.wtf"
JITO_BLOCK_ENGINE_TOKYO = "https://tokyo.mainnet.block-engine.jito.wtf"

# Jito tip accounts (tip one of these for priority)
JITO_TIP_ACCOUNTS = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
]


# Default tip amounts (in lamports, 1 SOL = 1,000,000,000 lamports)
class TipPriority(Enum):
    LOW = 100_000  # 0.0001 SOL - for small swaps
    MEDIUM = 1_000_000  # 0.001 SOL - normal priority
    HIGH = 10_000_000  # 0.01 SOL - high priority/large swaps
    URGENT = 50_000_000  # 0.05 SOL - urgent execution


@dataclass
class JitoBundle:
    """A bundle of transactions to submit to Jito."""

    bundle_id: str
    transactions: List[str]  # Base64-encoded transactions
    tip_amount: int
    tip_account: str


@dataclass
class JitoBundleStatus:
    """Status of a submitted bundle."""

    bundle_id: str
    status: str  # "landed", "pending", "failed"
    slot: Optional[int]
    confirmation_status: Optional[str]
    error: Optional[str]
    raw_response: Dict[str, Any]


@dataclass
class JitoTipInfo:
    """Information about Jito tips."""

    landed_tips_25th_percentile: int
    landed_tips_50th_percentile: int
    landed_tips_75th_percentile: int
    landed_tips_95th_percentile: int
    landed_tips_99th_percentile: int
    ema_landed_tips_50th_percentile: int


class JitoError(Exception):
    """Exception for Jito errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class JitoAPI:
    """Client for Jito Block Engine for MEV-protected Solana transactions.

    Jito protects users from MEV by:
    1. Bundling transactions together
    2. Submitting directly to block builders (not public mempool)
    3. Executing atomically (all-or-nothing)

    This prevents sandwich attacks where bots front-run and back-run swaps.
    """

    def __init__(self, endpoint: str = JITO_BLOCK_ENGINE_MAINNET):
        self.endpoint = endpoint
        self._request_id = 0

    def _next_request_id(self) -> int:
        """Get next JSON-RPC request ID."""
        self._request_id += 1
        return self._request_id

    def get_tip_account(self) -> str:
        """Get a random tip account."""
        import random

        return random.choice(JITO_TIP_ACCOUNTS)

    def get_recommended_tip(self, priority: TipPriority = TipPriority.MEDIUM) -> int:
        """Get recommended tip amount in lamports."""
        return priority.value

    def create_tip_instruction(
        self,
        payer: Pubkey,
        tip_amount: int,
        tip_account: Optional[str] = None,
    ) -> Instruction:
        """
        Create a tip instruction to add to a transaction.

        Args:
            payer: Pubkey of the payer
            tip_amount: Tip amount in lamports
            tip_account: Specific tip account (random if not specified)

        Returns:
            Instruction for the tip transfer
        """
        tip_account = tip_account or self.get_tip_account()
        tip_pubkey = Pubkey.from_string(tip_account)

        return transfer(
            TransferParams(
                from_pubkey=payer,
                to_pubkey=tip_pubkey,
                lamports=tip_amount,
            )
        )

    def add_tip_to_transaction(
        self,
        transaction: Transaction,
        payer: Pubkey,
        tip_amount: int = TipPriority.MEDIUM.value,
        tip_account: Optional[str] = None,
    ) -> Transaction:
        """
        Add a tip instruction to an existing transaction.

        Args:
            transaction: The transaction to add tip to
            payer: Pubkey of the payer
            tip_amount: Tip amount in lamports
            tip_account: Specific tip account

        Returns:
            New transaction with tip instruction added
        """
        tip_ix = self.create_tip_instruction(payer, tip_amount, tip_account)

        # Get existing instructions
        existing_instructions = list(transaction.message.instructions)

        # Add tip instruction at the end
        existing_instructions.append(tip_ix)

        # Create new message with all instructions
        new_message = Message.new_with_blockhash(
            existing_instructions,
            payer,
            transaction.message.recent_blockhash,
        )

        return Transaction.new_unsigned(new_message)

    async def send_bundle(
        self,
        transactions: List[str],  # Base64-encoded signed transactions
    ) -> str:
        """
        Submit a bundle to Jito Block Engine.

        Args:
            transactions: List of base64-encoded signed transactions

        Returns:
            Bundle ID
        """
        await api_limiter.wait_and_acquire("jito")

        session = await get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "sendBundle",
            "params": [transactions],
        }

        async with session.post(
            f"{self.endpoint}/api/v1/bundles",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise JitoError(f"Jito send_bundle error: {error_text}")

            data = await response.json()

        if "error" in data:
            raise JitoError(
                f"Jito bundle error: {data['error'].get('message', 'Unknown')}", data["error"]
            )

        return data.get("result", "")

    async def send_transaction(
        self,
        transaction: str,  # Base64-encoded signed transaction
        skip_preflight: bool = True,
    ) -> str:
        """
        Send a single transaction via Jito (as a single-tx bundle).

        Args:
            transaction: Base64-encoded signed transaction
            skip_preflight: Skip preflight checks

        Returns:
            Transaction signature
        """
        await api_limiter.wait_and_acquire("jito")

        session = await get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "sendTransaction",
            "params": [transaction, {"skipPreflight": skip_preflight, "encoding": "base64"}],
        }

        async with session.post(
            f"{self.endpoint}/api/v1/transactions",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise JitoError(f"Jito send_transaction error: {error_text}")

            data = await response.json()

        if "error" in data:
            raise JitoError(
                f"Jito transaction error: {data['error'].get('message', 'Unknown')}", data["error"]
            )

        return data.get("result", "")

    async def get_bundle_statuses(
        self,
        bundle_ids: List[str],
    ) -> List[JitoBundleStatus]:
        """
        Get status of submitted bundles.

        Args:
            bundle_ids: List of bundle IDs

        Returns:
            List of bundle statuses
        """
        await api_limiter.wait_and_acquire("jito")

        session = await get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "getBundleStatuses",
            "params": [bundle_ids],
        }

        async with session.post(
            f"{self.endpoint}/api/v1/bundles",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise JitoError(f"Jito status error: {error_text}")

            data = await response.json()

        statuses = []
        for i, bundle_id in enumerate(bundle_ids):
            result = data.get("result", {}).get("value", [])

            if i < len(result) and result[i]:
                bundle_data = result[i]
                status = "pending"

                if bundle_data.get("confirmation_status") == "finalized":
                    status = "landed"
                elif bundle_data.get("err"):
                    status = "failed"

                statuses.append(
                    JitoBundleStatus(
                        bundle_id=bundle_id,
                        status=status,
                        slot=bundle_data.get("slot"),
                        confirmation_status=bundle_data.get("confirmation_status"),
                        error=bundle_data.get("err"),
                        raw_response=bundle_data,
                    )
                )
            else:
                statuses.append(
                    JitoBundleStatus(
                        bundle_id=bundle_id,
                        status="pending",
                        slot=None,
                        confirmation_status=None,
                        error=None,
                        raw_response={},
                    )
                )

        return statuses

    async def get_tip_accounts(self) -> List[str]:
        """Get current tip accounts from Jito."""
        await api_limiter.wait_and_acquire("jito")

        session = await get_session()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": "getTipAccounts",
            "params": [],
        }

        async with session.post(
            f"{self.endpoint}/api/v1/bundles",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as response:
            if response.status != 200:
                return JITO_TIP_ACCOUNTS

            data = await response.json()

        return data.get("result", JITO_TIP_ACCOUNTS)

    async def get_tip_info(self) -> Optional[JitoTipInfo]:
        """Get current tip statistics."""
        try:
            await api_limiter.wait_and_acquire("jito")

            session = await get_session()

            async with session.get(
                "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
                headers={"Content-Type": "application/json"},
            ) as response:
                if response.status != 200:
                    return None

                data = await response.json()

            return JitoTipInfo(
                landed_tips_25th_percentile=data.get("landed_tips_25th_percentile", 0),
                landed_tips_50th_percentile=data.get("landed_tips_50th_percentile", 0),
                landed_tips_75th_percentile=data.get("landed_tips_75th_percentile", 0),
                landed_tips_95th_percentile=data.get("landed_tips_95th_percentile", 0),
                landed_tips_99th_percentile=data.get("landed_tips_99th_percentile", 0),
                ema_landed_tips_50th_percentile=data.get("ema_landed_tips_50th_percentile", 0),
            )
        except Exception as e:
            logger.warning(f"Failed to get tip info: {e}")
            return None

    def calculate_dynamic_tip(
        self,
        swap_amount_usd: float,
        tip_info: Optional[JitoTipInfo] = None,
    ) -> int:
        """
        Calculate a dynamic tip based on swap size.

        Args:
            swap_amount_usd: Swap amount in USD
            tip_info: Optional tip statistics

        Returns:
            Recommended tip in lamports
        """
        # Base tip on swap size
        if swap_amount_usd < 100:
            base_tip = TipPriority.LOW.value
        elif swap_amount_usd < 1000:
            base_tip = TipPriority.MEDIUM.value
        elif swap_amount_usd < 10000:
            base_tip = TipPriority.HIGH.value
        else:
            base_tip = TipPriority.URGENT.value

        # If we have tip info, use the 50th percentile as minimum
        if tip_info and tip_info.ema_landed_tips_50th_percentile > base_tip:
            return tip_info.ema_landed_tips_50th_percentile

        return base_tip

    async def submit_swap_bundle(
        self,
        swap_transaction: str,  # Base64-encoded Jupiter swap transaction
        tip_amount: Optional[int] = None,
        tip_account: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        Submit a swap transaction as a Jito bundle for MEV protection.

        This is the main method for protecting swaps. It:
        1. Takes a signed Jupiter swap transaction
        2. Submits it via Jito block engine
        3. Returns bundle ID and transaction signature

        Args:
            swap_transaction: Base64-encoded signed swap transaction
            tip_amount: Optional tip amount (uses medium priority if not specified)
            tip_account: Optional specific tip account

        Returns:
            Tuple of (bundle_id, transaction_signature)
        """
        # For single transactions, the tip should already be included
        # in the transaction by the caller
        bundle_id = await self.send_bundle([swap_transaction])

        # Extract signature from transaction
        try:
            tx_bytes = base64.b64decode(swap_transaction)
            tx = VersionedTransaction.from_bytes(tx_bytes)
            signature = str(tx.signatures[0])
        except Exception:
            signature = ""

        return bundle_id, signature


# Global instance (uses mainnet by default)
jito_api = JitoAPI()

# Alternative instances for different regions
jito_amsterdam = JitoAPI(JITO_BLOCK_ENGINE_AMSTERDAM)
jito_frankfurt = JitoAPI(JITO_BLOCK_ENGINE_FRANKFURT)
jito_ny = JitoAPI(JITO_BLOCK_ENGINE_NY)
jito_tokyo = JitoAPI(JITO_BLOCK_ENGINE_TOKYO)
