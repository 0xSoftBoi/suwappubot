---
description: "Treat one confirmed bug as a class: reproduce, fix, generalize the class, sweep the repo, and fix every instance with one commit each. Usage: /bugclass <bug description>"
---

# Bug-Class Elimination

Formalizes the pattern that produced the best sessions here: root-cause one crash, then sweep for its siblings (one chart crash → seven patched null-guard sites).

Input: `$ARGUMENTS` — one confirmed bug. If empty, ask for it; do not guess.

## Step 1 — Reproduce first
Write a **failing** test that reproduces the bug *before* touching any source. If you can't make it fail, you haven't understood it — stop and say so.

## Step 2 — Fix minimally
Fix, confirm the test passes. One focused commit.

## Step 3 — Name the class
Articulate the bug class in **one sentence** (e.g. "chart render paths assume unique timestamps", "null-unguarded access on optional API fields"). This sentence is the search spec.

## Step 4 — Sweep
Dispatch `scout` (haiku) to grep/AST-search **both stacks** for every other instance. Write results to `.progress/bug-class-queue.md` with `file:line` + risk rating. This file is the durable state — an interrupted session resumes from it.

## Step 5 — Work the queue, one item at a time
For each entry: reproducing test → fix → full suite → **one focused commit per instance** with a message naming the instance.
- Update `.progress/bug-class-queue.md` after **every single item** (done / skipped / needs-human).
- Bash `timeout` of at least `600000` ms on test runs. A slow suite is not a hang.
- If a fix needs a design decision or would balloon into a refactor: **skip it**, log under `NEEDS HUMAN`, move on. Do not expand scope.

## Step 6 — Report
Instances found / fixed / skipped-with-reason, total test-count delta, and whether any instance touches a money path (→ `money-path-reviewer` before merge).
