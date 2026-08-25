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
# today: bulk_pay and CCTP bridge legs — neither calls into
# AddressComplianceService. (P2P escrow release/refund IS screened now — it
# settles via ``HotWalletService.send_token``, same as custodial withdrawals,
# so it goes through ``_assert_recipient_compliant``.) The OFAC list itself
# is also static (no scheduled refresh job pulls the live SDN feed); see
# ``ofac_list`` module docstring. Do not assume "compliance is on" means
# every surface is covered.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterable, List, Optional, Set

from bot.config.settings import settings
from bot.services.compliance.ofac_list import (
    load_ofac_addresses,
    ofac_list,
    _is_evm_address,
    _is_tron_address,
    _is_screenable_address,
    _tron_canonical,
)

logger = logging.getLogger(__name__)


# Sentinel distinguishing "caller didn't pass a recipient at all" (e.g.
# address_gate.py's token-only screening, which has no recipient to check)
# from "caller explicitly passed an empty/None recipient" (e.g. a withdrawal
# whose destination somehow resolved empty). See ``screen`` finding 4: only
# the latter must fail closed in ENFORCE — the former must keep no-op'ing
# exactly as before, or every non-recipient screening call would start
# failing closed too.
class _Unset:
    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        return "<unset>"


_UNSET: Any = _Unset()


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
#
# Starknet and BTC bech32 recognition live here (not in ``ofac_list``)
# because they are recipient-screening-only shapes today — the OFAC seed/
# file loader has no Starknet/BTC entries to key against, so there is no
# list-loader side that needs to agree on their canonical form.

# Starknet address: 0x-prefixed hex, 1-64 hex digits (a felt is < 2^251, so
# up to 64 hex chars). Length must differ from 42 (0x + 40 hex) so this can
# never overlap with an EVM address shape.
_STARKNET_RE = re.compile(r"^0x[0-9a-fA-F]{1,64}$")

# Bitcoin bech32 (segwit) address: "bc1" + 11-71 base32-ish chars. This is a
# shape check only, not a full bech32 checksum validation.
_BTC_BECH32_RE = re.compile(r"^bc1[a-z0-9]{11,71}$", re.IGNORECASE)


def _is_starknet_address(value: Optional[str]) -> bool:
    """True for a plausible Starknet address (0x + 1-64 hex, len != 42)."""
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    if not _STARKNET_RE.match(v):
        return False
    return len(v) != 42  # exclude EVM-shaped strings; those are EVM, not Starknet.


def _is_btc_bech32_address(value: Optional[str]) -> bool:
    """True for a plausible Bitcoin bech32 (segwit, ``bc1…``) address."""
    if not value or not isinstance(value, str):
        return False
    return bool(_BTC_BECH32_RE.match(value.strip()))


