# Git Hooks (Husky)

This directory contains Git hooks managed by [Husky](https://typicode.github.io/husky/).

## Hooks

### pre-commit

Runs before each commit to validate:
- **Database migrations** - Checks migration file syntax and revision chain when `migrations/`, `bot/models/`, or `database/` files change

## Setup

Hooks are automatically installed when running `npm install` or `bun install` at the repo root (via the `prepare` script).

```bash
# Install dependencies (activates hooks)
npm install
# or
bun install
```

## Manual Installation

If hooks aren't working:

```bash
# Initialize husky
npx husky init

# Verify hooks are executable
chmod +x .husky/pre-commit
```

## Bypassing Hooks

In emergencies, you can skip hooks:

```bash
# Skip pre-commit hook
git commit --no-verify -m "emergency fix"
```

**Warning**: Only use `--no-verify` when absolutely necessary. The hooks exist to prevent broken code from being committed.

## Adding New Hooks

1. Create a new file in `.husky/` (e.g., `commit-msg`)
2. Make it executable: `chmod +x .husky/commit-msg`
3. Add your validation logic

## Troubleshooting

### "command not found: husky"
```bash
npm install husky --save-dev
```

### Hooks not running
```bash
# Reinstall hooks
npx husky install
```

### Permission denied
```bash
chmod +x .husky/*
```
