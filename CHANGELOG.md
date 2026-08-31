# Changelog

Notable changes to Suwappu, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
History before this file was introduced is tracked in git and merged PRs.

## [Unreleased]

### Added
- Release process (`.github/workflows/release.yml`): CalVer tags (`vYYYY.MM.PATCH`)
  produce a GitHub Release with generated notes, a source tarball, a CycloneDX
  SBOM for the tagged tree, and cosign keyless signatures (Sigstore bundles)
  on both. Verification steps in `docs/development/releases.md`.
- Security gates in CI: gitleaks full-history secret scan (triaged fingerprint
  baseline), npm lifecycle-script guard on PRs, and a property-test lane on
  money-path math.
- MCP hardening: Zod-derived schemas for all 22 tools with a build-failing
  drift gate; ETDI-style pinned SHA-256 on the `execute_swap` definition
  (refused at dispatch, withheld from `tools/list`, build fails on drift);
  MCP authorization checklist (`docs/security/mcp-authorization-checklist.md`).
- Policy gate: real USD valuation for Solana trades (cap-scoped, fail-closed
  with honest reasons); single-use agent quotes on the MCP swap path.
- Flag-gated swap hardening (default OFF): adaptive per-trade slippage bound
  (Heimbach & Wattenhofer) for Jupiter/OKX; Solana MEV-protect via tipped
  single-tx Jito bundles with confirmed-or-better landing checks.
- Research corpus: 23-paper academic survey and OSS benchmark vs. gold-standard
  and peer projects (`docs/research/`), with the execution plan in
  `docs/plans/oss-parity.md`.
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
- CI: dependency security now blocks on vulnerabilities in the locked Python graph,
  every Bun workspace lock, and the webapp npm lock instead of auditing runner state
  or swallowing audit failures.
- Dependabot now covers the extension and MCP server package roots.
- `scripts/verify.sh` gains an env-contract lane.
