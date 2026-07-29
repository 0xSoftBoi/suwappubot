# Contributing to Suwappu

Thanks for your interest in contributing to Suwappu! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Push to your fork and submit a pull request

## Repository map

| Path | What it is |
|------|------------|
| `bot/`, `api/`, `database/` | Python monolith — Telegram/WhatsApp/Discord handlers, swap engine, wallets, SQLAlchemy models |
| `api-ts/` | TypeScript API — Hono + Effect-TS + Drizzle, agent/MCP/A2A surface |
| `webapp/` | React + Vite Telegram Mini App |
| `terminal/` | Web trading terminal |
| `showcase/` | Next.js marketing site |
| `mobile/` | Expo iOS app |
| `packages/` | Shared types, TypeScript + Python SDKs, MCP server |
| `contracts/` | Solidity contracts |
| `docs/` | Setup, deployment, architecture and feature docs |

## Development Setup

[CLAUDE.md](./CLAUDE.md) is the canonical build-command and architecture reference —
it is written for AI coding agents, but the commands and gotchas apply to everyone.

### Prerequisites

- Python 3.11+ (bot + API)
- Bun (TypeScript API, mobile, TUI)
- Node.js 18+ (webapp)
- Docker (for local development with docker-compose)
- PostgreSQL (or use docker-compose)

### Quick start

```bash
# Python bot + API
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.template .env  # Fill in your values
uvicorn api.main:app --reload

# TypeScript API
cd api-ts && bun install && bun run dev

# Webapp
cd webapp && npm install && npm run dev
```

## Testing

Run the checks for the component you touched, plus the repo-wide verifier:

```bash
pytest tests/                 # Python bot + API
cd api-ts && bun run check    # TypeScript type check
cd webapp && npm run test     # Webapp unit tests
bash scripts/verify.sh        # Repo-wide checks (agent cards, registries, config)
```

Note: a green CI run does **not** prove the bot boots — the test job does not exercise
`bot/main.py`'s startup import chain. If you change imports or module layout, start the
service locally and confirm it comes up.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure all existing tests pass
- Update documentation if needed
- Use clear, descriptive commit messages — [Conventional Commits](https://www.conventionalcommits.org/)
  style (`feat:`, `fix:`, `docs:`, `chore:`) is preferred
- Fill in the PR template, including the money-path checkbox

## Code Style

- **Python**: Follow existing patterns in `bot/` and `api/`. CI runs
  `black --check --line-length=100 bot/ api/ tests/` — format before pushing or CI fails.
- **TypeScript**: Use Effect-TS patterns in `api-ts/`, standard React in `webapp/`.
  Don't mix raw Promises into Effect pipelines — wrap with `Effect.tryPromise()`.
- **Database**: There is no Alembic. Migrations are runtime, additive and idempotent in
  `database/db.py`. Schema changes must be applied to *both* the SQLAlchemy models and the
  Drizzle schema. See `docs/development/migrations.md`.
- Don't add unnecessary comments or docstrings
- Fix the root cause, not symptoms

## Security-sensitive changes

Some areas move real funds or handle keys: swap execution, wallet and key management,
encryption/KMS, billing, fee math, points accounting, withdrawals and redemptions.

If your PR touches any of these:

- Tick the money-path box in the PR template
- Explain the failure modes you considered, not just the happy path
- Expect a slower, more adversarial review — this is not a comment on your work

Never commit secrets. Real API keys, bot tokens, private keys, seed phrases and database
URLs do not belong in the repo, in tests, in fixtures, or in issue comments. Use
`.env.example` files with placeholder values.

## Reporting Issues

Use GitHub Issues for bug reports and feature requests.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the same license as this project (see [LICENSE](./LICENSE)).
