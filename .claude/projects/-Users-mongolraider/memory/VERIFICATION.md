# Memory System Verification Checklist

Run these tests in new Claude Code sessions to verify the memory system is working:

## Test 1: Faster Session Starts (Suwappubot)

**Start new Claude session in:** `~/Desktop/suwappumain/worktrees/main`

**Ask Claude:**
- "What GitHub account should I use for this project?"
- "How do I create a new worktree?"
- "What AWS profile should I use?"

**Expected:**
- ✅ Claude immediately knows to use `0xSoftBoi` account
- ✅ Claude knows about `sw` command and can explain it
- ✅ Claude knows to use `Swappu` AWS profile

## Test 2: Command Recognition (Suwappubot)

**Ask Claude:**
- "Start the backend dev server"
- "Create a new worktree for feature-x"
- "How do I deploy to AWS?"

**Expected:**
- ✅ Suggests correct path and command for backend (api-ts)
- ✅ Uses `sw new feature-x` command
- ✅ Mentions `Swappu` AWS profile and references deployment docs

## Test 3: Account Verification (Both Projects)

**In Suwappubot, ask:**
- "I'm about to push changes"

**Expected:**
- ✅ Claude suggests running `gh auth status` to verify `0xSoftBoi`

**In op-stack-reth, ask:**
- "I'm about to push changes"

**Expected:**
- ✅ Claude suggests running `gh auth status` to verify `tomagsx`
- ✅ Claude NEVER suggests `0xSoftBoi` for this repo

## Test 4: Topic File References

**Ask Claude:**
- "What are the common shell aliases?"
- "What's the git commit message convention?"

**Expected:**
- ✅ Claude can reference shell-tools.md for aliases
- ✅ Claude knows about no "Co-Authored-By" rule from git-workflows.md

## Test 5: Project Structure Knowledge

**In Suwappubot, ask:**
- "What's the architecture of this project?"

**Expected:**
- ✅ Claude explains Python monolith, TypeScript API, webapp, mobile structure
- ✅ References CLAUDE.md in main worktree

**In op-stack-reth, ask:**
- "How do I start a local devnet?"

**Expected:**
- ✅ Claude suggests `make devnet` and explains Kurtosis
- ✅ References enhanced CLAUDE.md

## Warning Signs (Needs Adjustment)

- ❌ Claude asks "which GitHub account?" → Add more prominence to MEMORY.md
- ❌ Claude doesn't know about `sw` command → Check shell-tools.md is accessible
- ❌ Conflicting information between files → Consolidate and clarify
- ❌ Claude suggests outdated commands → Run audit and update
- ❌ MEMORY.md over 200 lines → Split into more topic files

## Success Metrics

**You'll know it's working when:**
1. Zero repetition of basic context (GitHub account, AWS profile)
2. Claude understands your custom tools (`sw` command)
3. Correct defaults without asking
4. Better suggestions based on past sessions
5. Faster onboarding to project work

---

**Last verified:** [Add date after running tests]
**Results:** [Add notes about what worked/what needs adjustment]
