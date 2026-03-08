---
description: "Create a new Architecture Decision Record (ADR) in the memory system"
---

# New Architecture Decision Record (ADR)

Create a new ADR to document a significant architectural or workflow decision with full context and rationale.

## What is an ADR?

Architecture Decision Records capture **why** decisions were made, not just **what** was decided. They help future you (and teammates) understand the context, alternatives considered, and trade-offs.

---

## Step-by-Step

### 1. Determine the Next ADR Number

Check existing ADRs:

```bash
ls -1 ~/.claude/projects/-Users-mongolraider/memory/3-decisions/ | grep "^[0-9]"
```

The next number is one higher than the last.

### 2. Create the ADR File

**Naming convention:** `NNN-brief-title.md` (e.g., `004-use-postgresql.md`)

**Location:** `~/.claude/projects/-Users-mongolraider/memory/3-decisions/`

### 3. Use the ADR Template

```markdown
<!-- Created: YYYY-MM-DD -->
<!-- Last verified: YYYY-MM-DD -->
<!-- Next review: YYYY-MM-DD -->

# ADR NNN: <Title>

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Rejected | Superseded
**Decision Makers:** Who decided (e.g., "User preference", "Team decision")

---

## Context

**What's the situation?**
- What problem are we solving?
- What constraints exist?
- What triggered this decision?

**Current state:**
- How do things work now?
- What's broken or suboptimal?

---

## Decision

**What did we decide?**

State the decision clearly and concisely.

**Key points:**
- Point 1
- Point 2
- Point 3

---

## Consequences

### Benefits

✅ **Benefit 1**
- Details

✅ **Benefit 2**
- Details

### Drawbacks

❌ **Drawback 1**
- Details

❌ **Drawback 2**
- Details

### Mitigation Strategies

**For drawback 1:**
- How we handle it

**For drawback 2:**
- How we handle it

---

## Alternative Approaches Considered

### 1. Alternative Name
**Rejected because:**
- Reason 1
- Reason 2

### 2. Alternative Name
**Rejected because:**
- Reason 1
- Reason 2

---

## Implementation

**Completed:**
- ✅ Item 1
- ✅ Item 2

**Ongoing:**
- Item 3
- Item 4

**Future:**
- Item 5

---

## References

- Link to related MEMORY.md section
- Link to related CLAUDE.md
- Link to external docs
- Link to related ADRs

---

## Review Schedule

- **First review:** YYYY-MM-DD (30 days)
- **Trigger for revision:** What would cause us to reconsider?
- **Success criteria:** How do we know this is working?
```

### 4. Fill in Each Section

**Context:**
- Explain the problem and constraints
- Provide background for future readers
- Include enough detail that someone unfamiliar with the situation can understand

**Decision:**
- Be specific and clear
- State what you're doing, not what you're NOT doing
- Include any key constraints or boundaries

**Consequences:**
- Be honest about both benefits and drawbacks
- Think through second-order effects
- Consider who is impacted

**Alternatives:**
- Show you considered other options
- Explain why they were rejected
- Helps future readers understand the decision landscape

**Implementation:**
- Track what's done vs. what's ongoing
- Makes it easy to see progress

**Review Schedule:**
- Set a reminder to revisit
- Define what would trigger a re-evaluation
- Establish success criteria

### 5. Update MEMORY.md (Optional)

If the ADR is **critical** for every session, add a quick reference to MEMORY.md:

```markdown
## Critical Decisions

- [ADR NNN: Title](./3-decisions/NNN-title.md) - One-line summary
```

### 6. Commit the ADR

```bash
cd ~
git add .claude/projects/-Users-mongolraider/memory/3-decisions/NNN-*.md
git commit -m "Add ADR NNN: <brief title>

Document decision to <what> because <why in one sentence>."
```

---

## Examples of Good ADR Topics

**Infrastructure Decisions:**
- "Use PostgreSQL instead of MongoDB"
- "Deploy to AWS ECS Fargate instead of EC2"
- "Use Redis for caching"

**Workflow Decisions:**
- "Use git worktrees for parallel development" (already documented as ADR 002)
- "Adopt trunk-based development"
- "Use feature flags for rollouts"

**Architecture Decisions:**
- "Adopt microservices architecture"
- "Use GraphQL instead of REST"
- "Implement CQRS pattern"

**Tooling Decisions:**
- "Use Bun instead of npm"
- "Adopt TypeScript for all new code"
- "Use Vitest instead of Jest"

**Security Decisions:**
- "Require 2FA for production deployments"
- "Use OAuth2 for authentication"
- "Separate GitHub accounts by organization" (already documented as ADR 001)

**Development Process:**
- "Require code review before merge"
- "Use Conventional Commits"
- "Topic-based memory organization" (already documented as ADR 003)

---

## When to Create an ADR

**DO create an ADR when:**
- ✅ The decision has long-term impact
- ✅ The decision affects multiple people/components
- ✅ You're choosing between multiple valid approaches
- ✅ The decision has significant trade-offs
- ✅ You want to prevent future re-litigation
- ✅ The "why" is not obvious from the code

**DON'T create an ADR for:**
- ❌ Trivial decisions (variable names, minor refactors)
- ❌ Reversible experiments
- ❌ One-off implementation details
- ❌ Decisions that are obvious from context

---

## ADR Statuses

- **Proposed:** Decision is being considered, not yet final
- **Accepted:** Decision is made and being implemented
- **Rejected:** Proposed decision was considered but rejected
- **Superseded:** Replaced by a newer ADR (link to the new one)
- **Deprecated:** No longer recommended, but not yet replaced

---

## Tips for Great ADRs

1. **Write for future you:** Assume you'll forget the context in 6 months
2. **Be concise but complete:** Every section should add value
3. **Include dates:** Context changes over time
4. **Link liberally:** Connect to related docs, ADRs, code
5. **Update as needed:** ADRs aren't immutable - update them if context changes
6. **Review periodically:** Set a review date and actually review
7. **Capture alternatives:** Show your thinking process
8. **Be honest about trade-offs:** Don't sugarcoat drawbacks

---

## Quick Checklist

Before finalizing your ADR:

- [ ] Title is clear and specific
- [ ] Context section explains the problem
- [ ] Decision is stated clearly
- [ ] Benefits and drawbacks are both listed
- [ ] Alternatives were considered
- [ ] Implementation status is tracked
- [ ] Review schedule is set
- [ ] Temporal metadata is added (created, verified, next review)
- [ ] File is committed to git

---

## See Also

- **Existing ADRs:** `~/.claude/projects/-Users-mongolraider/memory/3-decisions/`
- **ADR 003:** Documents the memory organization system itself
- **MEMORY.md:** Main index for memory system
- **QUICK_WINS.md:** Quick wins implementation guide
