---
description: "Attacker-minded security audit of scoped files. Traces auth + money-path data flows, streams compact findings incrementally (never one giant end-of-session JSON dump). Usage: /audit <file-or-glob> [attack-class]"
---

# Security Audit Skill

Runs the deep, adversarial review you commission by hand — but with the two habits that keep it from dying at a spend/output limit: **scope tightly** and **stream findings as you confirm them**.

Optional args: target files/globs and an optional attack class (`auth-bypass`, `replay`, `double-spend`, `idor`, `ssrf`, `secret-exposure`, `fee-math`). If no target given, ask for candidate files — do NOT "audit everything."

## Ground rules (why this skill exists)
- **Never batch findings for the end.** Append each *confirmed* finding to `findings.json` the moment you verify it. Spend limits repeatedly killed audits that saved the JSON for last and lost the whole deliverable.
- **Keep each response compact** (< ~500 output tokens). One finding at a time is fine.
- **Real bug vs false positive** must be stated explicitly for each item.
- This is a **money-path / auth review** — trace data flow from route → service → DB, not just single files.

## Step 0 — Scope + init the sink
```bash
TARGETS="$ARGUMENTS"            # files/globs passed to /audit
[ -z "$TARGETS" ] && echo "No target — ask user for candidate files, then stop." && exit 0
[ -f findings.json ] || echo '[]' > findings.json
echo "Auditing: $TARGETS"
```

## Step 1 — Route by attack class
For each target, trace at minimum:
- **Auth/authz**: who can call this? Is the caller's identity re-derived from a trusted source or trusted from client input? IDOR on any id param?
- **Money-path**: balance reads vs writes — any TOCTOU / double-spend race? Idempotency on payment/withdraw/redeem? Replay of a signed request?
- **Input**: SSRF on any outbound URL, injection into DB/shell, unvalidated amounts (negative, overflow, precision).
- **Secrets**: keys/tokens logged, returned in responses, or committed.

## Step 2 — Confirm, then append IMMEDIATELY
For each *confirmed* finding, append one object and report it in one short message:
```bash
python3 - <<'PY'
import json
f = json.load(open("findings.json"))
f.append({
  "severity": "critical|high|medium|low",
  "location": "path/to/file.py:123",
  "attack_class": "double-spend",
  "real_or_fp": "real",           # or "false-positive" with reasoning
  "exploit": "one-line attacker path",
  "fix": "one-line remediation",
})
json.dump(f, open("findings.json","w"), indent=2)
print("appended:", f[-1]["location"])
PY
```

## Step 3 — Candid coverage QA
End with: what you scanned, what you **skipped or could not verify**, and why. If a live exploit test is blocked, say "confirmed-by-reading, not exploited — needs X." Do not claim thoroughness you didn't reach.

For any confirmed money-path finding, hand the fix to `money-path-reviewer` (opus) before shipping.
