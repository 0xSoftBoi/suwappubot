# Enterprise authority and governance

Suwappu's Enterprise control plane separates human governance authority from
machine credential authority. The goal is to make institutional execution
reviewable, revocable, least-privilege, and resistant to a single compromised
user or API key.

## Human roles

| Role | Workspace admin | Initiate | Approve | Audit | Machine credentials |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Admin/read and execution/read keys, but never both authorities on one key |
| Admin | Yes | No | No | Yes | Admin/read keys |
| Trader | No | Yes | No | No | Execution/read keys created by that trader |
| Approver | No | No | Yes | Yes | None |
| Auditor | No | No | No | Yes | None |
| Member | No | No | No | No | None |
| Viewer | No | No | No | No | None |

`member` remains for compatibility with older organizations. New operational
assignments should prefer the explicit Trader / Approver / Auditor roles.

Only the organization owner may grant Admin or Approver authority. An Admin can
invite lower-authority operational/read roles but cannot manufacture a peer
admin or an approver.

The owner membership row cannot be demoted in place because
`organizations.owner_id` is the canonical ownership record. Ownership transfer
requires a dedicated future workflow rather than mutating one side of that
relationship.

## Maker / checker execution

Policy-gated execution creates an `approval_requests` row. Human approval
authorization is:

- the direct human attached to an org-less request,
- the organization owner, or
- an explicit organization member with role `approver`.

Admin, Trader, Auditor, Member, and Viewer roles do not inherit approval power.

The same predicate is used by the TypeScript control plane and Telegram
approval handler. Step-up challenges are only issued to an authorized approval
actor.

Approval does not execute the transaction. The agent must re-submit the
approved economic terms; the server re-quotes, re-runs policy, validates the
approved core terms, and consumes the approval only after transaction
construction succeeds.

## Machine credentials

Enterprise API keys are human-principal-bound through `api_keys.created_by`.

A key's stored scopes are an upper bound. On every authenticated request,
Suwappu resolves the creator's **current** organization role and intersects the
stored scopes with the scopes that role may currently exercise.

Effective machine scope ceilings:

| Current creator role | Effective key scopes |
| --- | --- |
| Owner | `trade:read`, `swap:execute`, `admin` |
| Admin | `trade:read`, `admin` |
| Trader | `trade:read`, `swap:execute` |
| Approver / Auditor / Member / Viewer | none |

Consequences:

- demoting a human immediately reduces existing key authority;
- removing the creator from the organization invalidates their key authority;
- an Admin cannot create an execution credential;
- a Trader cannot create an administrative credential;
- one key may not combine `admin` and `swap:execute`;
- Trader users list and revoke only keys they created;
- Owner/Admin may manage the broader key inventory;
- Auditor may inspect key metadata but cannot create/revoke keys.

This is independent from key expiry and explicit revocation, both of which
remain enforced.

## Rate limits

Every API key can have an explicit per-minute request ceiling. A key ceiling may
not exceed the organization's configured ceiling. This lets an institution
bound a single automation independently from the organization-wide allowance.

## Audit evidence

The tamper-evident organization audit chain records:

- organization creation,
- organization metadata changes,
- member invitation,
- member role changes,
- member removal,
- API-key creation (metadata only; never raw secret material),
- API-key revocation,
- approval decisions and step-up activity through the existing approval trail.

The raw API secret is returned once and is never written to the audit log.

## Current boundary

This implementation provides explicit maker/checker roles and principal-bound
credentials. It does **not** yet claim multi-approver quorum, portfolio-level
role scoping, SAML/SCIM provisioning, or governance-change consensus. Those
require dedicated state and lifecycle rather than being simulated with UI
labels.

The next institutional-control layer should therefore be:

1. portfolio/workspace sub-scopes for members and credentials;
2. quorum approval votes for high-value actions;
3. governance-change approvals for role, policy, destination, and key changes;
4. identity-provider provisioning and lifecycle sync.
