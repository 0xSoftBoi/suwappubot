#!/bin/bash
# Memory freshness verification script
# Run monthly to identify stale memory files

set -euo pipefail

MEMORY_DIR="$HOME/.claude/projects/-Users-mongolraider/memory"
TODAY=$(date +%s)

echo "🔍 Checking memory freshness..."
echo ""

check_file() {
    local file="$1"
    local filename=$(basename "$file")

    # Extract last verified date
    local verified=$(grep "Last verified:" "$file" 2>/dev/null | head -1 | sed 's/.*: //' | tr -d '[:space:]')

    if [ -z "$verified" ]; then
        echo "⚠️  $file"
        echo "    No verification date found"
        return
    fi

    # Parse date and calculate days old
    if date -j -f "%Y-%m-%d" "$verified" "+%s" &>/dev/null; then
        local verified_ts=$(date -j -f "%Y-%m-%d" "$verified" "+%s")
        local days_old=$(( ($TODAY - $verified_ts) / 86400 ))

        if [ $days_old -gt 30 ]; then
            echo "❌ $file"
            echo "    Last verified $days_old days ago (review needed)"
        elif [ $days_old -gt 14 ]; then
            echo "⚠️  $file"
            echo "    Last verified $days_old days ago (review soon)"
        else
            echo "✅ $file"
            echo "    Last verified $days_old days ago (fresh)"
        fi
    else
        echo "⚠️  $file"
        echo "    Invalid date format: $verified"
    fi
}

echo "=== 1-core (Critical Knowledge) ==="
for file in "$MEMORY_DIR"/1-core/*.md; do
    if [ -f "$file" ]; then
        check_file "$file"
        echo ""
    fi
done

echo "=== 2-patterns (Learned Patterns) ==="
for file in "$MEMORY_DIR"/2-patterns/*.md; do
    if [ -f "$file" ]; then
        check_file "$file"
        echo ""
    fi
done

echo "=== 3-decisions (ADRs) ==="
for file in "$MEMORY_DIR"/3-decisions/*.md; do
    if [ -f "$file" ]; then
        check_file "$file"
        echo ""
    fi
done

echo "=== Summary ==="
echo ""
echo "Legend:"
echo "  ✅ Fresh (< 14 days old)"
echo "  ⚠️  Review soon (14-30 days old)"
echo "  ❌ Review needed (> 30 days old)"
echo ""
echo "Recommendation:"
echo "  - Review ❌ files immediately"
echo "  - Schedule ⚠️  files for review this week"
echo "  - Update 'Last verified' date after confirming accuracy"
echo ""
echo "To update a file's verified date:"
echo "  sed -i '' 's/Last verified: .*/Last verified: $(date +%Y-%m-%d)/' <file>"
