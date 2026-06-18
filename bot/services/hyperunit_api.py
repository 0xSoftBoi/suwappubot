"""HyperUnit API client — native BTC / ETH / SOL deposits into HyperCore.

HyperUnit (https://hyperunit.xyz) is the canonical bridge for getting *native*
assets (not just USDC) onto HyperLiquid's HyperCore as spot balances. A user
sends e.g. real BTC to a deterministic, per-(asset, destination) deposit address
and HyperUnit's 2-of-3 MPC guardian set mints the spot equivalent (UBTC/UETH/...)
straight into the user's HyperCore account.

This client only *generates* the deposit address and *watches* the resulting
mint operation. It never holds keys or signs — the caller funds the returned
address through Suwappu's existing per-chain send path.

Trust model: HyperUnit is a federated 2-of-3 MPC (Unit, Hyperliquid Labs,
Infinite Field), NOT trustless. The /gen response carries one signature per
guardian over the address; we surface them so a caller can pin them against the
published guardian keys. Full key-pinning is a follow-up (the keys are published
out-of-band); until then we hard-enforce the documented per-asset minimums so a
user can never deposit below the loss threshold.

Docs: https://docs.hyperunit.xyz/developers/api/generate-address
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

HYPERUNIT_API_URL = "https://api.hyperunit.xyz"

# Destination chain value for HyperLiquid HyperCore in the /gen path.
HYPERUNIT_DST_CHAIN = "hyperliquid"

# HyperUnit is a 2-of-3 MPC; require at least this many guardian signatures on
# a generated deposit address before trusting it.
GUARDIAN_THRESHOLD = 2

# Supported native deposit assets -> the source chain HyperUnit expects.
# Keyed by the asset symbol the user picks; value is the /gen :src_chain segment.
HYPERUNIT_ASSETS: Dict[str, str] = {
    "btc": "bitcoin",
    "eth": "ethereum",
    "sol": "solana",
}

# Hard minimum deposit per asset. Below the loss threshold HyperUnit silently
# eats the deposit (network sweep dust), so we refuse anything under `min`.
# Sources: https://docs.hyperunit.xyz/how-to/deposit (mins) — values are in the
# asset's native units.
HYPERUNIT_MINIMUMS: Dict[str, float] = {
    "btc": 0.002,
    "eth": 0.05,
    "sol": 0.1,
}

# Rough expected mint latency per asset (seconds), for user-facing ETAs.
HYPERUNIT_ETA_SECONDS: Dict[str, int] = {
    "btc": 30 * 60,  # ~2 confirmations
    "eth": 5 * 60,
    "sol": 60,
}


class HyperUnitError(Exception):
    """Raised when the HyperUnit API returns an error or invalid response."""


@dataclass
class HyperUnitDepositAddress:
    """A generated HyperUnit deposit address for a single (asset -> HL account)."""

    asset: str  # normalized symbol, e.g. "btc"
    src_chain: str  # e.g. "bitcoin"
    hl_address: str  # destination HyperCore account (EVM address)
    address: str  # where the user must send the native asset
    signatures: Dict[str, str]  # guardian signatures over the address
    min_amount: float
    eta_seconds: int
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class HyperUnitOperation:
    """Status of an in-flight deposit (mint) operation."""

    state: str  # "done", "pending", ... (upstream-defined)
    destination_tx_hash: Optional[str]
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_done(self) -> bool:
        return str(self.state).lower() == "done"


def normalize_asset(asset: str) -> str:
    """Map a user-supplied asset/symbol to a supported HyperUnit asset key."""
    a = (asset or "").strip().lower()
    # accept a few common aliases
    aliases = {"bitcoin": "btc", "ethereum": "eth", "solana": "sol", "weth": "eth"}
    a = aliases.get(a, a)
    if a not in HYPERUNIT_ASSETS:
        raise HyperUnitError(f"Unsupported HyperUnit asset: {asset!r}")
    return a


def get_minimum(asset: str) -> float:
    """Minimum native-unit deposit for an asset (raises on unsupported asset)."""
    return HYPERUNIT_MINIMUMS[normalize_asset(asset)]


class HyperUnitAPI:
    """Client for HyperUnit native-asset deposits into HyperCore."""

    def __init__(self, api_url: str = HYPERUNIT_API_URL):
        self.api_url = api_url.rstrip("/")

    async def generate_deposit_address(
        self,
        asset: str,
        hl_address: str,
    ) -> HyperUnitDepositAddress:
        """Generate a deterministic deposit address for funding `hl_address`.

        Args:
            asset: native asset to deposit ("btc" / "eth" / "sol" or an alias).
            hl_address: the destination HyperCore account (EVM 0x address).

        Returns:
            HyperUnitDepositAddress with the address to send the native asset to.
        """
        asset_key = normalize_asset(asset)
        src_chain = HYPERUNIT_ASSETS[asset_key]

        if not hl_address or not hl_address.startswith("0x"):
            raise HyperUnitError(f"Invalid HyperLiquid destination address: {hl_address!r}")

        await api_limiter.wait_and_acquire("hyperunit")
        session = await get_session()

        url = f"{self.api_url}/gen/{src_chain}/{HYPERUNIT_DST_CHAIN}/{asset_key}/{hl_address}"
        async with session.get(url) as response:
            if response.status != 200:
                error_text = await response.text()
                raise HyperUnitError(f"HyperUnit gen error ({response.status}): {error_text}")
            data = await response.json()

        address = data.get("address")
        if not address:
            raise HyperUnitError(f"HyperUnit returned no deposit address: {data}")

        # Defensive: refuse to hand back an address unless the guardian set
        # acknowledged it. HyperUnit is a 2-of-3 MPC, so require at least
        # GUARDIAN_THRESHOLD non-empty signatures — a response with fewer means
        # the address isn't jointly attested and funds sent to it could be lost.
        status = str(data.get("status", "")).upper()
        signatures = data.get("signatures") or {}
        if status and status != "OK":
            raise HyperUnitError(f"HyperUnit address not OK (status={status}): {data}")
        valid_sigs = sum(1 for v in signatures.values() if v)
        if valid_sigs < GUARDIAN_THRESHOLD:
            raise HyperUnitError(
                f"HyperUnit address has only {valid_sigs} guardian signature(s); "
                f"need {GUARDIAN_THRESHOLD} (2-of-3 MPC). Refusing to use it."
            )

        return HyperUnitDepositAddress(
            asset=asset_key,
            src_chain=src_chain,
            hl_address=hl_address,
            address=address,
            signatures=signatures,
            min_amount=HYPERUNIT_MINIMUMS[asset_key],
            eta_seconds=HYPERUNIT_ETA_SECONDS[asset_key],
            raw=data,
        )

    async def get_operation(self, address: str) -> HyperUnitOperation:
        """Poll the status of the mint operation for a deposit address.

        Returns the latest operation; state "done" means the spot balance has
        been credited on HyperCore (see `destination_tx_hash`).
        """
        await api_limiter.wait_and_acquire("hyperunit")
        session = await get_session()

        url = f"{self.api_url}/operations/{address}"
        async with session.get(url) as response:
            if response.status == 404:
                # No operation yet — user hasn't sent funds (or not seen).
                return HyperUnitOperation(state="pending", destination_tx_hash=None, raw={})
            if response.status != 200:
                error_text = await response.text()
                raise HyperUnitError(
                    f"HyperUnit operations error ({response.status}): {error_text}"
                )
            data = await response.json()

        # The endpoint may return a single object or a list of operations; take
        # the most recent / most-progressed one.
        op = data
        if isinstance(data, dict) and isinstance(data.get("operations"), list):
            ops = data["operations"]
            op = ops[-1] if ops else {}
        elif isinstance(data, list):
            op = data[-1] if data else {}

        return HyperUnitOperation(
            state=str((op or {}).get("state", "pending")),
            destination_tx_hash=(op or {}).get("destinationTxHash"),
            raw=data if isinstance(data, dict) else {"operations": data},
        )


# Global instance (mirrors across_api / cctp_api singletons).
hyperunit_api = HyperUnitAPI()
