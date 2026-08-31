# Stabilization / audit-readiness snapshot — 2026-08-31

Full repository quality-gate sweep run on branch `claude/linux-rust-stabilization-7vs1eu` (even with `main` at start). Test suites were intentionally not executed for this pass; these are static, build, and dependency gates.

## Gates run and results

| Gate | Command | Result |
|------|---------|--------|
| Python parse | `ast.parse` over `bot/ api/ database/ tests/ scripts/` | 0 failures |
| Python format | `black --check --line-length=100 bot/ api/ tests/` | 584 files clean |
| Python deps | `pip-audit -r requirements.txt` | 1 finding — PYSEC-2026-1325 (`ecdsa`), already an accepted exception, see `dependency-exceptions.md` |
| api-ts types | `bun run check` | exit 0 |
| api-ts deps | `bun audit` | was 1 moderate (esbuild ≤0.24.2 via drizzle-kit, GHSA-67mh-4wv8-2f99) — **fixed** this pass via `overrides.esbuild: ^0.25.0`; now 0 findings |
| webapp types | `tsc --noEmit` | exit 0 |
| webapp build | `npm run build` | success (chunk-size warning only) |
| SDK types | `tsc --noEmit` in `packages/sdk` | exit 0 |
| showcase build | `bun run build` (Next.js) | success |
| Repo verifier | `bash scripts/verify.sh` | all checks passed (OpenAPI, MCP schemas, env contract, docs drift, prod health) |
| Secret scan | pattern grep for AWS/GitHub/Slack/OpenAI keys + private-key blocks over tracked source | only the documented AWS example key in a redaction test fixture |
| Tracked env files | `.env.testnet`, `terminal/.env.production`, `webapp/.env.development` | public contract addresses / non-secret config only; `.env.schema` is a generated contract with blank sensitive values |

## Changes made this pass

1. **esbuild override** (`api-ts/package.json`): pinned transitive esbuild to `^0.25.0` to clear GHSA-67mh-4wv8-2f99 (dev-server request-forwarding issue in drizzle-kit's bundled esbuild). `bun audit` now clean; drizzle-kit verified loading.
2. **MCP schema unification (Phase 1)**: the 6 remaining hand-written MCP tool schemas (`browse_mpp_directory`, `execute_swap`, `get_tempo_tokens`, `list_chains`, `list_tokens`, `perps_markets`) converted to Zod-derived schemas per `docs/plans/mcp-unification.md`, closing the drift gap `scripts/check-mcp-schemas.ts` reported.

## Known accepted risks

- PYSEC-2026-1325 (`ecdsa` via `starknet-py → crypto-cpp-py`): accepted with evidence and expiry, see `dependency-exceptions.md` (review by 2026-11-06).
- Webapp bundle has chunks >500 kB after minification — performance note, not a security finding.
