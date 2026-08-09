"""Seed list of OFAC-sanctioned EVM/TRON addresses + optional file loader.

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

# TODO(compliance): the file/env lists loaded here are static — there is no
# scheduled refresh job pulling the live OFAC SDN feed, so a list on disk
# silently goes stale. There is also no screening on bulk_pay/p2p transfers
# or CCTP bridge legs (only SwapEngine.execute_swap and the withdrawal path
# in hot_wallet.py call into AddressComplianceService today) — those surfaces
# can move funds unscreened. Both are tracked as known gaps, not implemented
# here.

Address-shape helpers live here (rather than duplicated per-caller) so the
list loader and ``AddressComplianceService`` always agree on what counts as
a "screenable" address and how it canonicalizes to a blocklist key.

All EVM addresses are stored lowercased for O(1) membership checks. TRON
addresses (base58check ``T…`` or hex ``41…``/``0x41…``) are canonicalized to
their 21-byte hex form so every equivalent representation keys the same way.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional, Set

import base58

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


# --- address-shape helpers (shared by the loader and AddressComplianceService) --


def _is_evm_address(value: Optional[str]) -> bool:
    """True for a plausible 0x-prefixed 20-byte hex address."""
    if not value or not isinstance(value, str):
        return False
    v = value.strip().lower()
    if not v.startswith("0x") or len(v) != 42:
        return False
    try:
        int(v, 16)
    except ValueError:
        return False
    return True


# TRON base58check addresses: leading 'T', 34 chars, Bitcoin base58 alphabet
# (no 0/O/I/l). Unlike EVM hex these are CASE-SENSITIVE.
_TRON_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

# Solana base58 addresses: no distinguishing prefix, 32-44 chars, and decode
# to exactly 32 raw bytes (an ed25519 public key).
_SOLANA_B58_ALPHABET = _TRON_B58_ALPHABET


def _is_tron_address(value: Optional[str]) -> bool:
    """True for a TRON address, base58check (``T…``, 34 chars) or hex

    (``41…``/``0x41…``, 21 bytes). The base58check branch decodes+validates
    the checksum (an invalid-checksum lookalike is rejected here, not just at
    canonicalization time) so ``_is_tron_address`` and "can be canonicalized"
    always agree.
    """
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    if len(v) == 34 and v.startswith("T"):
        if not all(c in _TRON_B58_ALPHABET for c in v):
            return False
        try:
            decoded = base58.b58decode_check(v)
        except Exception:
            return False
        return len(decoded) == 21 and decoded[0] == 0x41
    hx = v[2:] if v.lower().startswith("0x") else v
    if len(hx) == 42 and hx.lower().startswith("41"):
        try:
            int(hx, 16)
        except ValueError:
            return False
        return True
    return False


def _is_solana_address(value: Optional[str]) -> bool:
    """True for a plausible Solana base58 address (32-byte ed25519 pubkey).

    32-44 char base58 string that decodes to exactly 32 raw bytes. Checked
    after TRON so a TRON base58check string (25 decoded bytes: 21 payload +
    4 checksum) never gets mis-classified as Solana.
    """
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    if not (32 <= len(v) <= 44):
        return False
    if not all(c in _SOLANA_B58_ALPHABET for c in v):
        return False
    try:
        decoded = base58.b58decode(v)
    except Exception:
        return False
    return len(decoded) == 32


def _is_screenable_address(value: Optional[str]) -> bool:
    """True for any address family this service can screen (EVM, TRON, Solana)."""
    return _is_evm_address(value) or _is_tron_address(value) or _is_solana_address(value)


def _tron_canonical(value: str) -> Optional[str]:
    """Canonicalize a TRON address (base58check or hex) to 21-byte lowercase
    hex with no ``0x`` prefix (e.g. ``41a614...ded13c``).

    Returns ``None`` if ``value`` isn't a valid TRON address in either form.
    Callers should already have shape-checked with ``_is_tron_address``; this
    performs the actual decode. No checksum algorithm is added beyond what
    ``base58.b58decode_check`` already verifies — this is exact-match
    canonicalization, not authenticity verification.
    """
    v = (value or "").strip()
    if len(v) == 34 and v.startswith("T"):
        try:
            decoded = base58.b58decode_check(v)
        except Exception:
            return None
        if len(decoded) != 21 or decoded[0] != 0x41:
            return None
        return decoded.hex()
    hx = v[2:] if v.lower().startswith("0x") else v
    hx = hx.lower()
    if len(hx) != 42 or not hx.startswith("41"):
        return None
    try:
        bytes.fromhex(hx)
    except ValueError:
        return None
    return hx


def _normalize(addr: str) -> Optional[str]:
    """Canonical blocklist key for an address, or ``None`` if unparseable.

    EVM hex is case-insensitive so it is lowercased. TRON (base58check or
    hex) is decoded to its canonical 21-byte hex form so every equivalent
    representation (``T…`` / ``41…`` / ``0x41…``) keys identically — see
    ``_tron_canonical``. Solana is out of scope for the *file loader* (it has
    no distinguishing prefix and this module has no context on which lines
    are meant to be Solana vs. an unrelated 32-44 char token), so Solana
    entries belong in ``COMPLIANCE_BLOCKLIST`` / recipient screening in
    ``compliance_service`` instead. Must stay in step with
    ``compliance_service._normalize_address``.
    """
    v = (addr or "").strip()
    if _is_evm_address(v):
        return v.lower()
    if _is_tron_address(v):
        return _tron_canonical(v)
    return None


def load_ofac_addresses(extra_path: str | None = None) -> Set[str]:
    """Build the full sanctioned-address set: seed + optional file.

    Args:
        extra_path: Path to a newline-delimited file of addresses (``#`` and
            blank lines ignored). Missing/unreadable file is logged and
            skipped — screening must degrade gracefully, never crash the
            swap/withdraw path or block boot.

    Returns:
        Canonicalized set of sanctioned addresses (EVM lowercased, TRON
        keyed on 21-byte hex).
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
        except Exception as exc:
            # Broad on purpose: a malformed/unreadable/permission-denied list
            # file must never brick boot or disable screening entirely — fall
            # back to the seed list and keep going.
            logger.warning("Could not read OFAC list %s: %s (using seed only)", extra_path, exc)

    return addresses


def _parse_address_lines(lines: Iterable[str]) -> Set[str]:
    """Parse address-per-line text, skipping comments/blanks.

    Accepts EVM (``0x…``) and TRON (base58check ``T…`` or hex
    ``41…``/``0x41…``) addresses; anything else (including malformed
    entries) is dropped.
    """
    out: Set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Tolerate "address, label" or "address  # label" rows.
        token = line.split(",")[0].split()[0]
        norm = _normalize(token)
        if norm:
            out.add(norm)
    return out
