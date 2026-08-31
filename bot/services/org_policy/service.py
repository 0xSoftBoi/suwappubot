"""Org-admin-configured transfer policy evaluation (enterprise dashboard).

Mirrors ``bot.services.compliance.compliance_service``'s posture: this is a
second, ADDITIONAL gate that runs immediately after sanctions/OFAC
screening at both money-movement choke points (``SwapEngine.execute_swap``
and ``hot_wallet._assert_recipient_compliant``). Where compliance screening
answers "is this address sanctioned", ``OrgPolicyService`` answers "does
this org's admin-configured spend policy allow this transaction" —
Fireblocks/Safe-style tx limits, daily caps, velocity, allowlist-only, and
tiered spending, read from the api-ts-owned ``org_policies`` /
``org_allowlist_addresses`` / ``policy_approval_requests`` tables (see
``bot.models.org_policy`` for the DDL-ownership boundary).

MULTI-MEMBERSHIP: a user can belong to more than one org (e.g. a personal,
policy-free org AND an enterprise org with real policies configured).
Evaluation loads EVERY membership and evaluates the UNION of enabled
policies across ALL of them, resolving to the single STRICTEST outcome
(``BLOCKED`` beats ``REQUIRES_APPROVAL`` beats ``ALLOWED``) — a user cannot
launder a transaction past an enterprise org's policies just by also
sitting in an unrelated org with no policies.

DEGRADED POSTURE (never brick a swap on a read blip):

  * No ``organization_members`` row for the user, or the policy tables don't
    exist yet (``ProgrammingError``/``UndefinedTable`` on postgres, or a
    sqlite ``OperationalError`` whose message is literally "no such table" —
    feature not rolled out to this environment), or the org(s) have zero
    *enabled* policies -> ``ALLOWED``, logged at debug (this is the
    expected, common case; almost no user is in an org with active
    policies today).
  * ANY OTHER failure — including DB errors after we've established the
    org(s) have enabled policies, unexpected row shapes, or any other
    exception that is not one of the two "not rolled out" signals above —
    -> ``ALLOWED`` (fail OPEN — an org policy read outage must not become a
    platform-wide swap outage) but LOUD (``logger.error``) plus a
    ``screening_events`` row with ``decision='flagged'``,
    ``reason='org_policy_degraded'`` so the dashboard can see the gap. This
    branch must never be reached by an ordinary "not rolled out" case —
    conflating the two would silently mask a real outage as expected
    absence (see the ``evaluate`` except chain below).

This is a deliberately different failure posture than sanctions screening
in ENFORCE mode (which fails CLOSED) — org policies are an opt-in,
per-tenant control, not a platform-wide legal requirement, so a read blip
here must not block every other tenant's swaps too.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_
from sqlalchemy.exc import OperationalError, ProgrammingError

from bot.config.settings import settings

logger = logging.getLogger(__name__)

# Chain families whose addresses are NOT case-insensitive (base58/felt) — kept
# verbatim for allowlist matching. Every other chain key is treated as EVM and
# lowercased. Mirrors api-ts's BASE58_CHAIN_FAMILIES + starknet carve-out in
# enterprisePolicies.ts::validateAllowlistAddress, so a destination address
# normalizes to the exact same allowlist key on both sides of the shared DB.
_BASE58_CHAIN_FAMILIES = {"solana", "tron"}


def _normalize_dest_address(chain: Optional[str], address: str) -> str:
    c = (chain or "").strip().lower()
    addr = (address or "").strip()
    if c == "starknet" or c in _BASE58_CHAIN_FAMILIES:
        return addr
    return addr.lower()


def _num(value: Any) -> Optional[float]:
    """Best-effort float coercion for a jsonb param; ``None`` on anything
    unusable — including non-finite values. ``float('nan')`` and
    ``float('1e999')`` (-> inf) both coerce successfully in plain Python but
    must never satisfy a numeric threshold comparison (``amount_usd >
    float('nan')`` is always False, ``amount_usd > float('inf')`` is always
    False — either would silently defeat the policy it appears on). See C5.
    """
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def _round_sigfigs(value: float, sigfigs: int = 2) -> float:
    """Round ``value`` to ``sigfigs`` significant figures, for approval-request
    dedupe bucketing (see C7) — two near-identical amounts (e.g. a retried
    swap where the quote moved half a cent) collapse to the same bucket key
    so a retry reuses the existing pending request instead of minting a
    fresh one every time.
    """
    if not value:
        return 0.0
    d = sigfigs - int(math.floor(math.log10(abs(value)))) - 1
    return round(value, d)


class OrgPolicyOutcome(Enum):
    ALLOWED = "allowed"
    BLOCKED = "blocked"
    REQUIRES_APPROVAL = "requires_approval"


# Strictness ranking used to resolve the union of policies across every org a
# user belongs to (C1) down to a single decision: a hard block always wins
# over an approval requirement, which always wins over silent allow.
_SEVERITY = {
    OrgPolicyOutcome.BLOCKED: 2,
    OrgPolicyOutcome.REQUIRES_APPROVAL: 1,
}


@dataclass
class OrgPolicyDecision:
    """Result of :meth:`OrgPolicyService.evaluate`."""

    outcome: OrgPolicyOutcome
    reason: Optional[str] = None
    policy_id: Optional[str] = None
    policy_type: Optional[str] = None
    approval_request_id: Optional[str] = None
    required_approvals: Optional[int] = None
    org_id: Optional[str] = None

    @property
    def allowed(self) -> bool:
        return self.outcome is OrgPolicyOutcome.ALLOWED


_ALLOWED = OrgPolicyDecision(outcome=OrgPolicyOutcome.ALLOWED)


class _DegradedEvaluation(Exception):
    """Internal signal: an org's enabled policies were found, but evaluating
    them against this transaction failed (DB blip, unexpected row shape,
    etc). Distinct from "tables/org/policies don't exist" so the caller can
    apply the louder degraded-posture logging + screening_event."""

    def __init__(self, org_id: Optional[str] = None) -> None:
        super().__init__("org_policy evaluation degraded mid-evaluation")
        self.org_id = org_id


def _screening_result_for(source: str, allowed: bool, *, mode_enforce: bool = True):
    """Build a minimal ``ComplianceResult``-shaped object so we can reuse
    ``record_screening_event`` without duplicating its decision/reason
    derivation. Only the fields ``record_screening_event`` actually reads
    (``mode``, ``allowed``, ``blocked``, ``verdicts``) are populated.

    ``mode_enforce`` drives ``record_screening_event``'s own
    ``_decision_for`` derivation (see ``bot.services.compliance.
    screening_events``): with ``allowed=False`` and a non-empty ``blocked``
    list, ``mode_enforce=True`` (``ComplianceMode.ENFORCE``) derives
    ``decision="blocked"``, while ``mode_enforce=False``
    (``ComplianceMode.MONITOR``) derives ``decision="flagged"`` instead —
    used so a hard ``BLOCKED`` org-policy outcome and a
    ``REQUIRES_APPROVAL`` escalation are distinguishable on the dashboard
    (a block vs. an escalation awaiting a human, not the same thing).
    """
    from bot.services.compliance.compliance_service import (
        AddressVerdict,
        ComplianceMode,
        ComplianceResult,
    )

    verdict = AddressVerdict(address="", allowed=False, source=source, reason=source)
    return ComplianceResult(
        allowed=allowed,
        mode=ComplianceMode.ENFORCE if mode_enforce else ComplianceMode.MONITOR,
        policy=None,  # type: ignore[arg-type] — not read by record_screening_event
        verdicts=[verdict],
        blocked=[verdict],
    )


class OrgPolicyService:
    """Evaluates an org's admin-configured transfer policies for one tx.

    Usage::

        decision = await org_policy_service.evaluate(
            user_id=user_id, chain=chain, dest_address=recipient,
            amount_usd=amount_usd, surface="swap",
            owned_addresses={wallet_address},
        )
        if not decision.allowed:
            raise SwapError(f"🚫 {decision.reason}")

    ``owned_addresses`` (C6): the set of addresses the CALLER already knows
    belong to the initiating user themselves (their own custodial wallet on
    this chain) — NOT a third-party recipient. ``allowlist_only`` exempts
    these from allowlist gating, since neither a same-wallet swap
    destination nor a gas-sponsorship top-up to the user's own address is a
    "transfer out" the policy is meant to police. Omit it (or pass an empty
    set) for genuine withdrawals to an arbitrary destination — those must
    still be gated normally.
    """

    async def evaluate(
        self,
        *,
        user_id: Optional[int],
        chain: Optional[str],
        dest_address: Optional[str],
        amount_usd: Optional[float],
        surface: str,
        owned_addresses: Optional[Iterable[str]] = None,
    ) -> OrgPolicyDecision:
        if not settings.org_policy_enforcement_enabled:
            return _ALLOWED
        if not user_id:
            # No user in scope (pooled/admin sweeps, P2P escrow settlement) —
            # nothing to resolve an org membership from. Mirrors
            # compliance_service callers that pass user_id=None.
            return _ALLOWED

        from database.db import run_in_db

        try:
            return await run_in_db(
                self._evaluate_sync,
                user_id,
                chain,
                dest_address,
                amount_usd,
                surface,
                owned_addresses,
            )
        except _DegradedEvaluation as de:
            return await self._fail_degraded(
                user_id, de.org_id, chain, surface, dest_address, de.__cause__ or de
            )
        except ProgrammingError as e:
            # Postgres "UndefinedTable" etc — genuinely not rolled out here.
            logger.debug(
                "org_policy tables not present; allowing (feature not rolled out) for "
                "user %s (surface=%s): %s",
                user_id,
                surface,
                e,
            )
            return _ALLOWED
        except OperationalError as e:
            # C9: sqlite raises OperationalError (not ProgrammingError) for a
            # missing table, so this is the sqlite equivalent of the branch
            # above — but ONLY when the message says so. Any OTHER
            # OperationalError (lock timeout, connection reset, real outage
            # on a rolled-out environment) must NOT be treated as "not
            # rolled out" — it routes through the same loud degraded path as
            # every other unexpected failure.
            if "no such table" in str(e).lower():
                logger.debug(
                    "org_policy tables not present (sqlite); allowing (feature not rolled "
                    "out) for user %s (surface=%s): %s",
                    user_id,
                    surface,
                    e,
                )
                return _ALLOWED
            return await self._fail_degraded(user_id, None, chain, surface, dest_address, e)
        except Exception as e:  # noqa: BLE001 — C9: see module docstring degraded posture.
            # Previously this branch quiet-allowed EVERYTHING that wasn't a
            # _DegradedEvaluation, at debug level with no screening_event —
            # silently masking real outages (bad row shape, unexpected
            # driver error, etc) as "not rolled out here". Only the two
            # specific "not rolled out" signals above get the quiet path;
            # everything else is a genuine degrade — loud + flagged + allow.
            return await self._fail_degraded(user_id, None, chain, surface, dest_address, e)

    async def _fail_degraded(
        self,
        user_id: Optional[int],
        org_id: Optional[str],
        chain: Optional[str],
        surface: str,
        dest_address: Optional[str],
        err: BaseException,
    ) -> OrgPolicyDecision:
        """Shared fail-open-but-LOUD path for anything that is not a
        confirmed "feature not rolled out here" signal (see module docstring
        DEGRADED POSTURE / C9)."""
        from database.db import run_in_db

        logger.error(
            "org_policy evaluation degraded for user %s org %s (surface=%s) — "
            "allowing (fail-open): %s",
            user_id,
            org_id,
            surface,
            err,
        )
        try:
            await run_in_db(self._record_degraded, user_id, org_id, chain, surface, dest_address)
        except Exception as e:  # noqa: BLE001 — persistence-only
            logger.warning("Failed to record org_policy degraded screening event: %s", e)
        return _ALLOWED

    # --- sync internals (run off-thread via run_in_db) ---------------------

    def _evaluate_sync(
        self,
        user_id: int,
        chain: Optional[str],
        dest_address: Optional[str],
        amount_usd: Optional[float],
        surface: str,
        owned_addresses: Optional[Iterable[str]] = None,
    ) -> OrgPolicyDecision:
        from database.db import get_session
        from bot.models.org_policy import OrganizationMember, OrgPolicy

        # PHASE 1 (read-only, "not rolled out" quiet-catch zone): resolve
        # org membership and enabled policies. Nothing is written in this
        # phase, so its session's implicit commit-on-exit (`get_session`)
        # can never itself raise a write-time error — a bare
        # `ProgrammingError`/sqlite-"no such table" `OperationalError` here
        # really can mean the org-policy tables don't exist in this
        # environment yet (see module docstring DEGRADED POSTURE), so this
        # is the ONLY place in `_evaluate_sync` allowed to quiet-catch
        # `ProgrammingError` this way. `OperationalError` is deliberately
        # NOT caught here — it propagates to `evaluate()`'s own handler,
        # which applies the "no such table" vs. genuine-outage distinction
        # (C9).
        try:
            with get_session() as session:
                # C1: load EVERY membership, not just the oldest one — a
                # user in a personal (policy-free) org AND an enterprise org
                # must still be evaluated against the enterprise org's
                # policies.
                memberships = (
                    session.query(OrganizationMember)
                    .filter(OrganizationMember.user_id == user_id)
                    .all()
                )
                if not memberships:
                    return _ALLOWED

                org_ids = sorted({m.organization_id for m in memberships})

                policies = (
                    session.query(OrgPolicy)
                    .filter(OrgPolicy.org_id.in_(org_ids), OrgPolicy.enabled.is_(True))
                    .all()
                )
        except ProgrammingError:
            logger.debug("org_policy tables not present; allowing (feature not rolled out)")
            return _ALLOWED

        if not policies:
            return _ALLOWED

        # PHASE 2: the org(s) have real, enabled policies — this is no
        # longer "not rolled out" territory. From here EVERY failure,
        # including one surfaced only when this `with` block's session
        # COMMITS on exit (not just failures inside the query/insert calls
        # themselves), must be a genuine degrade routed to `_fail_degraded`
        # (loud + flagged), never silently reinterpreted as "not rolled
        # out" by evaluate()'s outer `ProgrammingError`/`OperationalError`
        # catches. Wrapping the WHOLE `with get_session()` statement (not
        # just its body) is what pulls the session's implicit
        # commit-on-exit inside this net: an IntegrityError/ProgrammingError
        # raised only at commit time (e.g. a unique constraint on the
        # approval-request INSERT that only trips once a concurrent
        # writer's own commit has already landed) would otherwise propagate
        # straight past this function and be misclassified by evaluate()'s
        # bare `except ProgrammingError` as "tables not present" — silently
        # ALLOWING a transaction that actually hit a real write conflict.
        decision: Optional[OrgPolicyDecision] = None
        try:
            with get_session() as session:
                # C2: serialize concurrent evaluations for THIS user within
                # one postgres transaction. See _acquire_user_evaluation_lock
                # for what this does and does not close. Moved inside this
                # try (previously it ran unguarded between the phase-1 and
                # phase-2 blocks) — a lock-acquisition failure is exactly
                # the kind of genuine degrade this phase exists to catch,
                # not a "not rolled out" signal.
                self._acquire_user_evaluation_lock(session, user_id)

                owned_norm = {
                    _normalize_dest_address(chain, a) for a in (owned_addresses or ()) if a
                }

                # allowlist_only (hard block, no approval path) sorts first
                # across ALL orgs so a hard block is never masked by a later
                # policy's approval path for the same tx, but the STRICTEST
                # outcome overall wins regardless of which org or policy
                # produced it (C1).
                policies.sort(
                    key=lambda p: (
                        0 if p.policy_type == "allowlist_only" else 1,
                        p.org_id,
                        p.created_at,
                    )
                )

                best: Optional[tuple] = None  # (severity, policy, outcome, reason)
                for policy in policies:
                    verdict = self._check_policy(
                        session=session,
                        policy=policy,
                        org_id=policy.org_id,
                        user_id=user_id,
                        chain=chain,
                        dest_address=dest_address,
                        amount_usd=amount_usd,
                        owned_addresses=owned_norm,
                    )
                    if verdict is None:
                        continue
                    outcome, reason = verdict
                    sev = _SEVERITY[outcome]
                    # Tie-break is deliberate: on a REQUIRES_APPROVAL tie only
                    # the FIRST objecting policy is carried into
                    # _require_approval, so one human approval satisfies every
                    # policy that escalated for this transaction ("one
                    # approval per transaction", not per policy). A later
                    # BLOCKED still overrides via strict `>`.
                    if best is None or sev > best[0]:
                        best = (sev, policy, outcome, reason)
                        if outcome is OrgPolicyOutcome.BLOCKED:
                            break  # nothing can be stricter than a hard block

                if best is None:
                    return _ALLOWED

                _, winning_policy, outcome, reason = best
                if outcome is OrgPolicyOutcome.BLOCKED:
                    decision = OrgPolicyDecision(
                        outcome=OrgPolicyOutcome.BLOCKED,
                        reason=reason,
                        policy_id=winning_policy.id,
                        policy_type=winning_policy.policy_type,
                        org_id=winning_policy.org_id,
                    )
                else:
                    decision = self._require_approval(
                        session,
                        winning_policy,
                        winning_policy.org_id,
                        user_id,
                        chain,
                        dest_address,
                        amount_usd,
                        surface,
                        reason,
                    )
        except Exception as e:  # noqa: BLE001 — reraised as _DegradedEvaluation
            raise _DegradedEvaluation(org_ids[0] if org_ids else None) from e

        # T1: the enterprise-dashboard visibility write happens AFTER the
        # evaluation session above has closed (committed/released), never
        # nested inside it. record_screening_event opens its OWN session —
        # calling it while the evaluation session was still held meant every
        # decision held two pooled connections at once, and under load that
        # pool pressure could starve unrelated evaluations into hitting
        # their own connection-acquire failure and fail-OPEN. Only decisions
        # that aren't a plain allow are recorded, matching prior behaviour.
        #
        # EXCEPTION: an ALLOWED decision reached via approval-consumption
        # (see ``_require_approval``) already wrote its own screening_event
        # synchronously, IN the evaluation session, atomically with marking
        # the approval request consumed — that write must not be duplicated
        # (and must not risk showing an approved-and-spent request as still
        # "blocked" if it were re-derived here from a generic allowed=False
        # verdict). Skip the deferred write for that case only.
        if decision.outcome is not OrgPolicyOutcome.ALLOWED:
            self._record_screening(
                decision,
                user_id=user_id,
                org_id=decision.org_id,
                chain=chain,
                surface=surface,
                dest_address=dest_address,
            )
        return decision

    def _acquire_user_evaluation_lock(self, session, user_id: int) -> None:
        """Serialize concurrent org-policy EVALUATION READS for one user
        within a single postgres transaction, via a transaction-scoped
        advisory lock (``pg_advisory_xact_lock``) keyed on the user.

        PLAINLY: this lock does NOT close the ``execute_multi_swap`` race on
        its own, and must not be read as doing so. All it guarantees is that
        two ``evaluate()`` calls for the same user cannot run their
        ``daily_limit``/``velocity`` reads concurrently — it serializes
        *evaluation*, not *spend*. The ``SwapTransaction`` row those checks
        count against is created by ``SwapEngine.execute_swap`` only AFTER
        this ``evaluate()`` call has already returned ``ALLOWED`` and this
        lock has already been released (see swap_engine.py — the record is
        created well after the org-policy gate, not before it). So even with
        this lock held for the full duration of each individual evaluation:

          * Two concurrent legs of the SAME multi-swap (fired via
            ``asyncio.gather``) queue on this lock and evaluate one at a
            time, but the FIRST leg's read still doesn't see the SECOND
            leg's spend (it hasn't written a row yet, lock or no lock) — so
            both can still be evaluated against the same pre-write total and
            both pass a limit only one of them should have. The lock
            *removes the nondeterministic interleaving*; it does not make
            the second leg's read see the first leg's not-yet-persisted
            amount.
          * A wholly separate swap that commits its row just after this
            lock is released (but before this evaluation's own resulting
            swap row exists) can also still be under-counted.

        Closing the race for real requires a pre-gate reservation: the
        counted row (or a placeholder reservation) must exist BEFORE the
        policy read runs, not after — a change to swap-creation ordering
        that this fix does not make. Until that reservation mechanism
        exists, treat ``org_policy_enforcement_enabled`` as OFF by default
        (see ``bot.config.settings``) for any org relying on
        ``daily_limit``/``velocity`` policies to be race-free under
        concurrent execution.

        No-op on sqlite (tests/local dev): sqlite has no advisory-lock
        primitive and is single-writer per connection already.
        """
        try:
            from database.db import engine as _engine

            if _engine is None or _engine.dialect.name == "sqlite":
                return
        except Exception:  # noqa: BLE001 — lock plumbing must never break evaluation
            return

        from sqlalchemy import text

        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"org_policy:{user_id}"},
        )

    def _check_policy(
        self,
        *,
        session,
        policy,
        org_id: str,
        user_id: int,
        chain: Optional[str],
        dest_address: Optional[str],
        amount_usd: Optional[float],
        owned_addresses: set,
    ) -> Optional[tuple]:
        """Pure verdict for a single policy — performs NO session writes (a
        write only ever happens once, for the overall strictest winner
        across every org/policy — see ``_evaluate_sync``). Returns ``None``
        when this policy has no objection to the transaction, else
        ``(OrgPolicyOutcome, human_reason)``.

        C5: a policy that exists (enabled, in scope) but whose params are
        missing/unparseable, or whose ``policy_type`` is unrecognized, must
        never silently allow — that is a misconfigured or newer-than-this-
        code policy that is not actually enforcing anything, which is worse
        than not having the policy at all because the org admin believes
        it's live. It escalates to ``REQUIRES_APPROVAL`` (reason
        ``org_policy_invalid_params``) with a loud ``logger.error`` instead.
        """
        ptype = policy.policy_type
        params = policy.params or {}

        if ptype == "allowlist_only":
            return self._check_allowlist_only(
                session, policy, org_id, chain, dest_address, owned_addresses
            )

        if amount_usd is None:
            # C3: every other policy type is USD-denominated. amount_usd is
            # None whenever the token being moved can't be priced — which is
            # USER-CONTROLLED (pick an exotic/unpriced token) if this simply
            # skips the check, so an org with real USD policies would have
            # them trivially bypassable. Escalate instead of silently
            # allowing.
            return (
                OrgPolicyOutcome.REQUIRES_APPROVAL,
                "this org enforces a USD-denominated transfer policy "
                f"({ptype}) but this transaction's USD value could not be priced",
            )

        if ptype == "tx_limit":
            threshold = _num(params.get("thresholdUsd"))
            if threshold is None:
                logger.error(
                    "org policy %s (tx_limit) has a missing/invalid thresholdUsd param %r",
                    policy.id,
                    params.get("thresholdUsd"),
                )
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    "this org's per-transaction limit policy is misconfigured and could "
                    "not be evaluated",
                )
            if amount_usd > threshold:
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    f"transaction (${amount_usd:,.2f}) exceeds the org's per-transaction "
                    f"limit of ${threshold:,.2f}",
                )
            return None

        if ptype == "spending_tier":
            tier_upper = _num(params.get("tierUpperUsd"))
            threshold = _num(params.get("thresholdUsd"))
            if threshold is None:
                logger.error(
                    "org policy %s (spending_tier) has a missing/invalid thresholdUsd param %r",
                    policy.id,
                    params.get("thresholdUsd"),
                )
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    "this org's spending-tier policy is misconfigured and could not be "
                    "evaluated",
                )
            if tier_upper is not None and amount_usd <= tier_upper:
                return None  # within the free tier
            if amount_usd > threshold:
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    f"transaction (${amount_usd:,.2f}) exceeds the org's spending-tier "
                    f"threshold of ${threshold:,.2f}",
                )
            return None

        if ptype == "daily_limit":
            threshold = _num(params.get("thresholdUsd"))
            if threshold is None:
                logger.error(
                    "org policy %s (daily_limit) has a missing/invalid thresholdUsd param %r",
                    policy.id,
                    params.get("thresholdUsd"),
                )
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    "this org's daily-limit policy is misconfigured and could not be evaluated",
                )
            spent = self._daily_spend(session, user_id)
            projected = spent + amount_usd
            if projected > threshold:
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    f"24h spend (${projected:,.2f} incl. this tx) would exceed the org's "
                    f"daily limit of ${threshold:,.2f}",
                )
            return None

        if ptype == "velocity":
            window_hours = _num(params.get("windowHours"))
            max_tx_raw = params.get("maxTxPerWindow")
            max_tx_int: Optional[int] = None
            if max_tx_raw is not None:
                try:
                    max_tx_int = int(max_tx_raw)
                except (TypeError, ValueError):
                    max_tx_int = None
            if window_hours is None or max_tx_int is None:
                logger.error(
                    "org policy %s (velocity) has missing/invalid windowHours/"
                    "maxTxPerWindow params %r",
                    policy.id,
                    params,
                )
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    "this org's velocity policy is misconfigured and could not be evaluated",
                )
            count = self._velocity_count(session, user_id, window_hours)
            if count >= max_tx_int:
                return (
                    OrgPolicyOutcome.REQUIRES_APPROVAL,
                    f"{count} transactions in the trailing {window_hours}h window "
                    f"meets/exceeds the org's velocity limit of {max_tx_int}",
                )
            return None

        logger.error(
            "Unknown org policy_type %r on policy %s — escalating rather than silently "
            "allowing a policy that exists but can't be evaluated",
            ptype,
            policy.id,
        )
        return (
            OrgPolicyOutcome.REQUIRES_APPROVAL,
            f"this org has a policy of an unrecognized type ({ptype!r}) that could not be "
            "evaluated",
        )

    def _check_allowlist_only(
        self,
        session,
        policy,
        org_id: str,
        chain: Optional[str],
        dest_address: Optional[str],
        owned_addresses: set,
    ) -> Optional[tuple]:
        from bot.models.org_policy import OrgAllowlistAddress

        if not dest_address:
            # Nothing to allowlist-gate (e.g. no recipient in scope for this
            # call) — not this policy's concern.
            return None

        normalized = _normalize_dest_address(chain, dest_address)

        if owned_addresses and normalized in owned_addresses:
            # C6: allowlist_only must gate third-party destinations only.
            # ``swap_engine`` falls back to the initiating user's OWN
            # custodial wallet address as the recipient when a quote has no
            # distinct one (a same-wallet swap never actually leaves the
            # wallet), and ``paymaster`` tops up the user's own address to
            # sponsor gas. Neither is a "transfer out" this policy exists to
            # police — blocking them would brick swaps and gas sponsorship
            # outright for every org with allowlist_only enabled.
            return None

        chain_norm = (chain or "").strip().lower()
        hit = (
            session.query(OrgAllowlistAddress)
            .filter(
                OrgAllowlistAddress.org_id == org_id,
                func.lower(OrgAllowlistAddress.chain) == chain_norm,
                OrgAllowlistAddress.address == normalized,
            )
            .first()
        )
        if hit is not None:
            return None
        return (
            OrgPolicyOutcome.BLOCKED,
            f"destination address is not on the organization's allowlist for "
            f"{chain or 'this chain'}",
        )

    # Bound how many rows any single dedup/lookup query can pull back for one
    # (org, policy, requester) — an org with a runaway request volume for one
    # user must not turn this gate into an unbounded table scan on every
    # policy check.
    _APPROVAL_LOOKUP_LIMIT = 50
    # Cap on outstanding (pending, unexpired) approval requests per (org,
    # policy, requester) before a genuinely new ask is refused outright
    # instead of minting yet another row an admin will never work through.
    _PENDING_REQUEST_CAP = 10

    @staticmethod
    def _approval_payload_matches(
        payload: dict,
        *,
        chain: Optional[str],
        surface: str,
        dest_norm,
        amount_bucket,
        amount_usd=None,
        strict_amount: bool = False,
    ) -> bool:
        """Shared match predicate for both the approved-consumption lookup
        and the pending dedup lookup (C7 / finding 5): same destination
        (normalized) and amount (bucketed to 2 sig figs) is not enough on
        its own — two DIFFERENT policies/surfaces/chains can coincidentally
        share a destination+amount, and matching on those two fields alone
        would let an approval minted for e.g. a Telegram swap on chain A
        silently authorize an unrelated withdrawal on chain B for the same
        USD amount. Chain and surface must match too.
        """
        row_dest = payload.get("destAddress")
        row_dest_norm = _normalize_dest_address(chain, row_dest) if row_dest else row_dest
        row_amount = payload.get("amountUsd")
        row_bucket = _round_sigfigs(row_amount, 2) if isinstance(row_amount, (int, float)) else None
        row_chain_norm = (payload.get("chain") or "").strip().lower()
        chain_norm = (chain or "").strip().lower()
        if strict_amount:
            # Consumption path: an approval authorizes ONE transaction at the
            # approved value. The 2-sigfig bucket would let a $10,499 swap
            # redeem a $10,000 approval (both bucket to 10000) — allow only a
            # quote-wobble tolerance of 0.5% (min one cent).
            if amount_usd is None or not isinstance(row_amount, (int, float)):
                amount_ok = amount_usd is None and row_amount is None
            else:
                amount_ok = abs(float(amount_usd) - float(row_amount)) <= max(
                    0.005 * float(row_amount), 0.01
                )
        else:
            # Pending-dedup path: over-matching is harmless (it only avoids a
            # duplicate pending row), so the coarse bucket is fine.
            amount_ok = row_bucket == amount_bucket
        return (
            row_dest_norm == dest_norm
            and amount_ok
            and row_chain_norm == chain_norm
            and payload.get("surface") == surface
        )

    def _require_approval(
        self,
        session,
        policy,
        org_id: str,
        user_id: int,
        chain: Optional[str],
        dest_address: Optional[str],
        amount_usd: Optional[float],
        surface: str,
        reason: str,
    ) -> OrgPolicyDecision:
        from bot.models.org_policy import PolicyApprovalRequest

        now = datetime.now(timezone.utc)
        now_naive = now.replace(tzinfo=None)
        dest_norm = _normalize_dest_address(chain, dest_address) if dest_address else dest_address
        amount_bucket = _round_sigfigs(amount_usd, 2) if amount_usd is not None else None

        def _matches(payload: dict, *, strict_amount: bool = False) -> bool:
            return self._approval_payload_matches(
                payload,
                chain=chain,
                surface=surface,
                dest_norm=dest_norm,
                amount_bucket=amount_bucket,
                amount_usd=amount_usd,
                strict_amount=strict_amount,
            )

        # Approval-consumption: an org admin approving a request in the
        # dashboard previously had NO effect on the bot side — the swap that
        # triggered it had already failed with "requires approval" and the
        # user had no way to make it actually execute once approved (a dead
        # end). Look for an APPROVED, unexpired, not-yet-consumed request
        # for this exact (org, policy, requester, chain, surface,
        # destination, amount-bucket) before falling through to the pending
        # dedup/insert path below. A consumed row carries
        # ``payload["consumedAt"]`` and must never be matched again — a
        # single approval authorizes exactly one transaction.
        approved_candidates = (
            session.query(PolicyApprovalRequest)
            .filter(
                PolicyApprovalRequest.org_id == org_id,
                PolicyApprovalRequest.policy_id == policy.id,
                PolicyApprovalRequest.requested_by == user_id,
                PolicyApprovalRequest.status == "approved",
                PolicyApprovalRequest.request_type == "transaction",
                # SQL-side tombstone exclusion: consumed rows keep
                # status='approved' forever, so without this predicate they
                # burn the lookup limit and can starve out older live
                # approvals. JSON path indexing renders as `->` on Postgres
                # and JSON_EXTRACT on sqlite; a missing key is NULL on both.
                PolicyApprovalRequest.payload["consumedAt"].is_(None),
            )
            .order_by(PolicyApprovalRequest.created_at.desc())
            .limit(self._APPROVAL_LOOKUP_LIMIT)
            .all()
        )
        for row in approved_candidates:
            payload = row.payload or {}
            if payload.get("consumedAt"):
                continue  # already spent — a used approval never re-matches
            if row.expires_at is None:
                # api-ts lets a member create a request with no expiry
                # (caller-controlled payload, ALL_ROLES). A never-expiring
                # pre-staged approval would be redeemable forever, voiding
                # the 24h time-box this service assumes — refuse to consume.
                continue
            if row.expires_at <= now_naive:
                continue  # approved but expired before it was ever used
            if not _matches(payload, strict_amount=True):
                continue

            new_payload = dict(payload)
            new_payload["consumedAt"] = now.isoformat()
            new_payload["consumedTx"] = {
                "surface": surface,
                "chain": chain,
                "destAddress": dest_address,
                "amountUsd": amount_usd,
            }
            row.payload = new_payload
            session.add(row)

            # Written directly on THIS session, atomically with the
            # consumed-marker above (unlike the normal deferred
            # `_record_screening` — see the T1 comment in `_evaluate_sync`):
            # losing this write is not just a dashboard visibility gap, it
            # would leave an approval marked consumed with no audit trail of
            # what it was consumed for.
            from bot.models.compliance import ScreeningEvent

            session.add(
                ScreeningEvent(
                    user_id=user_id,
                    org_id=org_id,
                    chain=chain,
                    direction="outbound",
                    address=dest_address,
                    decision="allowed",
                    reason="org_policy_approved",
                    mode="enforce",
                    tx_context={
                        "surface": surface,
                        "policy_id": policy.id,
                        "policy_type": policy.policy_type,
                        "approval_request_id": row.id,
                    },
                )
            )
            session.flush()

            required_approvals = row.required_approvals or (policy.required_approvals or 1)
            return OrgPolicyDecision(
                outcome=OrgPolicyOutcome.ALLOWED,
                reason=(
                    f"{reason} — approved by an org admin (request {row.id}); " "consuming approval"
                ),
                policy_id=policy.id,
                policy_type=policy.policy_type,
                approval_request_id=row.id,
                required_approvals=required_approvals,
                org_id=org_id,
            )

        # C7: a blocked retry (user re-sends the same swap after seeing
        # "requires approval", or a caller retries on a transient error)
        # must not spam a fresh pending row every time — an org admin would
        # otherwise have to triage a growing pile of rows that are really
        # the same ask. Reuse an existing pending, unexpired request for the
        # same org/policy/requester/chain/surface whose destination and
        # amount (bucketed to 2 significant figures, so a quote wobble of a
        # few cents still matches) line up with this one.
        pending_candidates = (
            session.query(PolicyApprovalRequest)
            .filter(
                PolicyApprovalRequest.org_id == org_id,
                PolicyApprovalRequest.policy_id == policy.id,
                PolicyApprovalRequest.requested_by == user_id,
                PolicyApprovalRequest.status == "pending",
                PolicyApprovalRequest.expires_at.isnot(None),
                PolicyApprovalRequest.expires_at > now_naive,
            )
            .order_by(PolicyApprovalRequest.created_at.desc())
            .limit(self._APPROVAL_LOOKUP_LIMIT)
            .all()
        )
        pending_count = len(pending_candidates)
        for row in pending_candidates:
            payload = row.payload or {}
            if payload.get("consumedAt"):
                continue  # defensive — pending rows are never consumed
            if not _matches(payload):
                continue
            required_approvals = row.required_approvals or (policy.required_approvals or 1)
            return OrgPolicyDecision(
                outcome=OrgPolicyOutcome.REQUIRES_APPROVAL,
                reason=(
                    f"{reason} — reusing an existing pending approval request "
                    f"(requires {required_approvals} approval"
                    f"{'s' if required_approvals != 1 else ''})"
                ),
                policy_id=policy.id,
                policy_type=policy.policy_type,
                approval_request_id=row.id,
                required_approvals=required_approvals,
                org_id=org_id,
            )

        # No pending row to reuse. If this (org, policy, requester) already
        # has `_PENDING_REQUEST_CAP` or more outstanding unexpired requests,
        # refuse to mint yet another one — an unbounded pile of near-
        # duplicate asks is both a storage/lookup-cost growth issue (finding
        # 6) and an admin-triage problem in its own right. `pending_count`
        # is a lower bound (capped by `_APPROVAL_LOOKUP_LIMIT`), which is
        # fine here: hitting the lookup limit already means the cap is blown.
        if pending_count >= self._PENDING_REQUEST_CAP:
            return OrgPolicyDecision(
                outcome=OrgPolicyOutcome.BLOCKED,
                reason=(
                    "org_policy_pending_cap: too many pending approval requests already "
                    "exist for this org policy and requester — ask an org admin to "
                    "resolve the existing queue before retrying"
                ),
                policy_id=policy.id,
                policy_type=policy.policy_type,
                org_id=org_id,
            )

        request_id = str(uuid.uuid4())
        required_approvals = policy.required_approvals or 1
        session.add(
            PolicyApprovalRequest(
                id=request_id,
                org_id=org_id,
                policy_id=policy.id,
                requested_by=user_id,
                request_type="transaction",
                payload={
                    "surface": surface,
                    "chain": chain,
                    "destAddress": dest_address,
                    "amountUsd": amount_usd,
                    "policyId": policy.id,
                    "policyType": policy.policy_type,
                },
                status="pending",
                required_approvals=required_approvals,
                expires_at=(now + timedelta(hours=24)).replace(tzinfo=None),
                created_at=now_naive,
            )
        )
        session.flush()
        return OrgPolicyDecision(
            outcome=OrgPolicyOutcome.REQUIRES_APPROVAL,
            reason=(
                f"{reason} — an approval request has been created "
                f"(requires {required_approvals} approval"
                f"{'s' if required_approvals != 1 else ''})"
            ),
            policy_id=policy.id,
            policy_type=policy.policy_type,
            approval_request_id=request_id,
            required_approvals=required_approvals,
            org_id=org_id,
        )

    def _daily_spend(self, session, user_id: int) -> float:
        from bot.models.swap import SwapStatus, SwapTransaction

        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).replace(tzinfo=None)
        # C2: count every NON-TERMINAL status too (pending/quote_received/
        # awaiting_approval/approved/signed/executing/submitted/confirming),
        # not just COMPLETED. Concurrent swaps (execute_multi_swap's
        # asyncio.gather fires N legs at once) all reach this check before
        # any of them reaches COMPLETED, so counting only completed rows let
        # every concurrent leg pass a limit only one of them should have.
        # FAILED/CANCELLED are excluded — they never moved funds. See
        # _acquire_user_evaluation_lock for the residual TOCTOU this doesn't
        # close on its own.
        excluded = {SwapStatus.FAILED.value, SwapStatus.CANCELLED.value}
        total = (
            session.query(func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0.0))
            .filter(
                SwapTransaction.user_id == user_id,
                # SQL `NOT IN` is NULL-unsafe: `NULL NOT IN (...)` evaluates
                # to NULL (falsy), so a row with a NULL status would be
                # silently excluded from this filter — undercounting spend
                # for any in-flight/legacy row that hasn't had its status
                # column populated yet. A NULL status is not a terminal
                # (FAILED/CANCELLED) status, so it must count.
                or_(
                    SwapTransaction.status.is_(None),
                    SwapTransaction.status.notin_(excluded),
                ),
                SwapTransaction.created_at >= cutoff,
            )
            .scalar()
        )
        return float(total or 0.0)

    def _velocity_count(self, session, user_id: int, window_hours: float) -> int:
        from bot.models.swap import SwapStatus, SwapTransaction

        cutoff = (datetime.now(timezone.utc) - timedelta(hours=float(window_hours))).replace(
            tzinfo=None
        )
        # C2: see _daily_spend — count non-terminal statuses too, for the
        # same concurrent-swap reason.
        excluded = {SwapStatus.FAILED.value, SwapStatus.CANCELLED.value}
        count = (
            session.query(func.count(SwapTransaction.id))
            .filter(
                SwapTransaction.user_id == user_id,
                # See _daily_spend — `NOT IN` is NULL-unsafe; a NULL status
                # row must still count (it isn't FAILED/CANCELLED).
                or_(
                    SwapTransaction.status.is_(None),
                    SwapTransaction.status.notin_(excluded),
                ),
                SwapTransaction.created_at >= cutoff,
            )
            .scalar()
        )
        return int(count or 0)

    # --- enterprise-dashboard visibility (best-effort, never raises) -------

    def _record_screening(
        self,
        decision: OrgPolicyDecision,
        *,
        user_id: Optional[int],
        org_id: Optional[str],
        chain: Optional[str],
        surface: str,
        dest_address: Optional[str],
    ) -> None:
        try:
            from bot.services.compliance import record_screening_event

            # A hard BLOCKED outcome is an enforced block (dashboard
            # decision="blocked"); REQUIRES_APPROVAL is an escalation that
            # is NOT itself blocking the tx path forever — it's awaiting a
            # human — so it must render as decision="flagged", not
            # "blocked", or the dashboard can't tell an approval queue item
            # from a hard denial. See ``_screening_result_for``.
            result = _screening_result_for(
                f"org_policy_{decision.policy_type}",
                allowed=False,
                mode_enforce=decision.outcome is OrgPolicyOutcome.BLOCKED,
            )
            record_screening_event(
                result,
                user_id=user_id,
                org_id=org_id,
                chain=chain,
                direction="outbound",
                address=dest_address,
                tx_context={
                    "surface": surface,
                    "policy_id": decision.policy_id,
                    "policy_type": decision.policy_type,
                    "outcome": decision.outcome.value,
                    "approval_request_id": decision.approval_request_id,
                    "reason": decision.reason,
                },
            )
        except Exception as e:  # noqa: BLE001 — persistence-only, never break the tx
            logger.warning("Failed to record org_policy screening event: %s", e)

    def _record_degraded(
        self,
        user_id: Optional[int],
        org_id: Optional[str],
        chain: Optional[str],
        surface: str,
        dest_address: Optional[str],
    ) -> None:
        try:
            from bot.services.compliance import record_screening_event

            result = _screening_result_for("org_policy_degraded", allowed=True)
            record_screening_event(
                result,
                user_id=user_id,
                org_id=org_id,
                chain=chain,
                direction="outbound",
                address=dest_address,
                tx_context={"surface": surface, "reason": "org_policy_degraded"},
            )
        except Exception as e:  # noqa: BLE001 — persistence-only, never break the tx
            logger.warning("Failed to record org_policy degraded screening event: %s", e)


# Global instance — mirrors compliance_service's singleton pattern.
org_policy_service = OrgPolicyService()
