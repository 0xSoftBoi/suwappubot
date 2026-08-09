"""Seed list of OFAC-sanctioned EVM addresses + optional file loader.

This is a *seed* subset of well-documented OFAC SDN-designated Ethereum
addresses (Tornado Cash mixer contracts and related, designated Aug 2022),
not an exhaustive sanctions list. It exists so the compliance gate has a
meaningful default blocklist with zero external dependencies — the UBS ×
Nethermind PoC equivalent of "block these addresses".

For production, extend it from a maintained feed:
  - Point ``COMPLIANCE_OFAC_LIST_PATH`` at a newline-delimited file of
    addresses (refreshed from the OFAC SDN crypto list), or
  - Add addresses via ``COMPLIANCE_BLOCKLIST`` in settings, or
  - Swap in a commercial screening API (Chainalysis / TRM) behind the same
    ``AddressComplianceService.screen_*`` interface.

All addresses are stored lowercased for O(1) membership checks.
"""

from __future__ import annotations

import logging
from typing import Iterable, Set

logger = logging.getLogger(__name__)


# Documented OFAC SDN-designated Ethereum addresses (Tornado Cash et al.).
# Lowercased. This is a curated seed subset — see module docstring.
_SEED_OFAC_ADDRESSES: tuple[str, ...] = (
    "0x8589427373d6d84e98730d7795d8f6f8731fda16",  # Tornado.Cash: Donation
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",  # Tornado.Cash: Router / proxy
    "0xdd4c48c0b24039969fc16d1cdf626eab821d3384",  # Tornado.Cash pool
    "0xd96f2b1c14db8458374d9aca76e26c3d18364307",  # Tornado.Cash pool
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d",  # Tornado.Cash pool
    "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3",  # Tornado.Cash: 100 ETH
    "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",  # Tornado.Cash: 10 ETH
    "0xa160cdab225685da1d56aa342ad8841c3b53f291",  # Tornado.Cash: 100 ETH
    "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",  # Tornado.Cash
    "0x07687e702b410fa43f4cb4af7fa097918ffd2730",  # Tornado.Cash
    "0x23773e65ed146a459791799d01336db287f25334",  # Tornado.Cash
    "0x8281aa6795ade17c8973e1aedca380b7c8e7c1a6",  # Tornado.Cash
    "0x178169b423a011fff22b9e3f3abea13414ddd0f1",  # Tornado.Cash
    "0x610b717796ad172b316836ac95a2ffad065ceab4",  # Tornado.Cash
    "0xbb93e510bbcd0b7beb5a853875f9ec60275cf498",  # Tornado.Cash
)


def seed_ofac_addresses() -> Set[str]:
    """Return the bundled seed set of sanctioned addresses (lowercased)."""
    return set(_SEED_OFAC_ADDRESSES)


def _normalize(addr: str) -> str:
    """Canonical key for a sanctioned address.

    EVM hex is case-insensitive so it is lowercased. TRON base58check (``T…``,
    34 chars) is CASE-SENSITIVE — lowercasing one produces a key that can never
    match a real address, silently disabling the screen for exactly the rail
    (USDT-TRC20) that OFAC listings most often name. Must stay in step with
    ``compliance_service._normalize_address``.
    """
    v = addr.strip()
    if len(v) == 34 and v.startswith("T"):
        return v
    return v.lower()


def load_ofac_addresses(extra_path: str | None = None) -> Set[str]:
    """Build the full sanctioned-address set: seed + optional file.

    Args:
        extra_path: Path to a newline-delimited file of addresses (``#`` and
            blank lines ignored). Missing/unreadable file is logged and skipped
            — screening must degrade gracefully, never crash the swap path.

    Returns:
        Lowercased set of sanctioned EVM addresses.
    """
    addresses = seed_ofac_addresses()

    if extra_path:
        try:
            with open(extra_path, "r", encoding="utf-8") as fh:
                loaded = _parse_address_lines(fh)
            addresses.update(loaded)
            logger.info(
                "Loaded %d sanctioned address(es) from %s (total %d)",
                len(loaded),
                extra_path,
                len(addresses),
            )
        except FileNotFoundError:
            logger.warning("OFAC list path not found, using seed only: %s", extra_path)
        except OSError as exc:
            logger.warning("Could not read OFAC list %s: %s (using seed only)", extra_path, exc)

    return addresses


def _parse_address_lines(lines: Iterable[str]) -> Set[str]:
    """Parse address-per-line text, skipping comments/blanks. Keeps 0x… only."""
    out: Set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Tolerate "address, label" or "address  # label" rows.
        token = line.split(",")[0].split()[0]
        norm = _normalize(token)
        if norm.startswith("0x") and len(norm) == 42:
            out.add(norm)
    return out
