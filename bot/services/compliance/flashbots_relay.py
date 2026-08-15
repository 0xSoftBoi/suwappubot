"""Flashbots private-transaction relay client — compliant routing (PoC stage 2).

The second half of the UBS × Nethermind PoC routes *approved* transactions
through relays to builders for reliable, private inclusion, instead of the
public mempool. This module is Suwappu's EVM equivalent of ``jito_api`` (which
already does this for Solana): it submits a signed transaction to the Flashbots
relay via ``eth_sendPrivateTransaction`` so it is delivered straight to block
builders rather than broadcast publicly.

Why route privately:
  * No public-mempool exposure → no front-running / sandwiching of the swap.
  * Builder-level inclusion control — the operator chooses the relay/builders
    that approved orderflow is sent to (the "select builders" of the PoC).

Auth model: Flashbots identifies searchers by an ECDSA signature over the
request body (header ``X-Flashbots-Signature: <address>:<sig>``). The signing
key is **purely an identity** — it never holds or moves funds, it only
accumulates relay reputation. Configure a stable one via
``FLASHBOTS_SIGNER_KEY``; if unset, an ephemeral key is generated per process
(submission still works, reputation just doesn't persist).

Scope: same-chain EVM swaps on chains with a Flashbots-compatible relay
(Ethereum mainnet by default; extra chain IDs + relay URL are configurable).
The caller (``SwapEngine``) always falls back to the public RPC path if the
relay is disabled, unsupported for the chain, or errors — routing can never
break a swap.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Optional, Set

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

from bot.config.settings import settings
from bot.utils.http_client import get_session

logger = logging.getLogger(__name__)

DEFAULT_RELAY_URL = "https://relay.flashbots.net"


def _normalize_hex(value: str) -> str:
    """Ensure a 0x-prefixed lowercase hex string."""
    v = value.strip()
    if not v.startswith("0x"):
        v = "0x" + v
    return v.lower()


def _parse_chain_ids(raw: str, default: Set[int]) -> Set[int]:
    out: Set[int] = set()
    for tok in (raw or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            out.add(int(tok))
        except ValueError:
            logger.warning("Ignoring invalid relay chain id %r", tok)
    return out or set(default)


@dataclass
class RelayResult:
    """Outcome of a private-transaction submission."""

    submitted: bool
    tx_hash: Optional[str] = None
    error: Optional[str] = None
    relay_url: Optional[str] = None


class FlashbotsRelay:
    """Submits signed EVM transactions privately to the Flashbots relay.

    Usage::

        if flashbots_relay.should_route(chain_id):
            result = await flashbots_relay.send_private_transaction(
                signed_tx_hex, chain_id, current_block
            )
            if result.submitted:
                return result.tx_hash
        # else: fall back to public send_raw_transaction
    """

    def __init__(self) -> None:
        self._signer: Optional[Account] = None
        self._signer_loaded = False

    # --- configuration -------------------------------------------------

    @property
    def enabled(self) -> bool:
        return bool(getattr(settings, "compliance_routing_enabled", False))

    @property
    def relay_url(self) -> str:
        return getattr(settings, "flashbots_relay_url", "") or DEFAULT_RELAY_URL

    @property
    def supported_chain_ids(self) -> Set[int]:
        return _parse_chain_ids(
            getattr(settings, "compliance_routing_chain_ids", "") or "", default={1}
        )

    @property
    def max_block_offset(self) -> int:
        try:
            return max(1, int(getattr(settings, "flashbots_max_block_offset", 25)))
        except (TypeError, ValueError):
            return 25

    def should_route(self, chain_id: Optional[int]) -> bool:
        """True if relay routing is enabled and supported for ``chain_id``."""
        return self.enabled and chain_id is not None and int(chain_id) in self.supported_chain_ids

    # --- signing identity ----------------------------------------------

    def _get_signer(self) -> Account:
        """Lazily resolve the relay auth-signing account (identity only)."""
        if self._signer_loaded:
            return self._signer
        key = (getattr(settings, "flashbots_signer_key", "") or "").strip()
        if key:
            self._signer = Account.from_key(_normalize_hex(key))
            logger.info("Flashbots relay using configured signer %s", self._signer.address)
        else:
            self._signer = Account.create()
            logger.info(
                "Flashbots relay using ephemeral signer %s (set FLASHBOTS_SIGNER_KEY "
                "to persist reputation)",
                self._signer.address,
            )
        self._signer_loaded = True
        return self._signer

    def _auth_header(self, body: str) -> str:
        """Build the ``X-Flashbots-Signature`` header for a request body."""
        signer = self._get_signer()
        message = encode_defunct(text="0x" + keccak(text=body).hex())
        signed = signer.sign_message(message)
        return f"{signer.address}:{_normalize_hex(signed.signature.hex())}"

    # --- submission ----------------------------------------------------

    @staticmethod
    def tx_hash_of(signed_tx_hex: str) -> str:
        """Compute the transaction hash of a signed raw tx locally."""
        raw = bytes.fromhex(signed_tx_hex.replace("0x", ""))
        return "0x" + keccak(raw).hex()

    async def send_private_transaction(
        self,
        signed_tx_hex: str,
        chain_id: int,
        current_block: Optional[int] = None,
    ) -> RelayResult:
        """Submit a signed tx privately via ``eth_sendPrivateTransaction``.

        Args:
            signed_tx_hex: The signed raw transaction (hex, 0x optional).
            chain_id: Chain the tx belongs to (informational/validation).
            current_block: Latest block number; the tx stays valid until
                ``current_block + max_block_offset``. Omitted → relay default.

        Returns:
            A :class:`RelayResult`. ``submitted=False`` with ``error`` set means
            the caller should fall back to the public RPC path.
        """
        if not self.should_route(chain_id):
            return RelayResult(submitted=False, error="relay not enabled for chain")

        raw = _normalize_hex(signed_tx_hex)
        tx: dict = {"tx": raw}
        if current_block is not None:
            tx["maxBlockNumber"] = hex(int(current_block) + self.max_block_offset)

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_sendPrivateTransaction",
            "params": [tx],
        }
        body = json.dumps(payload)

        try:
            headers = {
                "Content-Type": "application/json",
                "X-Flashbots-Signature": self._auth_header(body),
            }
            session = await get_session()
            async with session.post(self.relay_url, data=body, headers=headers) as resp:
                text = await resp.text()
                if resp.status != 200:
                    return RelayResult(
                        submitted=False,
                        error=f"relay HTTP {resp.status}: {text[:200]}",
                        relay_url=self.relay_url,
                    )
                data = json.loads(text)
        except Exception as exc:  # network / json / signing — fall back to public RPC
            logger.warning("Flashbots relay submission failed: %s", exc)
            return RelayResult(submitted=False, error=str(exc), relay_url=self.relay_url)

        if "error" in data and data["error"]:
            return RelayResult(
                submitted=False,
                error=str(data["error"]),
                relay_url=self.relay_url,
            )

        tx_hash = data.get("result") or self.tx_hash_of(raw)
        logger.info("Routed tx %s privately via %s", tx_hash, self.relay_url)
        return RelayResult(submitted=True, tx_hash=tx_hash, relay_url=self.relay_url)


# Global instance — mirrors the other service singletons.
flashbots_relay = FlashbotsRelay()
