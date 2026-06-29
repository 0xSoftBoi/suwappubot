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

Wiring: ``SwapEngine.execute_swap`` calls :meth:`AddressComplianceService.screen`
at the single choke point every swap entry path funnels through, before any
funds move. Behaviour is governed by ``ComplianceMode``:

  * ``DISABLED`` — no screening (default; preserves existing behaviour).
  * ``MONITOR``  — screen and log violations, but allow the swap (shadow mode).
  * ``ENFORCE``  — block non-compliant swaps.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, List, Optional, Set

from bot.config.settings import settings
from bot.services.compliance.ofac_list import load_ofac_addresses

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


def _parse_csv_addresses(raw: str) -> Set[str]:
    """Parse a comma-separated address string into a lowercased EVM-address set."""
    out: Set[str] = set()
    for tok in (raw or "").split(","):
        norm = tok.strip().lower()
        if _is_evm_address(norm):
            out.add(norm)
    return out


class AddressComplianceService:
    """Screens EVM addresses for a transaction against allow/block lists.

    Usage::

        result = compliance_service.screen(
            recipient=quote.recipient,
            router=quote.router_address,
            tokens=[from_token_addr, to_token_addr],
            chain="ethereum",
        )
        if not result.allowed:
            raise SwapError(result.reason)

    Non-EVM addresses (Solana, TRON, Starknet, …) are skipped — this gate only
    understands 0x-style addresses. Lists are loaded once at construction and
    can be rebuilt with :meth:`reload`.
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
        return _is_evm_address(address) and address.strip().lower() in self._blocklist

    def screen_address(self, address: str, role: Optional[str] = None) -> AddressVerdict:
        """Screen a single EVM address against the active policy.

        Assumes ``address`` is already a valid EVM address (caller filters).
        """
        addr = address.strip().lower()
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
        """Screen all EVM addresses involved in a transaction.

        Args:
            recipient: Address receiving funds (the UBS "pre-approved" target).
            router: DEX/bridge contract the swap interacts with.
            tokens: Token contract addresses involved.
            extra: Any additional addresses to screen.
            chain: Chain name (informational; only EVM addresses are screened).

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
            if not _is_evm_address(value):
                continue  # Non-EVM (Solana/TRON/…) — out of scope for this gate.
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
