"""CCTP V2 native-USDC rail for funding a HyperLiquid HyperCore account.

This is the *future-proof* USDC rail (Circle is making native USDC the canonical
USDC on HyperLiquid and deprecating the Arbitrum Bridge2). It moves native USDC
1:1 with no wrapped assets, via Circle's burn-and-mint:

  1. Source chain  : approve + `depositForBurn` (V2) -> burns USDC, emits message
  2. Circle Iris   : poll for the attestation over the burn message (V2 API)
  3. HyperEVM      : `receiveMessage` -> mints native USDC to the recipient
  4. HyperEVM->Core: ERC20-transfer the minted USDC to the token system address
                     -> credits the recipient's HyperCore *spot* balance

IMPORTANT — destination gas. Steps 3 & 4 run on HyperEVM and cost **HYPE** gas.
A user funding from another chain won't hold HYPE on HyperEVM, so those steps
must be performed by a HYPE-funded **relayer** (or via a Circle/HyperLiquid
auto-relay once that is GA). Until a relayer is wired, only steps 1–2 are
user-signable; do NOT auto-burn and leave funds stranded on HyperEVM. The
Across rail (`across_api.get_hypercore_usdc_deposit`) remains the zero-friction
default; this module is the native-USDC alternative.

Contract addresses / domain are from Circle's CCTP V2 docs and HyperLiquid's
HyperEVM<->HyperCore docs (2026). The HyperEVM native-USDC address and USDC's
HyperCore token index are marked VERIFY — confirm on-chain before mainnet use.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from web3 import Web3

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Circle Iris V2 API (messages + fees). V2 lives under /v2.
IRIS_V2_BASE = "https://iris-api.circle.com/v2"

# CCTP V2 domain for HyperEVM (Circle CCTP V2 docs).
HYPEREVM_CCTP_DOMAIN = 19

# CCTP V2 source domains we support burning from (same numbering as V1 domains).
CCTP_V2_DOMAINS = {
    "ethereum": 0,
    "avalanche": 1,
    "optimism": 2,
    "arbitrum": 3,
    "base": 6,
    "polygon": 7,
}

# CCTP V2 contracts — the same address across V2-supported chains (incl. HyperEVM).
TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"

# Native USDC (6 decimals) on each source chain.
SOURCE_USDC = {
    "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "avalanche": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
}

# VERIFY before mainnet: native USDC token on HyperEVM (where CCTP V2 mints).
HYPEREVM_NATIVE_USDC = "0xb88339CB7199b77E23DB6E890353E22632Ba630f"

# HyperEVM->HyperCore credit: ERC20 transfer to the token's system address,
# which is 0x20 followed by the HyperCore token index in big-endian. USDC's
# HyperCore token index is 0 (VERIFY), giving the all-zero-suffixed address.
HYPERCORE_USDC_TOKEN_INDEX = 0
HYPERCORE_USDC_SYSTEM_ADDRESS = "0x" + "20" + f"{HYPERCORE_USDC_TOKEN_INDEX:0>38x}"

# CCTP V2 minFinalityThreshold: 1000 = Fast Transfer, 2000 = Standard.
FINALITY_FAST = 1000
FINALITY_STANDARD = 2000

USDC_DECIMALS = 6

# CCTP V2 depositForBurn (note the extra destinationCaller/maxFee/minFinality args
# vs V1).
TOKEN_MESSENGER_V2_ABI = [
    {
        "inputs": [
            {"name": "amount", "type": "uint256"},
            {"name": "destinationDomain", "type": "uint32"},
            {"name": "mintRecipient", "type": "bytes32"},
            {"name": "burnToken", "type": "address"},
            {"name": "destinationCaller", "type": "bytes32"},
            {"name": "maxFee", "type": "uint256"},
            {"name": "minFinalityThreshold", "type": "uint32"},
        ],
        "name": "depositForBurn",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

MESSAGE_TRANSMITTER_V2_ABI = [
    {
        "inputs": [
            {"name": "message", "type": "bytes"},
            {"name": "attestation", "type": "bytes"},
        ],
        "name": "receiveMessage",
        "outputs": [{"name": "success", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

ERC20_ABI = [
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
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


class CctpHyperCoreError(Exception):
    """Raised on CCTP V2 / HyperCore funding errors."""


@dataclass
class CctpBurnQuote:
    """The source-chain burn step (approve + depositForBurn) plus economics."""

    from_chain: str
    recipient: str  # HyperEVM/HL account that receives the mint
    input_amount: str  # smallest units (6dp USDC)
    input_amount_human: float
    max_fee: int  # smallest units, paid to Circle for fast finality
    expected_output_human: float
    min_finality_threshold: int
    estimated_time: int  # seconds
    approve_tx: Dict[str, Any]
    burn_tx: Dict[str, Any]
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CctpAttestation:
    """A retrieved Iris V2 attestation for a burn message."""

    status: str  # "complete" / "pending"
    message: Optional[str]  # hex message bytes
    attestation: Optional[str]  # hex attestation bytes

    @property
    def is_complete(self) -> bool:
        return self.status == "complete" and bool(self.message) and bool(self.attestation)


def _to_bytes32(address: str) -> bytes:
    """Left-pad a 20-byte EVM address to a 32-byte value."""
    return Web3.to_bytes(hexstr=address).rjust(32, b"\x00")


class CctpHyperCoreAPI:
    """CCTP V2 native-USDC funding for HyperCore."""

    def is_supported_source(self, chain: str) -> bool:
        return chain.lower() in CCTP_V2_DOMAINS

    def get_source_domain(self, chain: str) -> int:
        domain = CCTP_V2_DOMAINS.get(chain.lower())
        if domain is None:
            raise CctpHyperCoreError(f"CCTP V2 doesn't support source chain: {chain}")
        return domain

    def get_source_usdc(self, chain: str) -> str:
        addr = SOURCE_USDC.get(chain.lower())
        if not addr:
            raise CctpHyperCoreError(f"No native USDC mapping for chain: {chain}")
        return addr

    async def get_fast_fee(self, from_chain: str, amount_raw: int) -> int:
        """Fetch the Fast-Transfer fee (smallest units) for a burn.

        Circle's fee API returns a fee rate in basis points per finality tier;
        we apply the Fast tier to `amount_raw`. Falls back to 0 (Standard, no
        fee) if the API is unavailable.
        """
        src_domain = self.get_source_domain(from_chain)
        await api_limiter.wait_and_acquire("cctp")
        session = await get_session()
        url = f"{IRIS_V2_BASE}/burn/USDC/fees/{src_domain}/{HYPEREVM_CCTP_DOMAIN}"
        try:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return 0
                data = await resp.json()
        except Exception as e:  # noqa: BLE001 — fee is best-effort
            logger.warning("CCTP fee fetch failed: %s", e)
            return 0

        # Response is a list of {finalityThreshold, minimumFee(bps)}; pick Fast.
        tiers = data if isinstance(data, list) else data.get("fees", [])
        for tier in tiers:
            if int(tier.get("finalityThreshold", 0)) <= FINALITY_FAST:
                bps = float(tier.get("minimumFee", 0))
                return int(amount_raw * bps / 10_000)
        return 0

    async def quote_burn(
        self,
        from_chain: str,
        amount_human: float,
        recipient: str,
        fast: bool = True,
    ) -> CctpBurnQuote:
        """Build the source-chain approve + depositForBurn for a HyperCore deposit.

        `recipient` is the user's HyperEVM/HL address (CCTP mints native USDC to
        it on HyperEVM; a relayer then credits HyperCore — see module docstring).
        """
        if not self.is_supported_source(from_chain):
            raise CctpHyperCoreError(f"CCTP V2 doesn't support source chain: {from_chain}")
        if not recipient or not recipient.startswith("0x"):
            raise CctpHyperCoreError(f"Invalid recipient address: {recipient!r}")

        amount_raw = int(round(amount_human * (10**USDC_DECIMALS)))
        usdc = self.get_source_usdc(from_chain)
        finality = FINALITY_FAST if fast else FINALITY_STANDARD
        max_fee = await self.get_fast_fee(from_chain, amount_raw) if fast else 0

        approve_tx = self._build_approve(usdc, TOKEN_MESSENGER_V2, amount_raw)
        burn_tx = self._build_burn(amount_raw, recipient, usdc, max_fee, finality)

        return CctpBurnQuote(
            from_chain=from_chain,
            recipient=recipient,
            input_amount=str(amount_raw),
            input_amount_human=amount_human,
            max_fee=max_fee,
            expected_output_human=(amount_raw - max_fee) / (10**USDC_DECIMALS),
            min_finality_threshold=finality,
            estimated_time=20 if fast else 15 * 60,
            approve_tx=approve_tx,
            burn_tx=burn_tx,
            raw={"source_domain": self.get_source_domain(from_chain)},
        )

    def _build_approve(self, usdc: str, spender: str, amount_raw: int) -> Dict[str, Any]:
        contract = Web3().eth.contract(address=Web3.to_checksum_address(usdc), abi=ERC20_ABI)
        data = contract.encode_abi("approve", args=[Web3.to_checksum_address(spender), amount_raw])
        return {"to": Web3.to_checksum_address(usdc), "data": data, "value": 0}

    def _build_burn(
        self, amount_raw: int, recipient: str, usdc: str, max_fee: int, finality: int
    ) -> Dict[str, Any]:
        contract = Web3().eth.contract(
            address=Web3.to_checksum_address(TOKEN_MESSENGER_V2), abi=TOKEN_MESSENGER_V2_ABI
        )
        data = contract.encode_abi(
            "depositForBurn",
            args=[
                amount_raw,
                HYPEREVM_CCTP_DOMAIN,
                _to_bytes32(recipient),
                Web3.to_checksum_address(usdc),
                b"\x00" * 32,  # destinationCaller = anyone may relay
                max_fee,
                finality,
            ],
        )
        return {"to": Web3.to_checksum_address(TOKEN_MESSENGER_V2), "data": data, "value": 0}

    async def get_attestation(
        self,
        from_chain: str,
        burn_tx_hash: str,
        max_attempts: int = 60,
        poll_interval: int = 2,
    ) -> CctpAttestation:
        """Poll Circle Iris V2 for the attestation over a burn tx's message."""
        src_domain = self.get_source_domain(from_chain)
        session = await get_session()
        url = f"{IRIS_V2_BASE}/messages/{src_domain}"

        for _ in range(max_attempts):
            await api_limiter.wait_and_acquire("cctp")
            try:
                async with session.get(url, params={"transactionHash": burn_tx_hash}) as resp:
                    if resp.status == 404:
                        await asyncio.sleep(poll_interval)
                        continue
                    if resp.status != 200:
                        await asyncio.sleep(poll_interval)
                        continue
                    data = await resp.json()
            except Exception as e:  # noqa: BLE001
                logger.warning("CCTP attestation poll error: %s", e)
                await asyncio.sleep(poll_interval)
                continue

            msgs = data.get("messages") or []
            if msgs:
                m = msgs[0]
                if m.get("status") == "complete" and m.get("attestation") and m.get("message"):
                    return CctpAttestation(
                        status="complete",
                        message=m["message"],
                        attestation=m["attestation"],
                    )
            await asyncio.sleep(poll_interval)

        return CctpAttestation(status="pending", message=None, attestation=None)

    def build_receive_tx(self, attestation: CctpAttestation) -> Dict[str, Any]:
        """Build the HyperEVM `receiveMessage` tx that mints native USDC.

        Runs on HyperEVM and costs HYPE gas — must be sent by a HYPE-funded
        relayer (see module docstring).
        """
        if not attestation.is_complete:
            raise CctpHyperCoreError("Attestation not complete; cannot build receive tx")
        contract = Web3().eth.contract(
            address=Web3.to_checksum_address(MESSAGE_TRANSMITTER_V2),
            abi=MESSAGE_TRANSMITTER_V2_ABI,
        )
        data = contract.encode_abi(
            "receiveMessage",
            args=[
                Web3.to_bytes(hexstr=attestation.message),
                Web3.to_bytes(hexstr=attestation.attestation),
            ],
        )
        return {"to": Web3.to_checksum_address(MESSAGE_TRANSMITTER_V2), "data": data, "value": 0}

    def usdc_balance_of(self, web3, address: str) -> int:
        """Native-USDC balance (smallest units) of `address` on HyperEVM."""
        contract = web3.eth.contract(
            address=Web3.to_checksum_address(HYPEREVM_NATIVE_USDC), abi=ERC20_ABI
        )
        return int(contract.functions.balanceOf(Web3.to_checksum_address(address)).call())

    def build_core_credit_tx(self, amount_raw: int) -> Dict[str, Any]:
        """Build the HyperEVM->HyperCore credit (ERC20 transfer to system addr).

        Sends minted native USDC to the USDC system address, crediting the
        sender's HyperCore *spot* balance. Runs on HyperEVM (HYPE gas).
        """
        contract = Web3().eth.contract(
            address=Web3.to_checksum_address(HYPEREVM_NATIVE_USDC), abi=ERC20_ABI
        )
        data = contract.encode_abi(
            "transfer",
            args=[Web3.to_checksum_address(HYPERCORE_USDC_SYSTEM_ADDRESS), amount_raw],
        )
        return {"to": Web3.to_checksum_address(HYPEREVM_NATIVE_USDC), "data": data, "value": 0}


# Global instance.
cctp_hypercore = CctpHyperCoreAPI()
