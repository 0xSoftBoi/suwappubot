# Contributing to Suwappu

Thanks for your interest in contributing to Suwappu! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Push to your fork and submit a pull request

## Development Setup

See the [CLAUDE.md](./CLAUDE.md) file for build commands and project structure.

### Prerequisites

- Python 3.11+ (bot + API)
- Bun 1.3.14 (TypeScript workspaces; matches CI)
- Node.js 20+ (webapp; matches CI)
- PostgreSQL (local instance or a dev database connection string)

### Quick start

```bash
# Python bot + API
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# Fill in your values — see .env.schema for the full contract
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# TypeScript API
cd api-ts && bun install && bun run dev

# Webapp
cd webapp && npm install && npm run dev
```

## Verification

Run the repository verification lanes that cover your change. Before a release-oriented PR, run the aggregate gate:

```bash
bash scripts/verify.sh all
```

Dependency security is a blocking CI gate. To reproduce it locally:

```bash
python -m pip install pip-audit
pip-audit -r requirements.txt

for dir in api-ts terminal showcase extension packages/sdk packages/mcp-server packages/openclaw packages/design-tokens; do
  (cd "$dir" && bun audit --audit-level=high) || exit 1
done

(cd webapp && npm audit --audit-level=high)
```

Do not suppress audit failures. Remediate a vulnerable dependency, or document a narrowly justified exception for review. Changes to swaps, signing, balances, custody, or other money paths must also preserve the invariants in [ARCHITECTURE.md](./ARCHITECTURE.md) and [CONVENTIONS.md](./CONVENTIONS.md).

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure all existing tests pass
- Update documentation if needed
- Use clear, descriptive commit messages

## Code Style

- **Python**: Follow existing patterns in `bot/` and `api/`
- **TypeScript**: Use Effect-TS patterns in `api-ts/`, standard React in `webapp/`
- Don't add unnecessary comments or docstrings
- Fix the root cause, not symptoms

## Reporting Issues

Use GitHub Issues for bug reports and feature requests.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the same license as this project (see [LICENSE](./LICENSE)).
