---
description: "Parallel attacker-minded audit: fan out one security-auditor per attack surface, each streaming findings to disk, then dedupe/rank and file issues. Usage: /audit-fleet [scope hint]"
---

# Parallel Security Audit Fleet

The serial `/audit` repeatedly died at the spend limit before emitting parseable JSON. This version fans out narrow scopes and makes every finding **durable on disk the moment it is confirmed**, so an interrupted run still ships results.

## Step 1 — Map the attack surfaces
Use `scout` (haiku) to group the in-scope files into 4–6 **disjoint** scopes:
- `auth` — session/JWT/SIWE/telegramAuth, middleware, route mounting
- `money` — swap execution, balance mutations, fee math, withdrawals, redemptions
- `webhooks` — inbound HTTP: Telegram, WhatsApp, Stripe, x402
- `keys` — wallet encryption, KMS envelope, key derivation, recovery
- `jobs` — background services in `api/main.py` lifespan
Remember: **two backends** (`api/`+`bot/` Python, `api-ts/` TypeScript). Cover both.

Write the scope map to `.audit/scopes.json` before dispatching.

## Step 2 — Fan out (one `security-auditor` per scope, in ONE message)
Give each agent this contract verbatim:
> Trace real data flow from entrypoint to sink — do not pattern-match. After finishing **each file**, immediately append one JSON object per finding to `.audit/findings/<scope>.jsonl`:
> `{file, line, severity, title, exploit_path, preconditions, confidence, false_positive_reasoning}`
> Never buffer findings until the end. Mark false positives explicitly with why they are not exploitable. Keep your response short — detail goes to disk. Finish with a coverage note: what you did NOT look at and why.

## Step 3 — Reduce
Read all `.audit/findings/*.jsonl`, dedupe by `file:line`+title, rank by **exploitability × blast radius**. Write the ranked list to `.audit/report.md`.

## Step 4 — Prove and file
For each finding with `confidence >= high`:
1. Write a failing test under `tests/security/` that demonstrates the bug (`test-engineer`).
2. `gh issue create` with the exploit path and the test path.
Anything touching swap exec / keys / KMS / fees / withdrawals goes to `money-path-reviewer` (opus) before any fix is merged.

## Step 5 — Candid QA
End with: surfaces scanned, surfaces skipped and why, findings confirmed vs dismissed, and whether any agent was cut off mid-scope.
