#!/usr/bin/env python3
"""PreToolUse guard for the Suwappu agent fleet.

Blocks spawning the untiered `general-purpose` subagent (the old Opus cost
leak) and redirects the conductor to the correct tiered specialist per the
CLAUDE.md "Conductor protocol". Read-only on the tool input; never raises.
"""
import sys
import json


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        # Never break the tool flow if we can't parse the payload.
        return 0

    tool_input = data.get("tool_input") or {}
    subagent = str(tool_input.get("subagent_type") or "").strip().lower()

    if subagent == "general-purpose":
        reason = (
            "Blocked by fleet guard: 'general-purpose' runs at the main-loop tier "
            "and is the old Opus cost leak. Re-route per CLAUDE.md Conductor protocol:\n"
            "  • research / competitor / economics / design-critique → 'researcher' (sonnet)\n"
            "  • grep / audit / triage / 'where is X' → 'scout' (haiku) or 'Explore'\n"
            "  • code changes → the named specialist (bot-dev, api-ts-dev, webapp-dev, "
            "showcase-dev, db-migrate, chain-support, sdk-dev)\n"
            "Pick the closest specialist and re-issue. Do not use general-purpose."
        )
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
