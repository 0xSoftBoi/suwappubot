---
description: "Verify memory system freshness and update verification dates"
---

# Memory System Health Check

Run health checks on the memory system to identify stale files and update verification dates.

---

## Quick Commands

### Check Freshness

```bash
~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh
```

This shows:
- ✅ Fresh (< 14 days old)
- ⚠️  Review soon (14-30 days old)
- ❌ Review needed (> 30 days old)

### Update Verification Date (After Review)

**For a specific file:**

```bash
# macOS version
sed -i '' "s/Last verified: .*/Last verified: $(date +%Y-%m-%d)/" <file>

# Example:
sed -i '' "s/Last verified: .*/Last verified: $(date +%Y-%m-%d)/" \
  ~/.claude/projects/-Users-mongolraider/memory/1-core/credentials.md
```

**For all core files (after batch review):**

```bash
for file in ~/.claude/projects/-Users-mongolraider/memory/1-core/*.md; do
  sed -i '' "s/Last verified: .*/Last verified: $(date +%Y-%m-%d)/" "$file"
  echo "Updated: $file"
done
```

---

## Step-by-Step Health Check

### 1. Run Verification Script

```bash
~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh
```

### 2. Review Flagged Files

**For ❌ files (> 30 days):**
1. Read the file carefully
2. Check if information is still accurate
3. Test any commands/workflows mentioned
4. Update content if needed
5. Update verification date

**For ⚠️  files (14-30 days):**
1. Quick scan for accuracy
2. Update verification date if correct
3. Schedule deeper review if uncertain

### 3. Update Verification Dates

After confirming a file's accuracy:

```bash
sed -i '' "s/Last verified: .*/Last verified: $(date +%Y-%m-%d)/" <file>
```

### 4. Commit Changes

```bash
cd ~
git add .claude/projects/-Users-mongolraider/memory/
git commit -m "Update memory verification dates ($(date +%Y-%m))"
```

---

## Review Checklist by Directory

### 1-core/ (Critical Knowledge)

**Files:**
- credentials.md
- git-workflows.md
- shell-tools.md

**What to check:**
- [ ] GitHub account assignments still correct?
- [ ] AWS profile info accurate?
- [ ] Verification commands work?
- [ ] sw command still at same location?
- [ ] Git conventions still followed?

**Test commands:**
```bash
# Verify GitHub auth still works
gh auth status

# Verify AWS profile exists
aws sts get-caller-identity --profile Swappu

# Verify sw command exists
type sw
```

### 2-patterns/ (Learned Patterns)

**Files:**
- debugging.md
- nodejs-patterns.md
- aws-patterns.md
- blockchain-dev.md
- claude-usage.md

**What to check:**
- [ ] Debugging patterns still relevant?
- [ ] New patterns to add?
- [ ] Outdated patterns to remove?
- [ ] Dependencies/tools changed?

**Add new patterns:**
If you discovered recurring issues/patterns since last review, add them now.

### 3-decisions/ (ADRs)

**Files:**
- 001-github-account-separation.md
- 002-sw-worktree-workflow.md
- 003-topic-based-memory-organization.md
- ... (more as added)

**What to check:**
- [ ] Decision still valid?
- [ ] Status correct (Accepted/Superseded)?
- [ ] Implementation section up to date?
- [ ] Success criteria met?
- [ ] Need to create new ADR?

**If decision changed:**
1. Update status to "Superseded"
2. Create new ADR documenting new decision
3. Link between old and new ADRs

---

## Monthly Maintenance Workflow

**Time required:** 15-30 minutes

### Week 1: Run Check

```bash
~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh > /tmp/memory-check.txt
cat /tmp/memory-check.txt
```

### Week 2-3: Review & Update

**Priority order:**
1. ❌ Files first (> 30 days)
2. ⚠️  Files next (14-30 days)
3. ✅ Files last (fresh)

**For each file:**
1. Read through content
2. Verify accuracy (test commands, check references)
3. Add/remove content as needed
4. Update verification date

### Week 4: Commit & Cleanup

```bash
# Review changes
git diff ~/.claude/projects/-Users-mongolraider/memory/

# Commit
git add .claude/projects/-Users-mongolraider/memory/
git commit -m "Monthly memory verification ($(date +%Y-%m))"
```

---

## Common Issues & Fixes

### Issue: Command No Longer Works

**Example:** `sw` command moved or changed

**Fix:**
1. Find new location: `which sw` or `type sw`
2. Update shell-tools.md with new location
3. Update verification date
4. Consider creating ADR if significant change

### Issue: Account/Credentials Changed

**Example:** New AWS profile or GitHub account

**Fix:**
1. Update credentials.md
2. Update any affected CLAUDE.md files
3. Create ADR if it's a policy change
4. Update verification date

### Issue: Pattern No Longer Relevant

**Example:** Debugging pattern for bug that's permanently fixed

**Fix:**
1. Move to archive section in file
2. Or remove entirely if no historical value
3. Update verification date

### Issue: Missing New Patterns

**Example:** Discovered recurring Node.js pattern

**Fix:**
1. Add to appropriate pattern file (e.g., nodejs-patterns.md)
2. Use proper format (example, explanation, gotchas)
3. Update verification date

---

## Archive Old Knowledge

If information is outdated but has historical value:

### Option 1: Archive Section

Add to the file:

```markdown
---

## Archive

### [Deprecated YYYY-MM-DD] Old Pattern Name

This pattern is no longer used because <reason>.

**Historical context:**
<what it was and why it mattered>

**Superseded by:**
<link to new approach or ADR>
```

### Option 2: Separate Archive File

Create `2-patterns/archived-YYYY.md` and move old content there.

---

## Automation Ideas (Future)

### Cron Job for Monthly Reminder

```bash
# Add to crontab: Run on 1st of each month at 9am
0 9 1 * * ~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh | mail -s "Memory Check" you@example.com
```

### Git Hook for Stale Detection

Pre-commit hook that warns if MEMORY.md hasn't been verified in 60 days.

### Claude Code Reminder

Add to claude-usage.md:
- Remind me on the 1st of each month to run memory check

---

## Success Metrics

**You're doing well if:**
- ✅ All files verified within 30 days
- ✅ No broken commands in documentation
- ✅ New patterns added regularly
- ✅ ADRs reflect actual decisions
- ✅ Verification script runs without errors

**Warning signs:**
- ❌ Files > 60 days old
- ❌ Multiple broken commands
- ❌ Patterns contradict reality
- ❌ ADRs out of sync with actual practices

---

## Quick Reference Card

**Weekly:**
```bash
# Quick check
~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh
```

**Monthly:**
```bash
# Full verification
~/.claude/projects/-Users-mongolraider/memory/verify-memory.sh
# Review flagged files
# Update dates after review
# Commit changes
```

**After Major Changes:**
```bash
# Update affected files
# Create ADR if decision made
# Run verification
# Commit
```

---

## See Also

- **verify-memory.sh:** The verification script
- **ADR 003:** Documents the memory organization system
- **QUICK_WINS.md:** Implementation guide
- **MEMORY.md:** Main index
