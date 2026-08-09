"""EVM transaction compliance screening (UBS × Nethermind PoC model).

In June 2026 UBS and Nethermind published two proofs of concept showing a
regulated institution can transact on *public* Ethereum while enforcing
compliance, without forking the protocol. They enforced at two points:

  1. A node configured to apply customizable rules — e.g. restrict transfers
     to **pre-approved addresses** and block disallowed contract interactions.
  2. Routing approved transaction bundles through relays to builders for
     reliable inclusion.

This module adapts stage 1 to Suwappu's **application layer**: every swap is
screened *before* it is signed or broadcast. Two complementary policies:

  * **Allowlist** — the UBS "pre-approved addresses" model. When enabled, a
    transaction may only touch addresses on the allowlist.
  * **Blocklist** — refuse interaction with OFAC-sanctioned addresses (seeded
    from ``ofac_list``) or operator-configured blocked addresses.

Application-layer screening covers every transaction *Suwappu originates*,
which is what matters for a custodial bot flow. It does **not** replace
node/EL-level enforcement (which would also cover transactions we don't
originate) — that is a separate infra track. The relay-routing half of the
PoC (private orderflow via Flashbots/MEV-Share) is likewise out of scope here.

Wiring: ``SwapEngine.execute_swap`` and the withdrawal path in
``hot_wallet.send_native_token``/``send_token`` call
:meth:`AddressComplianceService.screen` before any funds move. Behaviour is
governed by ``ComplianceMode``:

  * ``DISABLED`` — no screening (default; preserves existing behaviour).
  * ``MONITOR``  — screen and log violations, but allow the swap (shadow mode).
  * ``ENFORCE``  — block non-compliant swaps.

# TODO(compliance): coverage is NOT total. Unscreened money-movement surfaces
# today: bulk_pay / p2p transfers, and CCTP bridge legs — none of them call
# into AddressComplianceService. The OFAC list itself is also static (no
# scheduled refresh job pulls the live SDN feed); see ``ofac_list`` module
# docstring. Do not assume "compliance is on" means every surface is covered.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, List, Optional, Set

from bot.config.settings import settings
from bot.services.compliance.ofac_list import (
    load_ofac_addresses,
    _is_evm_address,
    _is_solana_address,
    _is_tron_address,
    _is_screenable_address,
    _tron_canonical,
)

logger = logging.getLogger(__name__)


class ComplianceMode(Enum):
    """How the compliance gate behaves when a violation is found."""

    DISABLED = "disabled"  # No screening at all.
    MONITOR = "monitor"  # Screen + log, but never block (shadow mode).
    ENFORCE = "enforce"  # Block non-compliant transactions.


class ScreeningPolicy(Enum):
    """Which lists are consulted when screening an address."""

    BLOCKLIST_ONLY = "blocklist_only"  # Deny only sanctioned/blocked addresses.
    ALLOWLIST_ONLY = "allowlist_only"  # Deny anything not pre-approved.
    ALLOWLIST_AND_BLOCKLIST = "allowlist_and_blocklist"  # Both apply; blocklist wins.


class ComplianceError(Exception):
    """Raised by :meth:`AddressComplianceService.assert_compliant` on a block."""

    def __init__(self, message: str, result: "ComplianceResult"):
        super().__init__(message)
        self.result = result


@dataclass
class AddressVerdict:
    """Screening outcome for a single address."""

    address: str
    allowed: bool
    source: str  # "allowlist" | "blocklist" | "ofac" | "not_allowlisted" | "default"
    reason: str = ""
    role: Optional[str] = None  # What the address is in the tx: recipient/router/token.


@dataclass
class ComplianceResult:
    """Aggregate screening outcome for a transaction."""

    allowed: bool
    mode: ComplianceMode
    policy: ScreeningPolicy
    verdicts: List[AddressVerdict] = field(default_factory=list)
    blocked: List[AddressVerdict] = field(default_factory=list)

    @property
    def reason(self) -> str:
        """Human-readable summary of why the transaction was blocked."""
        if self.allowed or not self.blocked:
            return ""
        parts = []
        for v in self.blocked:
            label = f"{v.role} " if v.role else ""
            parts.append(f"{label}{_short(v.address)} ({v.reason})")
        return "Compliance check failed: " + "; ".join(parts)


def _short(addr: str) -> str:
    if len(addr) <= 12:
        return addr
    return f"{addr[:6]}…{addr[-4:]}"


# Address-shape recognition (`_is_evm_address` / `_is_tron_address` /
# `_is_solana_address` / `_is_screenable_address`) and TRON canonicalization
# (`_tron_canonical`) live in ``ofac_list`` and are imported above, so the
# list loader and this service always agree on what counts as a "screenable"
# address and how it keys into the blocklist. See that module for the shape
# rules and why TRON's checksum is validated as part of shape-checking.


def _normalize_address(value: str) -> str:
    """Canonical blocklist key for an address.

    * EVM hex is case-insensitive, so it is lowercased.
    * TRON (base58check ``T…`` or hex ``41…``/``0x41…``) is canonicalized to
      its 21-byte hex form via ``ofac_list._tron_canonical`` so every
      equivalent representation of the same address keys identically,
      matching the list loader.
    * Solana base58 has no case-folding convention (unlike EVM hex, it is not
      case-insensitive) — it is kept verbatim, i.e. exact-match blocklisting
      only, no canonicalization.

    Assumes ``value`` already passed ``_is_screenable_address`` (callers
    filter first); an unparseable TRON string falls back to the raw value
    rather than raising, since normalization must never crash the swap/
    withdraw path.
    """
    v = (value or "").strip()
    if _is_evm_address(v):
        return v.lower()
    if _is_tron_address(v):
        return _tron_canonical(v) or v
    return v


def _parse_csv_addresses(raw: str) -> Set[str]:
    """Parse a comma-separated address string into a normalized address set.

    Accepts EVM, TRON, and Solana addresses. TRON matters here because OFAC
    SDN listings include TRON addresses (USDT-TRC20 is a primary
    sanctions-evasion rail) and the operator blocklist is how they get
    supplied.
    """
    out: Set[str] = set()
    for tok in (raw or "").split(","):
        candidate = (tok or "").strip()
        if not _is_screenable_address(candidate):
            continue
        out.add(_normalize_address(candidate))
    return out


class AddressComplianceService:
    """Screens EVM and TRON addresses for a transaction against allow/block lists.

    Usage::

        result = compliance_service.screen(
            recipient=quote.recipient,
            router=quote.router_address,
            tokens=[from_token_addr, to_token_addr],
            chain="ethereum",
        )
        if not result.allowed:
            raise SwapError(result.reason)

    Understands EVM (``0x…``), TRON (``T…`` base58check or ``41…``/``0x41…``
    hex), and Solana (base58, 32-byte pubkey) addresses. Other families
    (Starknet, Bitcoin, …) cannot be screened; in ``ENFORCE`` mode an
    unscreenable *recipient* is rejected (fail closed) rather than silently
    passed through — see :meth:`screen`. Lists are loaded once at
    construction and can be rebuilt with :meth:`reload`.
    """

    def __init__(self) -> None:
        self._blocklist: Set[str] = set()
        self._allowlist: Set[str] = set()
        self._ofac: Set[str] = set()
        self.reload()

    # --- configuration -------------------------------------------------

    def reload(self) -> None:
        """(Re)load allow/block lists from settings + the OFAC seed/file."""
        self._ofac = load_ofac_addresses(getattr(settings, "compliance_ofac_list_path", "") or None)

        operator_block = _parse_csv_addresses(getattr(settings, "compliance_blocklist", ""))
        self._blocklist = self._ofac | operator_block
        self._allowlist = _parse_csv_addresses(getattr(settings, "compliance_allowlist", ""))

        logger.info(
            "Compliance lists loaded: mode=%s policy=%s blocklist=%d (ofac=%d) allowlist=%d",
            self.mode.value,
            self.policy.value,
            len(self._blocklist),
            len(self._ofac),
            len(self._allowlist),
        )

    @property
    def mode(self) -> ComplianceMode:
        raw = (getattr(settings, "compliance_mode", "disabled") or "disabled").lower()
        try:
            return ComplianceMode(raw)
        except ValueError:
            logger.warning("Unknown compliance_mode %r, defaulting to disabled", raw)
            return ComplianceMode.DISABLED

    @property
    def policy(self) -> ScreeningPolicy:
        raw = (getattr(settings, "compliance_policy", "blocklist_only") or "blocklist_only").lower()
        try:
            return ScreeningPolicy(raw)
        except ValueError:
            logger.warning("Unknown compliance_policy %r, defaulting to blocklist_only", raw)
            return ScreeningPolicy.BLOCKLIST_ONLY

    @property
    def enabled(self) -> bool:
        return self.mode is not ComplianceMode.DISABLED

    # --- screening -----------------------------------------------------

    def is_sanctioned(self, address: Optional[str]) -> bool:
        """True if ``address`` is on the blocklist (OFAC seed + operator)."""
        if not _is_screenable_address(address):
            return False
        return _normalize_address(address) in self._blocklist

    def screen_address(self, address: str, role: Optional[str] = None) -> AddressVerdict:
        """Screen a single address (EVM or TRON) against the active policy.

        Assumes ``address`` is already a screenable address (caller filters).
        Normalization is chain-aware: EVM hex is lowercased, TRON base58 is kept
        verbatim because it is case-sensitive.
        """
        addr = _normalize_address(address)
        policy = self.policy

        # Blocklist always wins, regardless of policy.
        if addr in self._blocklist:
            source = "ofac" if addr in self._ofac else "blocklist"
            reason = "OFAC-sanctioned address" if source == "ofac" else "operator-blocked address"
            return AddressVerdict(addr, allowed=False, source=source, reason=reason, role=role)

        # Allowlist enforcement, when the policy requires it.
        if policy in (ScreeningPolicy.ALLOWLIST_ONLY, ScreeningPolicy.ALLOWLIST_AND_BLOCKLIST):
            if addr not in self._allowlist:
                return AddressVerdict(
                    addr,
                    allowed=False,
                    source="not_allowlisted",
                    reason="address not in pre-approved allowlist",
                    role=role,
                )
            return AddressVerdict(addr, allowed=True, source="allowlist", role=role)

        return AddressVerdict(addr, allowed=True, source="default", role=role)

    def screen(
        self,
        *,
        recipient: Optional[str] = None,
        router: Optional[str] = None,
        tokens: Optional[Iterable[Optional[str]]] = None,
        extra: Optional[Iterable[Optional[str]]] = None,
        chain: Optional[str] = None,
    ) -> ComplianceResult:
        """Screen all EVM/TRON/Solana addresses involved in a transaction.

        Args:
            recipient: Address receiving funds (the UBS "pre-approved" target).
            router: DEX/bridge contract the swap interacts with.
            tokens: Token contract addresses involved.
            extra: Any additional addresses to screen.
            chain: Chain name (informational). EVM, TRON, and Solana
                addresses are screened; other families (Starknet, Bitcoin, …)
                cannot be. For those, a non-``recipient`` role is skipped
                (best-effort — routers/tokens on unsupported chains don't
                block the tx), but the ``recipient`` role is fail-closed: in
                ``ENFORCE`` mode an unscreenable recipient is treated as a
                block (this behaviour is driven by ``compliance_mode``, the
                same setting that governs everything else here — ``MONITOR``
                logs-and-allows it like any other would-block verdict,
                ``ENFORCE`` rejects it). This closes the gap where a
                recipient address family we simply don't understand yet would
                otherwise sail through unscreened.

        Returns:
            A :class:`ComplianceResult`. In ``MONITOR`` mode ``allowed`` is
            always ``True`` (violations are logged, not enforced); in
            ``ENFORCE`` mode ``allowed`` reflects the verdicts. In ``DISABLED``
            mode screening is skipped entirely.
        """
        mode = self.mode
        policy = self.policy
        result = ComplianceResult(allowed=True, mode=mode, policy=policy)

        if mode is ComplianceMode.DISABLED:
            return result

        candidates: List[tuple[str, str]] = []
        candidates.append((recipient, "recipient")) if recipient else None
        candidates.append((router, "router")) if router else None
        for t in tokens or []:
            if t:
                candidates.append((t, "token"))
        for e in extra or []:
            if e:
                candidates.append((e, "address"))

        for value, role in candidates:
            if not _is_screenable_address(value):
                if role == "recipient":
                    # Fail closed on the one role that actually matters: we
                    # cannot vouch for a recipient address family we don't
                    # understand. Non-recipient roles (router/token) on an
                    # unsupported chain are still skipped below — blocking a
                    # whole swap because we can't screen its router would be
                    # a much bigger behaviour change with no compliance
                    # upside, since the router never receives the funds.
                    verdict = AddressVerdict(
                        value or "",
                        allowed=False,
                        source="unscreenable",
                        reason="recipient address family is not supported by compliance screening",
                        role=role,
                    )
                    result.verdicts.append(verdict)
                    result.blocked.append(verdict)
                continue  # Address families we cannot screen (e.g. Starknet).
            verdict = self.screen_address(value, role=role)
            result.verdicts.append(verdict)
            if not verdict.allowed:
                result.blocked.append(verdict)

        if result.blocked:
            if mode is ComplianceMode.ENFORCE:
                result.allowed = False
                logger.warning("Compliance BLOCK (chain=%s): %s", chain, result.reason)
            else:  # MONITOR
                result.allowed = True
                logger.warning(
                    "Compliance MONITOR (would block, chain=%s): %s", chain, result.reason
                )

        return result

    def assert_compliant(self, **kwargs) -> ComplianceResult:
        """Like :meth:`screen` but raises :class:`ComplianceError` on a block."""
        result = self.screen(**kwargs)
        if not result.allowed:
            raise ComplianceError(result.reason, result)
        return result

    # --- introspection -------------------------------------------------

    def stats(self) -> dict:
        return {
            "mode": self.mode.value,
            "policy": self.policy.value,
            "blocklist": len(self._blocklist),
            "ofac": len(self._ofac),
            "allowlist": len(self._allowlist),
        }


# Global instance — mirrors the other token-security singletons.
compliance_service = AddressComplianceService()
