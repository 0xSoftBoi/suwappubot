# Deep Research: State of the Art in AI Coding Assistant Memory Systems

**Research Date:** 2026-02-16
**Focus:** How top developers implement persistent memory for AI coding assistants

---

## Executive Summary

Our implementation (topic-based auto memory + hierarchical CLAUDE.md) aligns well with **industry best practices**, but research reveals advanced patterns we haven't yet implemented:

### What We Did Right ✅
- ✅ Topic-based organization (credentials, shell-tools, git-workflows)
- ✅ 200-line MEMORY.md limit (frontier models handle ~150-200 instructions)
- ✅ File pointers over code snippets (reduces staleness)
- ✅ Hierarchical CLAUDE.md (monorepo-ready)
- ✅ Separation of global vs project-specific context

### Advanced Patterns We're Missing 🔬
- 🔬 **Memory Bank System** - Structured markdown hierarchy beyond simple topics
- 🔬 **MCP Server Integration** - Cloud-based persistent memory via Model Context Protocol
- 🔬 **Knowledge Graph Architecture** - Semantic relationships between concepts
- 🔬 **Vector Embeddings + RAG** - Semantic search for memory retrieval
- 🔬 **Temporal Decay** - Memory aging and automatic cleanup

---

## Part 1: Core Architecture Patterns

### 1.1 The Three-Tier Memory Model

Research shows successful implementations use **three distinct memory layers**:

#### Tier 1: CLAUDE.md (Static Instructions)
**Purpose:** Explicit rules you write and maintain
**Scope:** Project-wide standards, architecture, preferences
**Loading:** Auto-loaded at startup into context window
**Size Limit:** ~150-200 instructions (frontier model capacity)

