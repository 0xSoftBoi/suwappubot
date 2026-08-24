"""Circle CCTP (Cross-Chain Transfer Protocol) client for native USDC bridging.

CCTP enables native USDC transfers across chains with ZERO bridge fees.
Only gas costs apply - this is the cheapest way to move USDC cross-chain.

Flow:
1. Burn USDC on source chain via TokenMessenger
2. Wait for Circle attestation (~1-2 minutes)
3. Mint USDC on destination chain via MessageTransmitter
"""

import logging
import asyncio
from enum import Enum
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from web3 import Web3

from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Circle CCTP Attestation API -- V1 only. V2 attestations live under a
# different shape (see IRIS_V2_BASE below / cctp_hypercore.py's IRIS_V2_BASE):
# keyed by SOURCE DOMAIN + burn tx hash, not by a v1 message hash.
CCTP_ATTESTATION_API = "https://iris-api.circle.com/attestations"

# Circle Iris V2 API (messages + fees), same base cctp_hypercore.py uses.
IRIS_V2_BASE = "https://iris-api.circle.com/v2"


class CCTPTransferMode(str, Enum):
    """CCTP V2 finality mode.

    STANDARD -> minFinalityThreshold=2000 (hard finality, minutes, gas-only).
    FAST     -> minFinalityThreshold<=1000 (soft finality, ~8-20s). This is a
                PAID tier: the live Circle Fast fee is charged, capped by
                `maxFee`. If the live fee exceeds the cap, the mint degrades
                toward Standard rather than failing.
    """

    STANDARD = "standard"
    FAST = "fast"


# minFinalityThreshold values per Circle's CCTP V2 docs.
CCTP_V2_FINALITY_THRESHOLD = {
    CCTPTransferMode.FAST: 1000,  # "<=1000 => Fast Transfer"
    CCTPTransferMode.STANDARD: 2000,  # "2000 => Standard Transfer"
}

# CCTP Domain IDs (Circle's chain identifiers). Same numbering for V1 and V2 --
# Circle did not renumber domains when V2 launched.
#
# Solana, Sui, Aptos, Noble, Unichain, Linea, World Chain, Sonic, Codex, and
# Cronos are confirmed-live V2 domains too, but we only add domain metadata for
# chains we can either (a) execute an EVM depositForBurn on, or (b) explicitly
# fail closed for (Solana -- see build_burn_transaction_v2). We deliberately do
# NOT add Sui/Aptos/Noble/Unichain/Linea/World Chain/Sonic/Codex/Cronos here
# because we have neither their TokenMessengerV2 addresses nor an execution
# path verified -- adding the domain ID alone without addresses would be an
# unverified guess.
#
# Tron is NOT supported by CCTP at all (confirmed) -- never add it.
# Arc's domain ID is UNVERIFIED against Circle's live domain list -- do NOT
# add it here without confirming against Circle's docs first.
# HyperEVM's CCTP V2 domain (19) is verified on-chain: MessageTransmitterV2's
# localDomain() returns 19 there -- see scripts/verify_onchain_constants.py,
# which also confirms both V2 contract addresses and every domain ID in
# CCTP_DOMAINS below against the live chains. Consistent with the rest of this
# repo -- bot/services/cctp_hypercore.py's HYPEREVM_CCTP_DOMAIN=19 already ships
# and is used in a live depositForBurn call, and that module's own "VERIFY
# before mainnet" flags are scoped only to the HyperEVM native-USDC token
# address and its HyperCore token index, NOT to the domain ID. So the domain
# ID itself is not the open question. HyperEVM is still deliberately excluded
# from CCTP_DOMAINS here (not "unverified", but out of scope for this file):
# CCTP_DOMAINS/get_domain_id is used as *both* a source and a destination in
# this generic client, and this file has no HyperEVM native-USDC source
# address (NATIVE_USDC_ADDRESSES has no "hyperevm" entry) and no verified
# EVM execution path for burning *from* HyperEVM here. Adding just the domain
# ID without that would let is_supported_route() claim a route this client
# can't actually build a correct burn/mint tx for. If HyperEVM support is
# wanted in the generic rail, add the source USDC address + a verified
# execution path first, then add the domain -- don't add the domain alone.
CCTP_DOMAINS = {
    "ethereum": 0,
    "avalanche": 1,
    "optimism": 2,
    "arbitrum": 3,
    "base": 6,
    "polygon": 7,
}

