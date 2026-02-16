<!-- Created: 2026-02-16 -->
<!-- Last verified: 2026-02-16 -->
<!-- Next review: 2026-03-16 -->

# ADR 003: Topic-Based Memory Organization with Numbered Hierarchy

**Date:** 2026-02-16
**Status:** Accepted
**Decision Makers:** Based on industry research

---

## Context

Claude Code's auto memory system provides persistent context across sessions, but needs organization to be effective.

**Initial approach (before this ADR):**
- Single MEMORY.md file with all context
- Flat file structure
- No clear prioritization

**Problems:**
- Hard to find specific information
- MEMORY.md approaching 200-line limit (Claude can only process ~150-200 instructions)
- Unclear what's critical vs. nice-to-have
- No documentation of "why" behind decisions

**Research findings:**
- Anthropic recommends <200 instructions in primary memory
- Industry uses numbered hierarchy (Cursor, Kilo Code, Cline)
- ADRs (Architecture Decision Records) capture decision rationale
- Temporal metadata prevents staleness

---

## Decision

**Implement three-tier Memory Bank structure:**

```
memory/
├── MEMORY.md                    # Main index (<200 lines)
├── 1-core/                      # Priority 1: Critical knowledge
│   ├── credentials.md
│   ├── git-workflows.md
│   └── shell-tools.md
├── 2-patterns/                  # Priority 2: Learned patterns
│   ├── debugging.md
│   ├── nodejs-patterns.md
│   ├── aws-patterns.md
│   ├── blockchain-dev.md
│   └── claude-usage.md
└── 3-decisions/                 # ADRs (this file is one)
    ├── 001-github-account-separation.md
    ├── 002-sw-worktree-workflow.md
    └── 003-topic-based-memory-organization.md
```

**Numbering convention:**
- `1-core/` - Auto-loaded, critical for every session
- `2-patterns/` - Referenced on-demand, accumulate over time
- `3-decisions/` - Document "why" with full context

---

## Rationale

### Why Numbered Folders?

**Indicates priority to Claude:**
- Claude reads "1-core" and knows it's high priority
- Helps Claude decide what to load first
- Clear hierarchy without ambiguity

**Industry standard:**
- Cursor Memory Bank uses 1-6 numbering
- Kilo Code uses same pattern
- Makes structure immediately recognizable

### Why Separate Core from Patterns?

**Different access patterns:**
- Core: needed every session (GitHub accounts, project locations)
- Patterns: needed when encountering specific situations (debugging, AWS)

**Prevents MEMORY.md bloat:**
- Core stays small and focused
- Patterns can grow unbounded without affecting startup

### Why ADRs?

**Documents "why" not just "what":**
- Future you (or teammates) understands rationale
- Prevents re-litigating past decisions
- Creates searchable decision history

**Example:** This ADR explains why we organized memory this way, so future sessions don't question the structure.

---

## Consequences

### Benefits

✅ **Stays under 200-line limit**
- MEMORY.md is just an index (~170 lines)
- Detailed content in topic files
- Can grow indefinitely without hitting limit

✅ **Faster memory access**
- Claude loads critical info first (1-core)
- Defers pattern loading until needed
- Reduces token usage at startup

✅ **Clear organization**
- No ambiguity about where to put new knowledge
- Topic-based filing is intuitive
- Numbers indicate importance

✅ **Captures decision rationale**
- ADRs document "why" with full context
- Future sessions understand past decisions
- Prevents context loss over time

✅ **Industry-aligned**
- Follows best practices from Anthropic, Cursor, Kilo
- Easy to adopt additional patterns from community
- Recognizable structure for anyone familiar with AI coding tools

### Drawbacks

❌ **More files to manage**
- Topic files need periodic review
- Must remember where to file new info
- More files = more potential for staleness

❌ **Indirection for Claude**
- Claude must follow links to get details
- Slightly more token usage (references)
- Requires good link hygiene

