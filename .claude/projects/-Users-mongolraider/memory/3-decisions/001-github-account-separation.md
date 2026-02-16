<!-- Created: 2026-02-16 -->
<!-- Last verified: 2026-02-16 -->
<!-- Next review: 2026-03-16 -->

# ADR 001: Separate GitHub Accounts by Repository

**Date:** 2026-02-16
**Status:** Accepted
**Decision Makers:** User preference

---

## Context

Working with multiple organizations requires using different GitHub accounts:
- **0xSoftBoi**: Personal account for Suwappubot project
- **tomagsx**: Account for GlobalSettlementNetwork organization

Each repository must use its designated account to maintain proper attribution and access control.

**Problem:** Without strict account verification, it's easy to accidentally push code with the wrong GitHub account, causing:
- Commits attributed to wrong author
- Permission errors when pushing
- Potential security/access violations
- Organizational compliance issues

---

## Decision

**Use separate GitHub accounts strictly by repository:**

| Repository | GitHub Account | Never Use |
|------------|----------------|-----------|
| **suwappubot** | `0xSoftBoi` | ❌ tomagsx |
| **op-stack-reth** | `tomagsx` | ❌ 0xSoftBoi |

**Enforcement:**
1. Always verify account before any git push operation
2. Document account requirement in project CLAUDE.md files
3. Add verification to auto memory (credentials.md)
4. Create pre-push mental checklist

---

## Consequences

### Benefits

✅ **Prevents wrong-account pushes**
- Explicit verification step catches mistakes
- CLAUDE.md warnings provide immediate context
- Auto memory reminds Claude across sessions

✅ **Clear separation of work contexts**
- Personal (0xSoftBoi) vs. organization (tomagsx) clearly delineated
- Reduces cognitive load when switching projects

✅ **Organizational compliance**
- Each org has proper author attribution
- Maintains access control boundaries
- Audit trails are accurate

✅ **Better documentation**
- Decision rationale captured in ADR
- CLAUDE.md provides project-specific reminders
- Memory system prevents repetition

### Drawbacks

❌ **Requires manual account switching**
- Extra step before pushing: `gh auth switch --user <account>`
- Can't automate without potential security risks

❌ **Extra verification step**
- Must run `gh auth status` before every push
- Adds ~5 seconds to workflow

❌ **Potential for human error**
- Despite safeguards, still possible to forget
- No automated enforcement (by design - security risk)

### Mitigation Strategies

**For manual switching overhead:**
- Document in CLAUDE.md for each project
- Add to auto memory quick reference
- Use shell aliases if needed: `alias ghsw='gh auth switch --user'`

**For verification burden:**
- Make it habitual (always check before push)
- Use git hooks (optional, but requires setup)
- Add to pre-push checklist in workflows

**For human error:**
- Multiple layers of documentation (MEMORY.md + CLAUDE.md)
- Claude Code will remind in every session
- Fail fast: Better to catch wrong account than push incorrectly

---

## Verification Protocol

**Before any `git push` operation:**

```bash
# 1. Check active GitHub account
gh auth status
# Expected output:
#   ✓ Logged in to github.com as <expected-account>

# 2. If wrong account, switch
gh auth switch --user 0xSoftBoi   # For Suwappubot
gh auth switch --user tomagsx     # For OP Stack Reth

# 3. Verify remote URL matches account
git remote -v
# Should match expected account

# 4. Proceed with push
git push origin <branch>
```

---

## Implementation

**Completed:**
- ✅ Documented in MEMORY.md (credentials.md)
- ✅ Added to both project CLAUDE.md files with prominent warnings
- ✅ Created this ADR to explain rationale
- ✅ Established verification protocol

**Ongoing:**
- Monitor effectiveness over next 30 days
- Adjust if verification burden becomes too high
- Consider git hooks if manual process fails

---

## References

- **MEMORY.md**: Quick reference table with account assignments
- **credentials.md**: Detailed auth patterns and verification commands
- **Suwappubot CLAUDE.md**: Project-specific warning (0xSoftBoi only)
- **op-stack-reth CLAUDE.md**: Project-specific warning (tomagsx only, NEVER 0xSoftBoi)

**Remote URLs:**
- Suwappubot: `https://github.com/0xSoftBoi/suwappubot.git`
- OP Stack Reth: `https://github.com/GlobalSettlementNetwork/op-stack-reth.git`

---

## Review Schedule

- **First review:** 2026-03-16 (30 days)
- **Trigger for revision:** If wrong-account push occurs, review immediately
- **Success criteria:** Zero wrong-account pushes in 90 days
