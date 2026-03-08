---
description: "Create a new Architecture Decision Record (ADR) in the memory system"
context: fork
---

# New Architecture Decision Record

## Steps

### 1. Determine next ADR number

```bash
ls -1 ~/.claude/projects/-Users-mongolraider/memory/3-decisions/ | grep "^[0-9]"
```

### 2. Create the ADR file

**Location:** `~/.claude/projects/-Users-mongolraider/memory/3-decisions/NNN-brief-title.md`

Use this template:

```markdown
<!-- Created: YYYY-MM-DD -->
<!-- Last verified: YYYY-MM-DD -->
<!-- Next review: YYYY-MM-DD (30 days) -->

# ADR NNN: <Title>

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Rejected | Superseded

## Context
What problem are we solving? What constraints exist?

## Decision
State the decision clearly and concisely.

## Consequences
### Benefits
- Benefit 1
### Drawbacks
- Drawback 1

## Alternatives Considered
### Alternative A — Rejected because: reason

## Implementation
- [ ] Item 1
- [ ] Item 2

## Review
- **Trigger for revision:** What would cause us to reconsider?
- **Success criteria:** How do we know this is working?
```

### 3. Fill in each section based on user's input or session context

### 4. If critical, add one-line reference to MEMORY.md

### 5. Report what was created
