<!-- Keep PRs focused on a single change. See CONTRIBUTING.md. -->

## What this changes

<!-- One or two sentences. Link the issue: Fixes #123 -->

## Why

## How it was tested

<!-- Be specific. "CI passed" is not a test — CI does not exercise the bot's startup import chain. -->

- [ ] `pytest tests/` (Python) / `bun run check` (api-ts) / `npm run test` (webapp)
- [ ] `bash scripts/verify.sh`
- [ ] Manually exercised the changed path (describe below)

## Checklist

- [ ] Single, focused change
- [ ] Python formatted with `black --line-length=100` (CI enforces this)
- [ ] Docs updated if behaviour or setup changed
- [ ] No secrets, keys, tokens or real wallet addresses added to the repo
- [ ] Database changes are additive and idempotent (see `docs/development/migrations.md`)

## Money path

Tick if this PR touches swap execution, wallet/key handling, encryption/KMS, billing,
fee math, points accounting, withdrawals or redemptions. These get an extra review pass.

- [ ] This PR touches the money path
