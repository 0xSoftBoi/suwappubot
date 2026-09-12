# Main / Dev Promotion Discipline

`main` is the canonical production history. `dev` is the staging/development
environment branch. They must never evolve as independent long-lived histories.

## Invariant

At every stable point, one of these must be true:

1. `main == dev`, or
2. `main` is an ancestor of `dev` while validated work is staged for promotion, or
3. `dev` is an ancestor of `main` for the short interval after a production merge,
   before the automatic safe fast-forward brings `dev` back to `main`.

A state where neither branch is an ancestor of the other is a branch-integrity failure.

## Promotion flow

1. Branch feature work from the current `main`.
2. Open the feature PR to `dev`.
3. Require CI green and verify the Railway dev deployment/functionality.
4. Merge the feature into `dev`.
5. Open a promotion PR from `dev` to `main`.
6. Require CI green again.
7. Merge to `main` and verify production services/logs.
8. The Branch Lineage workflow fast-forwards `dev` to the new `main` merge commit,
   but only if `dev` is already an ancestor of `main`.

The sync workflow never force-pushes and never discards staged commits.

## Recovery

If `main` and `dev` diverge:

1. Preserve both tips with archive branches.
2. Choose the protected production `main` lineage as the canonical base unless an
   incident review proves otherwise.
3. Reconstruct wanted dev-only work on fresh feature branches from `main`.
4. Realign `dev` to `main` only after the old tip is archived.
5. Promote reconstructed work through the normal staging flow.

Do not solve divergence by opening a giant `dev -> main` PR. That imports unrelated
history and makes review, rollback, and deployment attribution unreliable.