def _is_recognized_address_family(value: Optional[str]) -> bool:
    """True for any address family this service recognizes at all.

    This is broader than ``_is_screenable_address`` (EVM/TRON/Solana, the
    families that are also keyed into the OFAC/operator blocklist file
    format): it also covers Starknet and BTC bech32, which are screened
    against the in-memory allow/blocklists but have no file-loader-side
    canonicalization. Anything NOT covered here is a genuinely unknown
    family — that's what the ``ENFORCE``-mode fail-closed recipient check in
    :meth:`AddressComplianceService.screen` guards against; unknown families
    fail closed *intentionally*, since we cannot vouch for an address shape
    we don't understand at all.
    """
    return (
        _is_screenable_address(value)
        or _is_starknet_address(value)
        or _is_btc_bech32_address(value)
    )


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
    * Starknet (0x-prefixed hex, non-EVM length) is normalized to
      ``0x`` + lowercase hex with leading zeros stripped (e.g. ``0x00ab``
      and ``0xAB`` both key as ``0xab``) — this is a canonical *form*, not a
      cryptographic canonicalization; it just collapses the zero-padding
      variance a felt can be printed with.
    * BTC bech32 (``bc1…``) has no case-folding convention on-chain in the
      sense TRON/Solana don't, but the bech32 spec itself is
      case-insensitive at the encoding level, so it is normalized to
      lowercase verbatim (no further decoding).

    Assumes ``value`` already passed ``_is_recognized_address_family``
    (callers filter first); an unparseable TRON string falls back to the raw
    value rather than raising, since normalization must never crash the
    swap/withdraw path.
    """
    v = (value or "").strip()
    if _is_evm_address(v):
        return v.lower()
    if _is_tron_address(v):
        return _tron_canonical(v) or v
    if _is_starknet_address(v):
        hexpart = v.lower()[2:].lstrip("0") or "0"
        return "0x" + hexpart
    if _is_btc_bech32_address(v):
        return v.lower()
    return v


def _parse_csv_addresses(raw: str) -> Set[str]:
    """Parse a comma-separated address string into a normalized address set.

    Accepts every recognized address family (EVM, TRON, Solana, Starknet,
    BTC bech32) — the operator blocklist/allowlist should be able to name an
    address in any family this service can screen, not just the ones the
    OFAC file loader keys on. TRON matters here specifically because OFAC
    SDN listings include TRON addresses (USDT-TRC20 is a primary
    sanctions-evasion rail).

    Unparseable tokens are dropped and counted; a single summary line (with
    up to the first 5 offending tokens as examples) is logged, not one line
    per bad token — mirrors ``ofac_list._parse_address_lines``.
    """
    out: Set[str] = set()
    dropped = 0
    examples: List[str] = []
    for tok in (raw or "").split(","):
        candidate = (tok or "").strip()
        if not candidate:
            continue  # blank entries (e.g. trailing comma, empty setting) aren't "dropped"
        if not _is_recognized_address_family(candidate):
            dropped += 1
            if len(examples) < 5:
                examples.append(candidate)
            continue
        out.add(_normalize_address(candidate))
    if dropped:
        logger.warning(
            "Compliance CSV address list: dropped %d unparseable/invalid entr%s (examples: %s%s)",
            dropped,
            "y" if dropped == 1 else "ies",
            ", ".join(examples),
            ", ..." if dropped > len(examples) else "",
        )
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
    hex), Solana (base58, 32-byte pubkey), Starknet (``0x…`` felt, non-EVM
    length), and BTC bech32 (``bc1…``) addresses. Any OTHER family is
    genuinely unknown to this service and, in ``ENFORCE`` mode, an
    unscreenable *recipient* of an unknown family is rejected (fail closed)
    rather than silently passed through — see :meth:`screen`. Lists are
    loaded once at construction and can be rebuilt with :meth:`reload`.
    """

    def __init__(self) -> None:
        self._blocklist: Set[str] = set()
        self._allowlist: Set[str] = set()
        self._ofac: Set[str] = set()
        self._list_degraded: bool = False
        self.reload()

    # --- configuration -------------------------------------------------

    def reload(self) -> None:
        """(Re)load allow/block lists from settings + the OFAC seed/file."""
        self._ofac = load_ofac_addresses(getattr(settings, "compliance_ofac_list_path", "") or None)
        # ofac_list.reload() (called inside load_ofac_addresses) sets
        # ofac_list.degraded when an extra_path was configured but failed to
        # load/parse. Mirror it here so screen() can fail closed on it.
        self._list_degraded = ofac_list.degraded

        operator_block = _parse_csv_addresses(getattr(settings, "compliance_blocklist", ""))
        self._blocklist = self._ofac | operator_block
        self._allowlist = _parse_csv_addresses(getattr(settings, "compliance_allowlist", ""))

        logger.info(
            "Compliance lists loaded: mode=%s policy=%s blocklist=%d (ofac=%d) allowlist=%d degraded=%s",
            self.mode.value,
            self.policy.value,
            len(self._blocklist),
            len(self._ofac),
            len(self._allowlist),
            self._list_degraded,
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
        if not _is_recognized_address_family(address):
            return False
        return _normalize_address(address) in self._blocklist

    def screen_address(self, address: str, role: Optional[str] = None) -> AddressVerdict:
        """Screen a single address (EVM, TRON, Solana, Starknet, or BTC
        bech32) against the active policy.

        Assumes ``address`` is already a recognized address family (caller
        filters via ``_is_recognized_address_family``). Normalization is
        chain-aware: EVM hex is lowercased, TRON base58 is canonicalized to
        21-byte hex, Solana base58 is kept verbatim (it is case-sensitive
        with no canonical form — this was previously mis-documented here as
        a TRON property), Starknet hex has its leading zero-padding
        stripped, and BTC bech32 is lowercased verbatim.
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
        recipient: Optional[str] = _UNSET,
        router: Optional[str] = None,
        tokens: Optional[Iterable[Optional[str]]] = None,
        extra: Optional[Iterable[Optional[str]]] = None,
        chain: Optional[str] = None,
    ) -> ComplianceResult:
        """Screen all recognized-family addresses involved in a transaction.

        Args:
            recipient: Address receiving funds (the UBS "pre-approved"
                target). Leave unset entirely (don't pass the kwarg) if the
                call has no recipient to check — e.g. token-only screening —
                and that role is skipped exactly as if it were never asked
                for. If the kwarg IS passed but is ``None``/``""`` (a
                recipient was expected but resolved empty), that is treated
                as an unscreenable recipient and fails closed the same as an
                unrecognized address family (see below) — a withdrawal must
                never silently skip screening just because its destination
                came back empty.
            router: DEX/bridge contract the swap interacts with.
            tokens: Token contract addresses involved.
            extra: Any additional addresses to screen.
            chain: Chain name (informational). EVM, TRON, Solana, Starknet,
                and BTC bech32 addresses are screened; any OTHER family is
                genuinely unknown to this service. For those, a
                non-``recipient`` role is skipped (best-effort — routers/
                tokens on unsupported chains don't block the tx), but the
                ``recipient`` role is fail-closed: in ``ENFORCE`` mode an
                unscreenable recipient is treated as a block (this behaviour
                is driven by ``compliance_mode``, the same setting that
                governs everything else here — ``MONITOR`` logs-and-allows
                it like any other would-block verdict, ``ENFORCE`` rejects
                it). This closes the gap where a recipient address family we
                simply don't understand yet — or a recipient that resolved
                to nothing at all — would otherwise sail through unscreened.

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

        if self._list_degraded:
            # The sanctions list provider (ofac_list) failed to load/parse an
            # operator-configured extra_path on the last reload. We cannot
            # claim to have screened against the real list, so ENFORCE must
            # not present a false "clean" verdict — fail closed regardless of
            # what's being screened. MONITOR just logs it (shadow mode).
            verdict = AddressVerdict(
                "",
                allowed=False,
                source="degraded_list",
                reason="sanctions list failed to load or parse; screening is degraded",
                role=None,
            )
            result.verdicts.append(verdict)
            result.blocked.append(verdict)
            if mode is ComplianceMode.ENFORCE:
                result.allowed = False
                logger.error(
                    "Compliance BLOCK (chain=%s): sanctions list is degraded, failing closed",
                    chain,
                )
                return result
            logger.warning(
                "Compliance MONITOR (chain=%s): sanctions list is degraded — would fail "
                "closed in ENFORCE",
                chain,
            )

        candidates: List[tuple[str, str]] = []
        if recipient is not _UNSET:
            # Recipient was explicitly requested (even if it resolved
            # empty/None) — see the "null-recipient" note in the docstring.
            candidates.append((recipient or "", "recipient"))
        candidates.append((router, "router")) if router else None
        for t in tokens or []:
            if t:
                candidates.append((t, "token"))
        for e in extra or []:
            if e:
                candidates.append((e, "address"))

        for value, role in candidates:
            if not _is_recognized_address_family(value):
                if role == "recipient":
                    # Fail closed on the one role that actually matters: we
                    # cannot vouch for a recipient that's empty/None or whose
                    # address family we don't understand at all. Non-recipient
                    # roles (router/token) of an unrecognized family are still
                    # skipped below — blocking a whole swap because we can't
                    # screen its router would be a much bigger behaviour
                    # change with no compliance upside, since the router
                    # never receives the funds.
                    reason = (
                        "recipient is missing/empty"
                        if not value
                        else "recipient address family is not supported by compliance screening"
                    )
                    verdict = AddressVerdict(
                        value or "",
                        allowed=False,
                        source="unscreenable",
                        reason=reason,
                        role=role,
                    )
                    result.verdicts.append(verdict)
                    result.blocked.append(verdict)
                continue  # Address families we cannot recognize at all.
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
