# Incident Postmortems (COE format)

Blameless, action-item-driven postmortems for production incidents, modeled on
Amazon's Correction of Error and PagerDuty's public postmortem template. The
goal is institutional memory: findings feed back into runbooks, ADRs, and
`docs/DECISIONS.md` — an archived postmortem nobody acts on is a failure.

## When to write one

- Any incident that moved/blocked user funds, broke swaps, or took the bot
  down (polling stall counts — users see silence).
- Any incident where diagnosis took longer than the fix (that gap is a
  monitoring or docs defect worth recording).
- Not for routine deploy rollbacks caught by `scripts/status.py` within
  minutes — those go to `docs/DECISIONS.md` as a one-liner if instructive.

## Rules

1. **Blameless.** Name systems and gaps, not people. Reward disclosure.
2. **Copy `TEMPLATE.md`** to `YYYY-MM-DD-short-title.md` in this directory.
3. **Action items are owned and time-bound** — an item with no owner or date
   is a wish, not an action. Track completion in the file itself.
4. **Close the loop**: each postmortem's "knowledge updates" section must
   list which runbook/doc/ADR was updated (or explicitly say none needed).
5. Written within a week of resolution, while the timeline is reconstructible
   from logs.

## Index

*(none yet — copy the template when the first one lands)*
