"""Read-mostly SQLAlchemy mirrors of api-ts (Drizzle)-owned enterprise policy tables.

DDL OWNERSHIP: ``org_policies``, ``org_allowlist_addresses``,
``policy_approval_requests``, and ``organization_members`` are defined and
migrated by api-ts (``api-ts/src/db/schema/policies.ts`` /
``organizations.ts``), per ADR 0003 (shared Postgres database, each side
owns a subset of tables). These SQLAlchemy classes are mapped mirrors used
by ``bot.services.org_policy.OrgPolicyService`` to read policy config and
insert approval-request rows — they are deliberately:

  * NOT imported from ``bot/models/__init__.py`` (kept out of the eager
    import chain reachable at ``init_db()`` time), and
  * NOT added to ``database/db.py::_ensure_schema()``.

so ``Base.metadata.create_all()`` (which runs before ``_ensure_schema()``,
see ``database/db.py``) never has these classes registered at the point it
executes and can never accidentally create/alter a table that api-ts owns.
Every caller imports this module lazily, inside a function body, the same
way ``bot.services.compliance.screening_events`` lazily imports
``bot.models.compliance.ScreeningEvent``.

Column names/types mirror the Drizzle schema exactly (uuid primary/foreign
keys as ``String(36)``, jsonb params/payload columns). Do not widen or
rename columns here without updating the Drizzle schema first — python must
never drift ahead of the DDL it doesn't own.
"""

from __future__ import annotations

from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB

from database.db import Base


class OrganizationMember(Base):
    """Mirrors api-ts's ``organization_members`` (organizations.ts).

    C8: deliberately NO ``ForeignKey(...)`` wrappers on the columns that
    reference api-ts-owned tables (``organizations.id``, ``users.id``) —
    plain, indexed columns instead. No python model defines ``organizations``
    (it's Drizzle-owned, see the module docstring), so a bare
    ``Base.metadata.create_all()`` — which every test fixture that boots a
    fresh sqlite DB runs — would raise ``NoReferencedTableError`` the moment
    this module's classes are registered on ``Base``, even though these
    mirrors are never supposed to participate in DDL at all.
    """

    __tablename__ = "organization_members"

    id = Column(String(36), primary_key=True)
    organization_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    role = Column(String(20), nullable=False, default="member")
    invited_by = Column(Integer, nullable=True)
    joined_at = Column(DateTime, nullable=False)


class OrgPolicy(Base):
    """Mirrors api-ts's ``org_policies`` (policies.ts).

    ``params`` shape depends on ``policy_type`` — see
    ``bot.services.org_policy.service`` for the read contract per type
    (mirrors the PARAMS SHAPE comment on the Drizzle table).
    """

    __tablename__ = "org_policies"

    id = Column(String(36), primary_key=True)
    org_id = Column(String(36), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    policy_type = Column(String(30), nullable=False)
    params = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    required_approvals = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class OrgAllowlistAddress(Base):
    """Mirrors api-ts's ``org_allowlist_addresses`` (policies.ts)."""

    __tablename__ = "org_allowlist_addresses"

    id = Column(String(36), primary_key=True)
    org_id = Column(String(36), nullable=False, index=True)
    chain = Column(String(50), nullable=False)
    address = Column(String(255), nullable=False)
    label = Column(String(100), nullable=True)
    added_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False)


class PolicyApprovalRequest(Base):
    """Mirrors api-ts's ``policy_approval_requests`` (policies.ts).

    Python performs exactly two writes here: the INSERT when a policy
    escalates to ``requires_approval``, and a single UPDATE of ``payload``
    when an APPROVED request is consumed by a matching transaction
    (``OrgPolicyService._require_approval`` sets ``payload.consumedAt`` and
    ``payload.consumedTx``; api-ts's approve handler only ever writes
    ``status``/``resolved_at``, never ``payload``, so there is no clobber).
    The approve/reject/resolve workflow itself is owned by api-ts
    (``enterprisePolicies.ts``); python never updates ``status``.
    """

    __tablename__ = "policy_approval_requests"

    id = Column(String(36), primary_key=True)
    org_id = Column(String(36), nullable=False, index=True)
    policy_id = Column(String(36), nullable=True, index=True)
    requested_by = Column(Integer, nullable=True)
    request_type = Column(String(30), nullable=False)
    payload = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    required_approvals = Column(Integer, nullable=False, default=1)
    expires_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False)
