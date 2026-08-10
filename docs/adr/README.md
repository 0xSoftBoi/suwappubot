# Architecture Decision Records

Short, append-only records of decisions that shape the system. Nygard format:
**Status / Context / Decision / Consequences**. Rules:

- One decision per file, `NNNN-short-title.md`, numbered sequentially.
- Open an ADR as a PR with status `Proposed`; **merging it as `Accepted` is
  the acceptance** (Microsoft playbook pattern). Discussion happens in the PR.
- **Append-only**: never edit an accepted ADR's decision. To change course,
  write a new ADR that supersedes it and link both ways; the old one's status
  becomes `Superseded by NNNN`.
- MONEY-PATH or cross-stack PRs (swap execution, wallet/keys, fee math,
  billing, dual-ORM schema) that change architectural behavior must link an
  ADR in the PR description.
- Keep records pithy and assertive; link supporting analysis, don't inline it.
- Lessons that aren't decisions (incident learnings, gotchas) go to
  `docs/DECISIONS.md`; ADRs are for choices with alternatives.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-deploy-on-railway.md) | Deploy on Railway, not AWS | Accepted |
| [0002](0002-kms-envelope-encryption-for-wallet-keys.md) | KMS envelope encryption for wallet keys | Accepted |
| [0003](0003-runtime-additive-migrations-no-alembic.md) | Runtime additive migrations, no Alembic | Accepted |
| [0004](0004-telegram-polling-single-replica.md) | Telegram polling implies a single bot replica | Accepted |
| [0005](0005-dual-stack-python-monolith-plus-api-ts.md) | Dual stack: Python monolith + TypeScript API over one database | Accepted |