# Solana domain ID (5) is a confirmed-live V2 domain, kept separate from
# CCTP_DOMAINS so it's never accidentally treated as an EVM-executable route.
# It exists purely as quote/domain metadata (e.g. as a *destination* domain for
# an EVM->Solana burn quote). Building a Solana-side burn tx is NOT supported
# (Solana CCTP requires the Solana program SDK, not web3.py/EVM ABI encoding)
# and fails closed -- see build_burn_transaction_v2().
CCTP_SOLANA_DOMAIN = 5

# TokenMessenger contract addresses (for burning USDC) -- V1.
TOKEN_MESSENGER_ADDRESSES = {
    "ethereum": "0xBd3fa81B58Ba92a82136038B25aDec7066af3155",
    "avalanche": "0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982",
    "optimism": "0x2B4069517957735bE00ceE0fadAE88a26365528f",
    "arbitrum": "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
    "base": "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
    "polygon": "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
}

# MessageTransmitter contract addresses (for receiving/minting USDC) -- V1.
MESSAGE_TRANSMITTER_ADDRESSES = {
    "ethereum": "0x0a992d191DEeC32aFe36203Ad87D7d289a738F81",
    "avalanche": "0x8186359aF5F57FbB40c6b14A588d2A59C0C29880",
    "optimism": "0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8",
    "arbitrum": "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    "base": "0xAD09780d193884d503182aD4588450C416D6F9D4",
    "polygon": "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
}

# CCTP V2 contracts -- the same address across all V2-supported EVM chains
# (verified against Circle's V2 docs; matches bot/services/cctp_hypercore.py's
# TOKEN_MESSENGER_V2 / MESSAGE_TRANSMITTER_V2 constants).
TOKEN_MESSENGER_V2_ADDRESS = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
MESSAGE_TRANSMITTER_V2_ADDRESS = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"

# Native USDC addresses on each chain
NATIVE_USDC_ADDRESSES = {
    "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "avalanche": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
}

