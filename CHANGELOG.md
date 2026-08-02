# Changelog

Notable changes to Suwappu, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
History before this file was introduced is tracked in git and merged PRs.

## [Unreleased]

### Added
- Engineering-foundation parity pass (inspired by domain-neutral foundation repos,
  adapted first-principles to this stack):
  - Root governance docs: `ARCHITECTURE.md`, `CONVENTIONS.md`, `AGENTS.md`,
    `SUPPORT.md`, `CODE_OF_CONDUCT.md`, this changelog.
  - `.env.schema` — generated environment contract derived from
    `bot/config/settings.py` and `api-ts/src/config/EnvService.ts`, with drift gate
    (`scripts/check_env_schema.py`).
  - `capabilities.yaml` — manifest of optional providers and how to verify each.
  - `scripts/doctor.py` — toolchain/env/capability probe (never prints secret values).
  - OpenAPI drift gate for the agent API (`bun run openapi:check` in `api-ts/`).
  - CodeQL static analysis workflow (Python + JS/TS).

### Changed
- CI: `black --check` is now a blocking gate (flake8 remains advisory by choice).
- `scripts/verify.sh` gains an env-contract lane.
