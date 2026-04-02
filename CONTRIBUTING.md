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