**Best Practice:**
> "Keep it Concise: Frontier thinking LLMs can follow approximately 150-200 instructions with reasonable consistency. Your CLAUDE.md file should contain as few instructions as possible."
> — [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

#### Tier 2: Auto Memory (Dynamic Knowledge)
**Purpose:** Claude discovers and records patterns automatically
**Scope:** Accumulated insights across sessions
**Loading:** First 200 lines of MEMORY.md loaded at startup
**Key Difference:** Claude writes this, not you

**Best Practice:**
> "Unlike CLAUDE.md (which you write for Claude), auto memory contains things Claude discovers during sessions."
> — [Yuanchang: Claude Code's Memory Evolution](https://yuanchang.org/en/posts/claude-code-auto-memory-and-hooks/)

#### Tier 3: Memory Bank (Structured Documentation)
**Purpose:** Detailed project context that evolves over time
**Scope:** Product specs, architecture decisions, implementation plans
**Loading:** Loaded on-demand (not auto-loaded)
**Format:** Numbered markdown files in hierarchical structure

**Example Structure:**
```
memory-bank/
├── 1-projectbrief.md         # Foundation
├── 2-productContext.md        # Product vision
├── 3-systemPatterns.md        # Architecture patterns
├── 4-techContext.md           # Tech stack details
├── 5-activeContext.md         # Current work
└── 6-progress.md              # Change log
```

**Best Practice:**
> "Files build upon each other in a clear hierarchy... prefixed with numbers to indicate their priority and reading order."
> — [Kilo Code: Memory Bank](https://kilo.ai/docs/advanced-usage/memory-bank)

### 1.2 Hierarchical CLAUDE.md in Monorepos

**How it works:**
- Claude walks **upward** from CWD to filesystem root
- Loads every CLAUDE.md along the path
- Subdirectory CLAUDE.md only load when you read files there (lazy loading)
- All loaded files are **additive** (combine, don't override)

**Example:**
```
/mymonorepo/
├── CLAUDE.md                  # Root: shared conventions
├── frontend/
│   └── CLAUDE.md              # Frontend-specific
├── backend/
│   └── CLAUDE.md              # Backend-specific
└── api/
    └── CLAUDE.md              # API-specific
```

**Key Behaviors:**
1. **Upward propagation:** Root CLAUDE.md applies to all subdirectories
2. **Sibling isolation:** `frontend/CLAUDE.md` never loads when working in `backend/`
3. **Lazy loading:** Subdirectory files load only when you access them
4. **Conflict resolution:** More specific instructions take precedence

**Global Configuration:**
Place `~/.claude/CLAUDE.md` in your home folder to apply to ALL sessions.

**Best Practice:**
> "CLAUDE.md files in subdirectories below your current working directory are NOT loaded at launch; they are only included when Claude reads files in those subdirectories."
> — [GitHub: shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice/blob/main/reports/claude-md-for-larger-mono-repos.md)

---

## Part 2: Advanced Memory Architectures

### 2.1 Model Context Protocol (MCP) Servers

**What is MCP?**
A protocol for AI assistants to connect to external memory services that persist across sessions, projects, and even different AI tools.

**Architecture:**
```
AI Assistant (Claude, Cursor, etc.)
    ↓ (MCP Protocol)
MCP Server (persistent memory service)
    ↓
Storage Backend (SQLite, Postgres, Knowledge Graph)
```

**Key Benefits:**
- **Cross-session persistence:** Memory survives terminal restarts
- **Cross-project sharing:** Patterns learned in one repo apply to others
- **Tool agnostic:** Works with Claude Code, Cursor, Windsurf, etc.
- **Cloud-based:** Team can share organizational knowledge

**Implementation Examples:**

**1. Local SQLite Approach:**
```javascript
// Basic MCP Memory Server
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

**2. Cloud-Based Approach:**
- Stores memories in PostgreSQL with vector embeddings
- Retrieves relevant context via semantic search
- Enables team-wide knowledge sharing

**Best Practice:**
> "Persistent memory systems solve the problem of developers repeatedly explaining project context by allowing AI agents to maintain and reference information across multiple sessions, projects, and terminal windows."
> — [Medium: Building Persistent Memory for AI Assistants](https://medium.com/@linvald/building-persistent-memory-for-ai-assistants-a-model-context-protocol-implementation-80b6e6398d40)

### 2.2 Knowledge Graph + Vector Embeddings (Hybrid Memory)

**The Problem with Simple Markdown:**
- Hard to query relationships between concepts
- No semantic search (must match exact keywords)
- Difficult to find relevant context automatically

**Solution: Knowledge Graph Architecture**

**Components:**
1. **Entities** - Primary nodes (e.g., "sw command", "worktree workflow")
2. **Relationships** - Connections (e.g., "sw command" → "manages" → "worktrees")
3. **Observations** - Facts about entities (e.g., "sw command located at ~/scripts/sw")

**Example:**
```
[GitHub Account: 0xSoftBoi]
    ├── used_for → [Repository: suwappubot]
    ├── never_use_for → [Repository: op-stack-reth]
    └── verification_command → "gh auth status"

[Repository: suwappubot]
    ├── uses_tool → [sw worktree manager]
    ├── aws_profile → "Swappu"
    └── remote_url → "github.com/0xSoftBoi/suwappubot.git"
```

**Query Examples:**
- "What GitHub account for suwappubot?" → Follow relationship to 0xSoftBoi
- "What tools manage worktrees?" → Semantic search finds "sw worktree manager"
- "Where is sw command located?" → Query entity observations

**Hybrid Approach (Best of Both Worlds):**
- **Knowledge Graph:** Structured queries, logical relationships
- **Vector Embeddings:** Semantic search for unstructured text
- **Combined:** Precise recall + fuzzy matching

**Implementation:**
```
Storage:
├── Knowledge Graph (Neo4j, SQLite with graph tables)
│   └── Structured entities and relationships
└── Vector Store (Qdrant, Pinecone, local embeddings)
    └── Semantic search on observations and docs
```

**Best Practice:**
> "Modern agent architectures often use a hybrid memory approach combining the precise, symbolic recall of a graph with the broad, semantic recall of vector embeddings."
> — [Skywork: Ivan Pospelov's Memory Bank](https://skywork.ai/skypage/en/ivan-pospelov-memory-bank-ai-engineers/1977982065296478208)

### 2.3 Temporal Memory & Automatic Decay

**The Staleness Problem:**
Without cleanup, memory systems grow unbounded and retrieval quality degrades.

**Solutions:**

**1. Timestamp-Based Weighting:**
```markdown
# credentials.md
<!-- Last verified: 2026-02-16 -->
GitHub account for suwappubot: 0xSoftBoi
```

**Retrieval Logic:**
- Recent memories (< 7 days): Weight = 1.0
- Older memories (7-30 days): Weight = 0.7
- Old memories (> 30 days): Weight = 0.3

**2. Automatic Eviction:**
- Set TTL (time-to-live) on memory entries
- Automatically remove after expiration
- User can "pin" critical memories

**3. Verification Prompts:**
- Periodically ask user: "Is this still accurate?"
- Mark unverified memories with lower confidence

**Best Practice:**
> "Use timestamps as metadata and weight recent memories higher during retrieval, or use built-in eviction policies to automatically remove old data, potentially combining both approaches."
> — [Medium: Memory Management for AI Agents](https://medium.com/@bravekjh/memory-management-for-ai-agents-principles-architectures-and-code-dac3b37653dc)

---

## Part 3: Memory Retrieval Strategies

### 3.1 When to Read Memory

**Research shows four common patterns:**

**1. Before Planning (Most Common)**
```
User: "Add authentication to the API"
    ↓
Read Memory: "What auth patterns does this project use?"
    ↓
Plan: "Use JWT with refresh tokens (per project pattern)"
    ↓
Execute
```

**2. Before Tool Calls**
```
Plan: "Push code to GitHub"
    ↓
Read Memory: "What GitHub account for this repo?"
    ↓
Execute: gh auth switch --user 0xSoftBoi
```

**3. On Explicit Trigger**
```
User: "Remember: we use pnpm, not npm"
    ↓
Write to memory immediately
```

**4. Continuous (Every Message)**
- Agent reads memory at start of every turn
- High token cost, but maximum context
- Best for frontier models with large context windows

**Best Practice:**
> "In agentic systems, critical design choices include when to read memory (before planning or before tool calls) and when to write memory (after every message, only after confirmation, or only after a task completes)."
> — [Yuanchang: Claude Code's Memory Evolution](https://yuanchang.org/en/posts/claude-code-auto-memory-and-hooks/)

### 3.2 Retrieval Algorithms

**1. Keyword Matching (Simple)**
```
Query: "GitHub account for suwappubot"
Match: credentials.md contains "suwappubot" + "GitHub account"
```

**Pros:** Fast, deterministic
**Cons:** Misses semantic matches (e.g., "git host for swap bot")

**2. Vector Similarity (Semantic)**
```
Query embedding: [0.2, 0.8, 0.3, ...]
Memory embeddings:
  - credentials.md section: [0.1, 0.9, 0.2, ...] → 0.95 similarity ✓
  - shell-tools.md section: [0.7, 0.1, 0.5, ...] → 0.42 similarity
```

**Pros:** Semantic understanding, fuzzy matching
**Cons:** Slower, requires embedding model

**3. Graph Traversal (Relationships)**
```
Query: "What AWS profile for suwappubot?"
Graph:
  [suwappubot] → uses_aws_profile → [Swappu]
```

**Pros:** Precise relationship queries
**Cons:** Requires structured knowledge graph

**4. Hybrid (Best Practice)**
- Start with semantic search (vector) to find relevant sections
- Use graph traversal for relationship queries
- Fall back to keyword match for exact lookups

**Best Practice:**
> "Vector search provides the semantic foundation by embedding current context and searching for stored embeddings with high similarity; more sophisticated approaches implement hierarchical systems where agents explicitly decide when to pull from long-term memory."
> — [Medium: Memory Management for AI Agents](https://medium.com/@bravekjh/memory-management-for-ai-agents-principles-architectures-and-code-dac3b37653dc)

---

## Part 4: What Top Developers Are Doing

### 4.1 Anthropic Engineering Best Practices

**Key Recommendations:**

1. **Keep CLAUDE.md Under 200 Instructions**
   - Frontier thinking models handle ~150-200 instructions
   - Smaller/non-thinking models handle fewer

2. **Prefer File Pointers Over Code Snippets**
   - ❌ Bad: `use this function: def foo(): ...`
   - ✅ Good: `see implementation at src/utils.py:42`

3. **Use Planning Before Execution**
   - Ask Claude to make a plan first
   - Explicitly tell it NOT to code until plan approved
   - Real power comes from deliberate planning, not faster autocomplete

4. **Avoid Linter Jobs**
   - Never send LLM to do linter's job
   - LLMs are expensive and slow vs. deterministic tools
   - Use eslint, prettier, ruff, etc. instead

**Source:** [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

### 4.2 HumanLayer Production Patterns

**Recommended CLAUDE.md Structure:**

```markdown
# CLAUDE.md

## Project Type & Stack
[Brief description]

## Architecture Overview
[High-level architecture with file pointers]

## Commands
[Common commands, not full documentation]

## Key Conventions
[Code style, naming, patterns]

## Gotchas & Constraints
[Common mistakes, things to avoid]
```

**Key Insights:**
- Keep each section **concise** (2-5 lines)
- Link to authoritative docs instead of duplicating
- Focus on **project-specific** decisions, not general knowledge
- Use bullet points for scannability

**Source:** [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)

### 4.3 Memory Bank Pattern (Cursor/Cline/Kilo)

**Structured Hierarchy:**

```
memory-bank/
├── 1-projectbrief.md          # What is this project?
├── 2-productContext.md         # Product vision & goals
├── 3-systemPatterns.md         # Architecture & design patterns
├── 4-techContext.md            # Tech stack, dependencies
├── 5-activeContext.md          # Current sprint/work
├── 6-progress.md               # Change log
└── decisions/                  # Architecture Decision Records
    ├── 001-use-postgresql.md
    └── 002-jwt-auth.md
```

**Key Benefits:**
1. **Numbered files** indicate reading order and priority
2. **Separation of concerns** - product vs. tech vs. active work
3. **Change log** captures evolution over time
4. **ADRs** document major decisions with rationale

**Plan/Act Mode:**
- **Plan mode:** AI writes to memory bank, proposes changes
- **Act mode:** AI executes changes (requires approval)
- Prevents accidental memory corruption

**Source:** [Kilo Code: Memory Bank](https://kilo.ai/docs/advanced-usage/memory-bank)

### 4.4 Enterprise Team Patterns

**Centralized CLAUDE.md Management:**

Organizations deploy company-wide CLAUDE.md files:

```
Organization Level:
~/.claude/CLAUDE.md
├── Security standards
├── Code review checklist
├── Deployment approval process
└── Compliance requirements

Project Level:
/project/CLAUDE.md
├── Team-specific conventions
├── Project architecture
└── Tech stack decisions

Personal Level:
~/.claude/CLAUDE.md.local (optional override)
```

**Best Practice:**
> "Organizations can deploy centrally managed CLAUDE.md files that apply to all users."
> — [How Claude's Memory Actually Works](https://rajiv.com/blog/2025/12/12/how-claude-memory-actually-works-and-why-claude-md-matters/)

---

## Part 5: Comparison to Our Implementation

### What We Built

```
~/.claude/projects/-Users-mongolraider/memory/
├── MEMORY.md                    # Main index (157 lines) ✅
├── credentials.md               # Auth patterns ✅
├── shell-tools.md               # sw command docs ✅
├── git-workflows.md             # Git conventions ✅
├── debugging.md                 # Placeholder
├── nodejs-patterns.md           # Placeholder
├── aws-patterns.md              # Placeholder
├── blockchain-dev.md            # Placeholder
└── claude-usage.md              # Placeholder
```

**Strengths:**
- ✅ Topic-based organization (aligns with best practices)
- ✅ Under 200-line limit (157 lines in MEMORY.md)
- ✅ Cross-references between files
- ✅ Separation of global vs. project context
- ✅ Hierarchical CLAUDE.md per project

**Gaps vs. Research:**

| Pattern | Our Status | Industry Practice |
|---------|-----------|-------------------|
| **Topic Files** | ✅ Implemented | Standard practice |
| **Memory Bank Hierarchy** | ❌ Missing | Common in Cursor/Cline |
| **MCP Integration** | ❌ Missing | Emerging standard |
| **Knowledge Graph** | ❌ Missing | Advanced implementations |
| **Vector Embeddings** | ❌ Missing | Best-in-class systems |
| **Temporal Decay** | ❌ Missing | Production necessity |
| **ADR Documentation** | ❌ Missing | Team best practice |
| **Plan/Act Mode** | ❌ Missing | Safety mechanism |

---

## Part 6: Recommended Improvements

### Phase 1: Memory Bank Structure (Quick Win)

**Add structured hierarchy to auto memory:**

```
~/.claude/projects/-Users-mongolraider/memory/
├── MEMORY.md                    # Main index (keep as-is)
├── 1-core/                      # Priority 1: Core knowledge
│   ├── credentials.md
│   ├── shell-tools.md
│   └── git-workflows.md
├── 2-patterns/                  # Priority 2: Learned patterns
│   ├── debugging.md
│   ├── nodejs-patterns.md
│   ├── aws-patterns.md
│   └── blockchain-dev.md
├── 3-decisions/                 # ADRs (Architecture Decision Records)
│   ├── 001-use-worktree-workflow.md
│   └── 002-github-account-separation.md
├── 4-active/                    # Current work context
│   └── current-session.md
└── 5-archive/                   # Old/deprecated knowledge
    └── archived-2026-01.md
```

**Benefits:**
- Numbered priorities guide Claude's attention
- ADRs document "why" behind decisions
- Active context separates current vs. historical
- Archive prevents unbounded growth

**Implementation:** 30 minutes of reorganization

### Phase 2: Temporal Metadata (Medium Effort)

**Add timestamps to all memory files:**

```markdown
<!-- Last verified: 2026-02-16 -->
<!-- Created: 2026-02-16 -->
<!-- Confidence: high -->

# Credentials

GitHub account for suwappubot: 0xSoftBoi
```

**Verification workflow:**

```bash
# Weekly cron job or manual check
find ~/.claude/projects/-Users-mongolraider/memory \
  -name "*.md" \
  -mtime +30 \
  -exec echo "Verify: {}" \;
```

**Benefits:**
- Identify stale information
- Prioritize recent learnings
- Audit memory accuracy over time

**Implementation:** 1-2 hours (add metadata + verification script)

### Phase 3: MCP Server (Advanced, High Value)

**Option A: Use Existing MCP Memory Server**

```json
// ~/.config/claude/mcp_settings.json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

**Benefits:**
- Cross-session persistence (survives Claude restart)
- Works with other AI tools (Cursor, etc.)
- No custom code needed

**Implementation:** 15 minutes setup

**Option B: Custom MCP Server with Knowledge Graph**

Build custom server with:
- SQLite for storage
- Entities + relationships model
- Semantic search via embeddings

**Benefits:**
- Full control over memory structure
- Graph queries for relationships
- Custom retrieval logic

**Implementation:** 2-3 days development

### Phase 4: Architecture Decision Records (Low Effort, High Value)

**Create ADR directory:**

```
~/.claude/projects/-Users-mongolraider/memory/3-decisions/
└── 001-github-account-separation.md
```

**Template:**

```markdown
# ADR 001: Separate GitHub Accounts by Repository

**Date:** 2026-02-16
**Status:** Accepted
**Context:** Using multiple GitHub accounts for different orgs
**Decision:** Use 0xSoftBoi for Suwappubot, tomagsx for OP Stack Reth
**Consequences:**
- ✅ Prevents accidental pushes to wrong repo
- ✅ Clear separation of work contexts
- ❌ Requires manual account switching
**Verification:** `gh auth status` before every push
```

**Benefits:**
- Documents "why" behind decisions
- Helps future you (or teammates) understand rationale
- Creates searchable decision history

**Implementation:** 30 minutes per ADR

---

## Part 7: Emerging Trends & Future

### 7.1 Self-Improving Memory Systems

**Cognee & Graphiti:**
- Memory systems that **automatically refine** themselves
- Extract structured knowledge from unstructured conversations
- Update relationships as new information arrives

**Example:**
```
Session 1: "We use pnpm for package management"
    → Memory: [Project] → uses_package_manager → [pnpm]

Session 2: "Actually, we switched to bun"
    → Memory Update: [Project] → uses_package_manager → [bun]
    → Archive old relationship with timestamp
```

**Source:** [Memgraph: From RAG to Graphs](https://memgraph.com/blog/from-rag-to-graphs-cognee-ai-memory)

### 7.2 Team-Wide Memory Sharing

**Cloud-Based Memory Banks:**
- Team shares organizational knowledge
- Junior devs benefit from senior insights automatically
- Patterns spread organically across team

**Example:**
```
Developer A fixes bug: "JWT tokens expire silently"
    → Memory: Bug pattern + solution
    ↓
Developer B encounters similar issue
    → AI suggests: "Similar to JWT bug (see ADR-042)"
```

**Privacy Concerns:**
- Requires opt-in consent
- Filter out sensitive/personal info
- Configurable sharing scopes

### 7.3 Multi-Modal Memory

**Beyond Text:**
- Screenshots of UI bugs
- Architecture diagrams
- Screen recordings of workflows

**Implementation:**
- Vision models extract text from images
- Store visual references alongside text
- Enable "show me how" queries

---

## Part 8: Action Items

### Immediate (This Week)

1. **Add Memory Bank Structure**
   - Create `1-core/`, `2-patterns/`, `3-decisions/` folders
   - Move existing files into appropriate tiers
   - Update MEMORY.md index

2. **Create First ADR**
   - Document GitHub account separation decision
   - Use as template for future ADRs

3. **Add Temporal Metadata**
   - Add `<!-- Last verified: YYYY-MM-DD -->` to all files
   - Create verification reminder

### Short-Term (This Month)

4. **Implement MCP Memory Server**
   - Start with official `@modelcontextprotocol/server-memory`
   - Test cross-session persistence
   - Evaluate if custom server needed

5. **Populate Pattern Files**
   - Fill debugging.md with real issues encountered
   - Add Node.js conventions as they emerge
   - Document AWS patterns from deployment sessions

### Long-Term (This Quarter)

6. **Knowledge Graph Exploration**
   - Evaluate if complexity justified for your use case
   - Consider starting with simple graph (SQLite)
   - Add vector embeddings if retrieval quality suffers

7. **Team Sharing (if applicable)**
   - Design privacy-safe sharing model
   - Set up shared memory bank for team patterns
   - Create contribution guidelines

---

## Part 9: Decision Matrix

**Should you implement feature X?**

| Feature | Effort | Value | Priority | Recommendation |
|---------|--------|-------|----------|----------------|
| Memory Bank Structure | Low | High | 1 | **Do now** |
| Temporal Metadata | Low | Medium | 2 | **Do this week** |
| ADR Documentation | Low | High | 1 | **Do now** |
| MCP Server (basic) | Low | High | 2 | **Do this month** |
| Knowledge Graph | High | Medium | 4 | Wait until retrieval issues |
| Vector Embeddings | Medium | Medium | 4 | Wait until graph built |
| Team Sharing | Medium | Varies | 5 | Only if working on team |
| Self-Improving Memory | High | High | 3 | Evaluate in Q2 2026 |

---

## Part 10: Conclusion

### What We Learned

1. **Our implementation is solid** - topic-based organization aligns with best practices
2. **Memory Bank structure** would add meaningful organization
3. **MCP integration** is becoming standard (low-hanging fruit)
4. **Knowledge graphs** are powerful but complex (wait for clear need)
5. **Temporal decay** is essential for production systems

### The Path Forward

**Conservative Approach (Recommended):**
1. Add Memory Bank structure (1-core, 2-patterns, 3-decisions)
2. Implement temporal metadata + verification
3. Integrate MCP memory server
4. Create ADRs for key decisions
5. Monitor retrieval quality before adding complexity

**Aggressive Approach:**
1. All of the above, plus:
2. Build custom MCP server with knowledge graph
3. Add vector embeddings for semantic search
4. Implement automatic memory refinement

**Our Recommendation:** Start conservative, add complexity only when needed.

---

## Sources & Further Reading

### Official Documentation
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code: Manage Memory](https://code.claude.com/docs/en/memory)
- [Model Context Protocol: Example Servers](https://modelcontextprotocol.io/examples)

### Best Practices & Guides
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Builder.io: How to Write a Good CLAUDE.md File](https://www.builder.io/blog/claude-md-guide)
- [Arize: CLAUDE.md Best Practices](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/)
- [Gend: Claude Skills and CLAUDE.md Guide](https://www.gend.co/blog/claude-skills-claude-md-guide)

### Memory Architecture
- [Medium: Memory Management for AI Agents](https://medium.com/@bravekjh/memory-management-for-ai-agents-principles-architectures-and-code-dac3b37653dc)
- [Medium: Building Persistent Memory for AI Assistants](https://medium.com/@linvald/building-persistent-memory-for-ai-assistants-a-model-context-protocol-implementation-80b6e6398d40)
- [Mem0: AI Agent Memory](https://mem0.ai/blog/memory-in-agents-what-why-and-how)

### Memory Bank Patterns
- [Kilo Code: Memory Bank](https://kilo.ai/docs/advanced-usage/memory-bank)
- [Lullabot: Supercharge AI Coding](https://www.lullabot.com/articles/supercharge-your-ai-coding-cursor-rules-and-memory-banks)
- [Cline: Memory Bank](https://docs.cline.bot/prompting/cline-memory-bank)

### Monorepo & Organization
- [GitHub: shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice/blob/main/reports/claude-md-for-larger-mono-repos.md)
- [Claude Blog: Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files)

### Knowledge Graphs & RAG
- [Memgraph: From RAG to Graphs](https://memgraph.com/blog/from-rag-to-graphs-cognee-ai-memory)
- [Neo4j: Graphiti Knowledge Graph Memory](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- [Medium: From RAG to GraphRAG](https://medium.com/gooddata-developers/from-rag-to-graphrag-knowledge-graphs-ontologies-and-smarter-ai-01854d9fe7c3)

### Advanced Topics
- [Yuanchang: Auto Memory & PreCompact Hooks](https://yuanchang.org/en/posts/claude-code-auto-memory-and-hooks/)
- [Rajiv Pant: How Claude's Memory Works](https://rajiv.com/blog/2025/12/12/how-claude-memory-actually-works-and-why-claude-md-matters/)
- [Builder.io: How I Use Claude Code](https://www.builder.io/blog/claude-code)