# TokenMessenger ABI (minimal for depositForBurn)
TOKEN_MESSENGER_ABI = [
    {
        "inputs": [
            {"name": "amount", "type": "uint256"},
            {"name": "destinationDomain", "type": "uint32"},
            {"name": "mintRecipient", "type": "bytes32"},
            {"name": "burnToken", "type": "address"},
        ],
        "name": "depositForBurn",
        "outputs": [{"name": "nonce", "type": "uint64"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

# TokenMessengerV2 ABI (7-arg depositForBurn: adds destinationCaller, maxFee,
# minFinalityThreshold vs V1). V2 also drops the `nonce` return value.
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

# MessageTransmitter ABI (minimal for receiveMessage + the authoritative
# on-chain idempotency check). `usedNonces(bytes32) -> uint256` is the ONLY
# reliable way to know whether a message's nonce has already been consumed --
# selector 0xfeb61724, confirmed live on base/arbitrum/ethereum (unused nonce
# returns 0, a consumed one returns non-zero). Revert-string matching on a
# broadcast error is NOT a substitute for this: broadcast errors are
# dominated by ordinary EOA transaction-nonce collisions, which several RPC
# providers phrase as literally "nonce already used" -- matching that text
# would falsely mark a deposit "minted" with no mint having happened.
MESSAGE_TRANSMITTER_ABI = [
    {
        "inputs": [{"name": "message", "type": "bytes"}, {"name": "attestation", "type": "bytes"}],
        "name": "receiveMessage",
        "outputs": [{"name": "success", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "nonce", "type": "bytes32"}],
        "name": "usedNonces",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

# usedNonces(bytes32) selector, for callers that want a raw eth_call instead
# of instantiating a web3 Contract (e.g. from a thread pool without a running
# event loop). Keccak("usedNonces(bytes32)")[:4] == 0xfeb61724.
USED_NONCES_SELECTOR = "0xfeb61724"

# ERC20 approve ABI
ERC20_APPROVE_ABI = [
    {
        "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


@dataclass
class CCTPQuote:
    """Quote for Circle CCTP transfer."""

    from_chain: str
    to_chain: str
    from_amount: str
    to_amount: str  # Same as from_amount (1:1 for native USDC)
    to_amount_human: float
    gas_cost_usd: float
    bridge_fee_usd: float  # Always 0 for CCTP
    total_cost_usd: float
    estimated_time: int  # seconds
    token_messenger: str
    message_transmitter: str
    destination_domain: int
    usdc_address: str
    raw_data: Dict[str, Any]
    # V2 fields (unset/default for V1 quotes -- kept optional so existing V1
    # callers building a CCTPQuote positionally/by-keyword don't break).
    version: int = 1
    mode: Optional[str] = None  # "standard" | "fast", only set for V2 quotes
    min_finality_threshold: Optional[int] = None
    max_fee: Optional[int] = None  # raw USDC units (6dp), only set for V2 Fast


@dataclass
class CCTPStatus:
    """Status of a CCTP transfer."""

    message_hash: str
    status: str  # PENDING, ATTESTED, COMPLETE, FAILED
    attestation: Optional[str]
    raw_response: Dict[str, Any]


class CCTPError(Exception):
    """Exception for CCTP errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class CircleCCTPAPI:
    """Client for Circle CCTP native USDC bridging.

    CCTP is the cheapest way to bridge USDC cross-chain because:
    - Zero bridge fee (only gas)
    - Native USDC on both chains (no wrapped tokens)
    - Backed by Circle directly
    """

    def __init__(self):
        self.attestation_url = CCTP_ATTESTATION_API

    def is_supported_route(self, from_chain: str, to_chain: str, token: str) -> bool:
        """Check if CCTP supports this route."""
        if token.upper() != "USDC":
            return False
        return (
            from_chain.lower() in CCTP_DOMAINS
            and to_chain.lower() in CCTP_DOMAINS
            and from_chain.lower() != to_chain.lower()
        )

    def get_supported_chains(self) -> List[str]:
        """Get list of CCTP-supported chains."""
        return list(CCTP_DOMAINS.keys())

    def get_domain_id(self, chain: str) -> int:
        """Get CCTP domain ID for a chain."""
        domain = CCTP_DOMAINS.get(chain.lower())
        if domain is None:
            raise CCTPError(f"Chain not supported by CCTP: {chain}")
        return domain

    def get_token_messenger(self, chain: str, version: int = 1) -> str:
        """Get TokenMessenger address for a chain. version=2 returns TokenMessengerV2
        (same address across all V2-supported EVM chains); version=1 keeps the
        legacy per-chain V1 addresses."""
        if version == 2:
            if chain.lower() not in CCTP_DOMAINS:
                raise CCTPError(f"No TokenMessengerV2 for chain: {chain}")
            return TOKEN_MESSENGER_V2_ADDRESS
        address = TOKEN_MESSENGER_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No TokenMessenger for chain: {chain}")
        return address

    def get_message_transmitter(self, chain: str, version: int = 1) -> str:
        """Get MessageTransmitter address for a chain. version=2 returns
        MessageTransmitterV2 (same address across all V2-supported EVM chains)."""
        if version == 2:
            if chain.lower() not in CCTP_DOMAINS:
                raise CCTPError(f"No MessageTransmitterV2 for chain: {chain}")
            return MESSAGE_TRANSMITTER_V2_ADDRESS
        address = MESSAGE_TRANSMITTER_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No MessageTransmitter for chain: {chain}")
        return address

    def get_usdc_address(self, chain: str) -> str:
        """Get native USDC address for a chain."""
        address = NATIVE_USDC_ADDRESSES.get(chain.lower())
        if not address:
            raise CCTPError(f"No native USDC on chain: {chain}")
        return address

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        amount: str,
        slippage: float = 0.5,
        version: Optional[int] = None,
        mode: Optional["CCTPTransferMode"] = None,
    ) -> CCTPQuote:
        """
        Get a quote for CCTP USDC transfer.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            amount: Amount in smallest unit (6 decimals for USDC)
            slippage: Not used for CCTP (always 1:1)
            version: 1 or 2. Defaults to settings.cctp_v2_enabled (2 unless disabled).
            mode: CCTPTransferMode.STANDARD or .FAST. Only meaningful for version=2.
                  Defaults to settings.cctp_v2_default_mode ("standard").

        Returns:
            CCTPQuote with transfer details
        """
        if not self.is_supported_route(from_chain, to_chain, "USDC"):
            raise CCTPError(f"Route not supported: USDC from {from_chain} to {to_chain}")

        resolved_version = (
            version
            if version is not None
            else (2 if getattr(settings, "cctp_v2_enabled", True) else 1)
        )

        # Get addresses
        token_messenger = self.get_token_messenger(from_chain, version=resolved_version)
        message_transmitter = self.get_message_transmitter(to_chain, version=resolved_version)
        dest_domain = self.get_domain_id(to_chain)
        usdc_address = self.get_usdc_address(from_chain)

        # CCTP is 1:1 for USDC EXCEPT V2 Fast Transfer, where Circle deducts a
        # live fee (capped by maxFee) from the burned amount at mint time --
        # the recipient only ever gets amount - fee, never the full amount.
        # This is computed below once max_fee is known (raw-unit integer math).

        # Estimate gas cost (varies by chain)
        gas_estimates_usd = {
            "ethereum": 5.0,
            "arbitrum": 0.30,
            "optimism": 0.30,
            "base": 0.20,
            "polygon": 0.10,
            "avalanche": 0.50,
        }
        gas_cost = gas_estimates_usd.get(from_chain.lower(), 1.0)

        quote_mode: Optional[str] = None
        min_finality: Optional[int] = None
        max_fee: Optional[int] = None
        estimated_time = 120  # ~2 minutes for attestation (V1 / Standard)

        if resolved_version == 2:
            resolved_mode = mode
            if resolved_mode is None:
                raw_mode = str(getattr(settings, "cctp_v2_default_mode", "standard") or "standard")
                resolved_mode = (
                    CCTPTransferMode.FAST
                    if raw_mode.lower() == "fast"
                    else CCTPTransferMode.STANDARD
                )
            quote_mode = resolved_mode.value
            min_finality = CCTP_V2_FINALITY_THRESHOLD[resolved_mode]

            if resolved_mode == CCTPTransferMode.FAST:
                estimated_time = 20  # ~8-20s soft finality
                max_fee = self._compute_bounded_max_fee(amount)
                if max_fee is None:
                    raise CCTPError(
                        "Fast Transfer requested but no bounded maxFee is configured "
                        "(settings.cctp_v2_max_fast_fee_bps is unset/zero). Refusing to "
                        "submit a Fast transfer without an explicit fee cap -- set "
                        "cctp_v2_max_fast_fee_bps or use Standard mode."
                    )
            else:
                max_fee = 0  # Standard transfers do not charge a Fast fee.

        # Integer math on raw (6dp) units: Fast deducts max_fee from the
        # burned amount at mint; Standard mints the full amount 1:1.
        amount_int = int(amount)
        to_amount_raw = amount_int - int(max_fee) if max_fee else amount_int
        if to_amount_raw < 0:
            raise CCTPError("CCTP quote: maxFee exceeds transfer amount")
        to_amount_str = str(to_amount_raw)
        bridge_fee_usd = (int(max_fee) / 1e6) if max_fee else 0.0

        return CCTPQuote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_amount=amount,
            to_amount=to_amount_str,  # 1:1 minus any Fast-mode maxFee
            to_amount_human=to_amount_raw / 1e6,
            gas_cost_usd=gas_cost,
            bridge_fee_usd=bridge_fee_usd,  # live Circle Fast fee; 0 for Standard
            total_cost_usd=gas_cost + bridge_fee_usd,
            estimated_time=estimated_time,
            token_messenger=token_messenger,
            message_transmitter=message_transmitter,
            destination_domain=dest_domain,
            usdc_address=usdc_address,
            raw_data={
                "provider": "cctp",
                "from_domain": self.get_domain_id(from_chain),
                "to_domain": dest_domain,
            },
            version=resolved_version,
            mode=quote_mode,
            min_finality_threshold=min_finality,
            max_fee=max_fee,
        )

    @staticmethod
    def _compute_bounded_max_fee(amount: str) -> Optional[int]:
        """Compute a bounded maxFee (raw USDC units) from cctp_v2_max_fast_fee_bps.

        Returns None if the bps cap is unset or zero -- callers MUST treat that
        as "refuse to submit a Fast transfer", never as "use zero/unbounded fee".
        Integer math only (amounts are raw-unit strings).
        """
        bps = int(getattr(settings, "cctp_v2_max_fast_fee_bps", 0) or 0)
        if bps <= 0:
            return None
        amount_int = int(amount)
        if amount_int <= 0:
            return None
        max_fee = (amount_int * bps) // 10_000
        # A cap that rounds down to zero is still "unbounded" in effect (any
        # nonzero live fee would exceed it and silently degrade to Standard,
        # but we'd rather fail closed than emit a 0-fee Fast quote).
        if max_fee <= 0:
            return None
        return max_fee

    def build_approve_transaction(
        self,
        quote: CCTPQuote,
        from_address: str,
    ) -> Dict[str, Any]:
        """Build USDC approval transaction for TokenMessenger."""
        usdc_contract = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.usdc_address), abi=ERC20_APPROVE_ABI
        )

        data = usdc_contract.encode_abi(
            "approve",
            args=[Web3.to_checksum_address(quote.token_messenger), int(quote.from_amount)],
        )

        return {
            "to": Web3.to_checksum_address(quote.usdc_address),
            "data": data,
            "value": 0,
        }

    def build_burn_transaction(
        self,
        quote: CCTPQuote,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build the depositForBurn transaction for CCTP.

        Dispatches on quote.version: V2 quotes (the default) build the 7-arg
        TokenMessengerV2.depositForBurn call; V1 quotes (rollback / explicit
        version=1) keep using the legacy 4-arg call. The V1 code path below is
        intentionally left intact and reachable.

        Args:
            quote: CCTPQuote from get_quote
            from_address: Sender address
            to_address: Recipient address (defaults to from_address)

        Returns:
            Transaction dict ready for signing
        """
        if getattr(quote, "version", 1) == 2:
            return self.build_burn_transaction_v2(quote, from_address, to_address)

        to_address = to_address or from_address

        if quote.from_chain.lower() == "solana" or quote.to_chain.lower() == "solana":
            raise CCTPError(
                "Solana CCTP burns require the Solana program SDK, not an EVM "
                "depositForBurn call. Not supported by this client."
            )

        # Convert recipient to bytes32 (padded address)
        recipient_bytes32 = Web3.to_bytes(hexstr=to_address).rjust(32, b"\x00")

        token_messenger = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.token_messenger), abi=TOKEN_MESSENGER_ABI
        )

        data = token_messenger.encode_abi(
            "depositForBurn",
            args=[
                int(quote.from_amount),
                quote.destination_domain,
                recipient_bytes32,
                Web3.to_checksum_address(quote.usdc_address),
            ],
        )

        return {
            "to": Web3.to_checksum_address(quote.token_messenger),
            "data": data,
            "value": 0,
        }

    def build_burn_transaction_v2(
        self,
        quote: CCTPQuote,
        from_address: str,
        to_address: Optional[str] = None,
        destination_caller: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build the TokenMessengerV2.depositForBurn transaction (7-arg signature):
        depositForBurn(amount, destinationDomain, mintRecipient, burnToken,
                        destinationCaller, maxFee, minFinalityThreshold).

        Fails closed:
          - Refuses to build a burn where source or destination is Solana (no
            EVM ABI-encoded path exists for Solana CCTP; needs the Solana SDK).
          - Refuses Fast-mode (minFinalityThreshold<=1000) transactions unless
            quote.max_fee is a positive, explicitly-bounded value.

        Args:
            quote: CCTPQuote from get_quote (must have version=2)
            from_address: Sender address (used only for Solana-guard messaging)
            to_address: Recipient address (defaults to from_address)
            destination_caller: Optional address restricted to call receiveMessage
                on the destination. bytes32(0) (anyone can call) if not set.

        Returns:
            Transaction dict ready for signing
        """
        if quote.from_chain.lower() == "solana" or quote.to_chain.lower() == "solana":
            raise CCTPError(
                "Solana CCTP burns require the Solana program SDK (non-EVM), not "
                "web3.py ABI encoding. This client only builds EVM depositForBurn "
                "transactions -- Solana is domain/quote metadata only."
            )

        to_address = to_address or from_address
        min_finality = quote.min_finality_threshold
        if min_finality is None:
            raise CCTPError("V2 quote is missing min_finality_threshold; refusing to build tx.")
        if min_finality not in (
            CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.FAST],
            CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.STANDARD],
        ):
            # Circle only defines two valid tiers (1000=Fast, 2000=Standard).
            # A value like 1500 is "soft finality, Circle still charges a
            # fee" -- treating anything <=1000 as the only "fast" case and
            # silently forcing maxFee=0 for everything else would degrade an
            # implicitly-paid soft-finality transfer to a free hard-finality
            # one without ever charging (or disclosing) the fee it promised.
            # Fail closed instead of guessing.
            raise CCTPError(
                f"Unsupported min_finality_threshold={min_finality!r}; must be "
                f"{CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.FAST]} (Fast) or "
                f"{CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.STANDARD]} (Standard)."
            )

        is_fast = min_finality <= 1000
        max_fee = quote.max_fee
        if is_fast and (max_fee is None or int(max_fee) <= 0):
            raise CCTPError(
                "Fast Transfer (minFinalityThreshold<=1000) requires an explicit, "
                "positive maxFee cap. Refusing to submit with an unset or zero "
                "maxFee -- this would allow the mint to be executed for an "
                "unbounded/silent fee."
            )
        if not is_fast:
            # Standard transfers still pass maxFee=0 per Circle's V2 interface
            # (no Fast fee applies at hard finality).
            max_fee = 0

        recipient_bytes32 = Web3.to_bytes(hexstr=to_address).rjust(32, b"\x00")
        dest_caller_bytes32 = (
            Web3.to_bytes(hexstr=destination_caller).rjust(32, b"\x00")
            if destination_caller
            else b"\x00" * 32
        )

        token_messenger = Web3().eth.contract(
            address=Web3.to_checksum_address(quote.token_messenger),
            abi=TOKEN_MESSENGER_V2_ABI,
        )

        data = token_messenger.encode_abi(
            "depositForBurn",
            args=[
                int(quote.from_amount),
                quote.destination_domain,
                recipient_bytes32,
                Web3.to_checksum_address(quote.usdc_address),
                dest_caller_bytes32,
                int(max_fee),
                int(min_finality),
            ],
        )

        return {
            "to": Web3.to_checksum_address(quote.token_messenger),
            "data": data,
            "value": 0,
        }

    @staticmethod
    def message_nonce_bytes32(message: bytes) -> bytes:
        """Extract the 32-byte nonce from a CCTP V2 message.

        V2 message header layout: version(4) | sourceDomain(4) |
        destinationDomain(4) | nonce(32) | ... -- so the nonce is
        message[12:44]. This is the value MessageTransmitterV2.usedNonces
        expects, and is the authoritative key for on-chain idempotency
        (see MESSAGE_TRANSMITTER_ABI's usedNonces entry).
        """
        if len(message) < 44:
            raise CCTPError(
                f"CCTP V2 message too short to contain a nonce ({len(message)} bytes, need >= 44)"
            )
        return message[12:44]

    def is_nonce_used(self, web3, to_chain: str, nonce: bytes, version: int = 2) -> bool:
        """Authoritative on-chain check: has this message's nonce already been
        consumed by MessageTransmitterV2.usedNonces on `to_chain`?

        Synchronous (plain eth_call) -- callers on the async path should wrap
        this in `asyncio.to_thread`. Never infer this from a revert string;
        always ask the contract directly.
        """
        if len(nonce) != 32:
            raise CCTPError(f"CCTP nonce must be 32 bytes, got {len(nonce)}")
        mt_addr = self.get_message_transmitter(to_chain, version=version)
        data = USED_NONCES_SELECTOR + nonce.hex()
        result = web3.eth.call({"to": Web3.to_checksum_address(mt_addr), "data": data})
        return int.from_bytes(bytes(result), "big") != 0

    async def get_attestation(
        self,
        message_hash: str,
        max_attempts: int = 60,
        poll_interval: int = 2,
        version: int = 1,
    ) -> CCTPStatus:
        """
        Wait for and retrieve Circle attestation for a burn transaction.

        V1-ONLY. A V2 burn (TokenMessengerV2.depositForBurn, the default since
        get_quote defaults to version=2) is NOT queryable via the v1
        `/attestations/{message_hash}` endpoint used here -- Circle keys V2
        attestations by source domain + burn tx hash under `/v2/messages/...`
        (see `get_attestation_v2`). Silently polling this v1 endpoint for a
        v2 transfer 404s every attempt and returns status="PENDING" forever,
        which looks like "still confirming" instead of "wrong endpoint" --
        fail loud instead: pass version=2 (or call get_attestation_v2
        directly) and this raises rather than polling uselessly.

        Args:
            message_hash: The message hash from the burn transaction logs
            max_attempts: Maximum polling attempts
            poll_interval: Seconds between polls
            version: Must be 1. Passing 2 raises immediately -- use
                get_attestation_v2(from_chain, burn_tx_hash) instead.

        Returns:
            CCTPStatus with attestation if available
        """
        if version == 2:
            raise CCTPError(
                "get_attestation() is the V1 Iris client and cannot resolve a V2 "
                "attestation from a v1 message_hash. Use get_attestation_v2(from_chain, "
                "burn_tx_hash) instead -- V2 is keyed by source domain + burn tx hash, "
                "not a v1 message hash."
            )
        if version != 1:
            raise CCTPError(f"get_attestation: unsupported version {version!r} (must be 1 or 2)")

        session = await get_session()

        for attempt in range(max_attempts):
            await api_limiter.wait_and_acquire("cctp")

            url = f"{self.attestation_url}/{message_hash}"

            try:
                async with session.get(url) as response:
                    if response.status == 404:
                        # Not ready yet
                        await asyncio.sleep(poll_interval)
                        continue

                    data = await response.json()

                    status = data.get("status", "pending")
                    attestation = data.get("attestation")

                    if status == "complete" and attestation:
                        return CCTPStatus(
                            message_hash=message_hash,
                            status="ATTESTED",
                            attestation=attestation,
                            raw_response=data,
                        )

                    await asyncio.sleep(poll_interval)

            except Exception as e:
                logger.warning(f"Attestation poll error: {e}")
                await asyncio.sleep(poll_interval)

        return CCTPStatus(
            message_hash=message_hash,
            status="PENDING",
            attestation=None,
            raw_response={},
        )

    async def get_attestation_v2(
        self,
        from_chain: str,
        burn_tx_hash: str,
        max_attempts: int = 60,
        poll_interval: int = 2,
    ) -> CCTPStatus:
        """
        Poll Circle Iris V2 for the attestation over a V2 burn message.

        V2 is keyed by SOURCE DOMAIN + burn tx hash (not a v1 message hash),
        via `/v2/messages/{sourceDomainId}?transactionHash=...`. Mirrors
        `bot.services.cctp_hypercore.CctpHyperCoreAPI.get_attestation`.

        Args:
            from_chain: Source chain name (used to resolve the source domain)
            burn_tx_hash: The depositForBurn transaction hash
            max_attempts: Maximum polling attempts
            poll_interval: Seconds between polls

        Returns:
            CCTPStatus with attestation if available (message_hash field is
            repurposed to carry the burn tx hash for V2, and raw_response's
            "message" key carries the message bytes needed for receiveMessage).
        """
        src_domain = self.get_domain_id(from_chain)
        session = await get_session()
        url = f"{IRIS_V2_BASE}/messages/{src_domain}"

        for _attempt in range(max_attempts):
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
                logger.warning(f"CCTP V2 attestation poll error: {e}")
                await asyncio.sleep(poll_interval)
                continue

            msgs = data.get("messages") or []
            if msgs:
                m = msgs[0]
                if m.get("status") == "complete" and m.get("attestation") and m.get("message"):
                    return CCTPStatus(
                        message_hash=burn_tx_hash,
                        status="ATTESTED",
                        attestation=m["attestation"],
                        raw_response={**data, "message": m["message"]},
                    )
            await asyncio.sleep(poll_interval)

        return CCTPStatus(
            message_hash=burn_tx_hash,
            status="PENDING",
            attestation=None,
            raw_response={},
        )

    def build_receive_transaction(
        self,
        to_chain: str,
        message: bytes,
        attestation: str,
        version: Optional[int] = None,
        quote: Optional[CCTPQuote] = None,
    ) -> Dict[str, Any]:
        """
        Build the receiveMessage transaction to mint USDC on destination.

        A V2 burn (TokenMessengerV2.depositForBurn) is ONLY redeemable via
        MessageTransmitterV2 -- submitting its message/attestation to the V1
        MessageTransmitter reverts and the already-burned USDC becomes
        unmintable via this client. So the version used here MUST match the
        version used to build the burn. Prefer passing `quote` (the same
        CCTPQuote returned by get_quote for this transfer) -- its
        `message_transmitter` field already carries the correct
        version-matched address and is used verbatim. Falls back to
        `version` (resolved the same way get_quote resolves it, via
        settings.cctp_v2_enabled) only if no quote is available.

        Args:
            to_chain: Destination chain name
            message: Original message bytes from burn tx
            attestation: Attestation from Circle API
            version: 1 or 2. Only consulted if `quote` isn't passed. Defaults
                to settings.cctp_v2_enabled, same as get_quote.
            quote: The CCTPQuote for this transfer, if available. Its
                `message_transmitter` address is used directly and takes
                precedence over `version`.

        Returns:
            Transaction dict ready for signing
        """
        if quote is not None:
            message_transmitter_addr = quote.message_transmitter
        else:
            resolved_version = (
                version
                if version is not None
                else (2 if getattr(settings, "cctp_v2_enabled", True) else 1)
            )
            message_transmitter_addr = self.get_message_transmitter(
                to_chain, version=resolved_version
            )

        message_transmitter = Web3().eth.contract(
            address=Web3.to_checksum_address(message_transmitter_addr), abi=MESSAGE_TRANSMITTER_ABI
        )

        data = message_transmitter.encode_abi(
            "receiveMessage", args=[message, Web3.to_bytes(hexstr=attestation)]
        )

        return {
            "to": Web3.to_checksum_address(message_transmitter_addr),
            "data": data,
            "value": 0,
        }

    @staticmethod
    def extract_message_hash_from_logs(logs: List[Dict]) -> Optional[str]:
        """Extract the message hash from burn transaction logs."""
        # MessageSent event topic
        MESSAGE_SENT_TOPIC = Web3.keccak(text="MessageSent(bytes)").hex()

        for log in logs:
            if log.get("topics") and log["topics"][0].hex() == MESSAGE_SENT_TOPIC:
                # The message is in the data field
                message_data = log.get("data", "0x")
                # Hash the message to get message_hash
                return Web3.keccak(hexstr=message_data).hex()

        return None


# Global instance
cctp_api = CircleCCTPAPI()
