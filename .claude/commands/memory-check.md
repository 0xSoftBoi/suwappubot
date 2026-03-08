---
description: "Verify memory system freshness and update verification dates"
context: fork
---

# Memory System Health Check

## Steps

### 1. Check file freshness

Read all `*.md` files in `~/.claude/projects/-Users-mongolraider/memory/` recursively. For each file, check the `<!-- Last verified: YYYY-MM-DD -->` header.

Report:
- Fresh (< 14 days): no action needed
- Review soon (14-30 days): quick scan for accuracy
- Review needed (> 30 days): read carefully, verify commands work

### 2. Verify accuracy of flagged files

For files needing review:
- Test any bash commands documented (e.g., `gh auth status`, `aws sts get-caller-identity`)
- Check file paths still exist
- Verify information matches reality

### 3. Update verification dates

After confirming a file is accurate:

```bash
sed -i '' "s/Last verified: .*/Last verified: $(date +%Y-%m-%d)/" <file>
```

### 4. Report summary

```
Memory Health Check (YYYY-MM-DD):
  credentials.md:    [fresh|review|stale] - Last verified: YYYY-MM-DD
  git-workflows.md:  [fresh|review|stale] - Last verified: YYYY-MM-DD
  shell-tools.md:    [fresh|review|stale] - Last verified: YYYY-MM-DD
  aws-patterns.md:   [fresh|review|stale] - Last verified: YYYY-MM-DD
  ...

  Issues found: [list any broken commands or stale info]
  Updated: [list files with updated verification dates]
```