❌ **Initial migration effort**
- Had to move files into new structure
- Update MEMORY.md references
- Create ADRs for existing decisions

### Mitigation Strategies

**For file management:**
- Run monthly verification script (checks freshness)
- Document filing logic in this ADR
- Use consistent naming (topic-based)

**For indirection:**
- MEMORY.md has quick reference (no link needed for basics)
- Topic files are small and focused
- Claude can read full file quickly

**For migration effort:**
- One-time cost (already done)
- Templates for future ADRs
- Benefits compound over time

---

## Filing Logic (Decision Tree)

**Where does new knowledge go?**

```
New information discovered
    ↓
Is it critical for EVERY session?
    ↓
    YES → 1-core/<topic>.md
    |     (GitHub accounts, project locations, sw command)
    |
    NO → Is it a learned pattern?
         ↓
         YES → 2-patterns/<topic>.md
         |     (Debugging, code style, cloud patterns)
         |
         NO → Is it a major decision with rationale?
              ↓
              YES → 3-decisions/NNN-<name>.md (ADR)
              |     (Why we do X instead of Y)
              |
              NO → Add to MEMORY.md quick reference
                   (If doesn't fit categories, might not belong)
```

**Topic file guidelines:**
- `credentials.md` - Auth (GitHub, AWS, SSH)
- `shell-tools.md` - Custom commands (sw, aliases)
- `git-workflows.md` - Git conventions (commits, branches)
- `debugging.md` - Recurring issues + solutions
- `nodejs-patterns.md` - Node/TS/Bun conventions
- `aws-patterns.md` - AWS CLI patterns
- `blockchain-dev.md` - Blockchain-specific patterns
- `claude-usage.md` - How you work with Claude

---

## ADR Template

**For new ADRs, use this structure:**

```markdown
<!-- Created: YYYY-MM-DD -->
<!-- Last verified: YYYY-MM-DD -->
<!-- Next review: YYYY-MM-DD -->

# ADR NNN: <Title>

**Date:** YYYY-MM-DD
**Status:** Accepted | Rejected | Superseded
**Decision Makers:** Who decided

---

## Context
What's the situation and problem?

---

## Decision
What did we decide?

---

## Consequences

### Benefits
What are the upsides?

### Drawbacks
What are the downsides?

### Mitigation Strategies
How do we handle the drawbacks?

---

## Alternative Approaches Considered
What else did we consider and why not?

---

## Implementation
What's completed? What's ongoing?

---

## References
Links to related docs

---

## Review Schedule
When to re-evaluate?
```

---

## Temporal Metadata Convention

**All memory files include:**

```markdown
<!-- Created: YYYY-MM-DD -->
<!-- Last verified: YYYY-MM-DD -->
<!-- Next review: YYYY-MM-DD -->
```

**Why:**
- Identifies stale information
- Creates review cadence
- Prevents unbounded growth

**Verification script** checks these dates monthly.

---

## Implementation

**Completed:**
- ✅ Created 1-core, 2-patterns, 3-decisions directories
- ✅ Moved files into appropriate tiers
- ✅ Updated MEMORY.md with new structure
- ✅ Created first three ADRs (this is #3)
- ✅ Documented filing logic in this ADR

**Ongoing:**
- Add temporal metadata to all files (in progress)
- Create verification script
- Populate pattern files as knowledge emerges

---

## References

**Research sources:**
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Kilo Code: Memory Bank](https://kilo.ai/docs/advanced-usage/memory-bank)
- [Cursor: Memory Bank Pattern](https://docs.cline.bot/prompting/cline-memory-bank)

**Related files:**
- MEMORY.md - Main index
- RESEARCH_ANALYSIS.md - Deep dive on industry patterns
- QUICK_WINS.md - Implementation guide

---

## Review Schedule

- **First review:** 2026-03-16 (30 days)
- **Trigger for revision:** If filing is confusing or MEMORY.md exceeds 200 lines
- **Success criteria:** Knowledge easily findable, MEMORY.md stays under limit
