# Plan: OSS-parity fixes — close the benchmark gaps

Source: `docs/research/oss-benchmark-2026-08.md` (Aug 2026). Five phases, ordered by leverage; 1–3 are independent and can run in parallel, 4 depends on nothing, 5 is the only large feature. Every phase ends with `bash scripts/verify.sh` + the repo's standard gates; items marked **MONEY-PATH** additionally require `money-path-reviewer` (Opus) sign-off before merge.

## Phase 1 — Release process (fixes: Signed-Releases, Change Control, makes SBOM real)

Owner: conductor or `deploy-ops`. Effort: S–M. Not money-path.

1. Adopt CalVer (`vYYYY.MM.PATCH`) — app services deploy continuously, so calendar versioning tells the truth; `@suwappu/sdk` keeps SemVer independently.
2. New `.github/workflows/release.yml`: on tag push — build, regenerate the CycloneDX SBOM (`sbom.yml` logic reused), create a GitHub Release with generated notes, attach SBOM + build artifacts, sign everything with **cosign keyless (OIDC)** and attach SLSA provenance (the Kubernetes v1.26 pattern). SHA-pin all actions; least-privilege token (`id-token: write` only in the signing job).
3. Grow `CHANGELOG.md` per release (Keep-a-Changelog format); document the cadence (monthly, Hummingbot-style) in `docs/development/releases.md`.
4. First release: tag current `main` as the baseline once this branch merges.

Acceptance: one published, signed release with attached SBOM; `cosign verify-blob` documented and passing.

## Phase 2 — Property/fuzz tests on money-path math (fixes: Fuzzing, app-adapted)

Owner: `test-engineer`. Effort: M. Tests only — no production code changes, but findings route to money-path fixes.

1. Python (Hypothesis, dev-dep): `compute_adaptive_slippage_bps` (`bot/utils/adaptive_slippage.py` — never-widen invariant over full float domain), fee math in `bot/services/` (locate via grep for fee bps application), amount/decimals conversions in `swap_engine.py` quote parsing.
2. TypeScript (fast-check, dev-dep): every schema in `api-ts/src/routes/validators.ts` (parse never throws unhandled, coercion round-trips), `solanaMintUsdValue` decimals math (`api-ts/src/lib/prices.ts:140`), `canonicalize`/hash stability in `api-ts/src/lib/toolIntegrity.ts` (key-order independence — extends the reviewer's manual proof into a permanent test).
3. New CI lane `property-tests` in `test.yml` with bounded examples (fast in CI, `--hypothesis-seed`/fc seed logged for reproduction).

Acceptance: lanes green; any invariant violation found becomes a MONEY-PATH bugfix with its own review.

## Phase 3 — Badge + posture polish (fixes: CII-Best-Practices; cheap trust signals)

Owner: conductor. Effort: S.

1. `docs/security/openssf-badge-evidence.md`: map each passing-level criterion to repo evidence (most already exist per the benchmark §1 table); flag the 60-day medium-vuln SLA in `SECURITY.md` explicitly (currently "typically 30 days" — already stronger; state it as a commitment).
2. Submit the bestpractices.dev application; add the badge + CI/Scorecard badges to `README.md`.
3. Branch-protection audit via GitHub API (server-side state the checkout can't see): reviews required on `main`, force-push blocked, status checks enforced. Record findings; fix settings if the API token allows, else list for the owner.
4. State the bus-factor honestly in `SECURITY.md`/audit dataroom — 2 contributors is a disclosure, not a fix.

Acceptance: badge application submitted; README badges render; branch-protection state documented.

## Phase 4 — Peer-adopted defense-in-depth (small, mostly independent)

1. **MCP read-only kill-switch** — `MCP_READ_ONLY=true` env: strip non-read tools from `TOOLS_WITH_ANNOTATIONS` *and* refuse them at dispatch (both layers — GitHub's flag shipped broken by doing only one). Blast-radius control beneath the policy gate. Owner: `api-ts-dev`. **MONEY-PATH review** (touches dispatch). Include a test proving `execute_swap` is refused with the flag on.
2. **Tool annotations audit** — `TOOL_ANNOTATIONS` already exists in `mcpTools.ts`; verify all 22 tools carry accurate `readOnlyHint`/`destructiveHint`/`idempotentHint` rather than adding blindly; fix gaps. Owner: `api-ts-dev`. Small.
3. **OIDC trusted publishing for `@suwappu/sdk`** — inspect `publish-sdk.yml`; if it uses a long-lived npm token, switch to npm trusted publishing (the Anthropic reference-servers pattern). Owner: `sdk-dev`. Small.
4. **Destination-allowlist verification** — grep `api-ts/src/db/schema/policies.ts` for an allowlist column (benchmark left this unverified — `evalStateless` does reference `allowedContracts`/destination fields; confirm end-to-end enforcement on the swap path, not just schema presence). If absent on the enforcement path: dual-ORM addition via `db-migrate`, then **MONEY-PATH review**. Track Stripe RFC #320/#356 for schema convergence.
5. **Per-agent credential scoping check** — one `security-auditor` pass answering: if the policy gate were bypassed, what can an agent's bearer token reach? Confirms the Stripe `rk_*` lesson (scope beneath policy, not only at it).

## Phase 5 — Dry-run mode for new chain rollouts (Freqtrade's lesson)

Owner: `bot-dev` + `api-ts-dev`. Effort: L. **MONEY-PATH review.** Flag-gated per chain (`DRY_RUN_CHAINS=<list>`).

1. A dry-run chain executes the full path — quote, policy gate, adaptive slippage, tx *build* — but never broadcasts; it records a simulated fill (quote price ± a configurable slippage distribution, Freqtrade's orderbook-fill idea simplified to quote-impact-based) into the normal tx tables marked `simulated=true`.
2. Rollout policy documented: every new chain integration runs dry for N days / M simulated swaps with fill-quality review before real broadcast is enabled (`docs/development/chain-rollout.md`).
3. User-facing docs get the Freqtrade-style "simulated ≠ live" disclaimer.

Acceptance: one existing chain re-run through dry-run mode end-to-end as proof; rollout doc merged.

## Sequencing and standing rules

- Week 1: Phases 1 + 3 (parallel, no review dependencies) and Phase 2 kickoff.
- Week 2: Phase 4 items 1–3 (parallel); item 4–5 after their verification greps.
- Week 3+: Phase 5.
- Every phase: repo gates (`verify.sh`, black, parse, `bun run check`, schema drift, full test suites) before push; MONEY-PATH items get Opus review with adversarial questions written by the conductor (the pattern that caught the unit bug, phantom-success, and cap-predicate holes this branch).
- No scope-shrink without surfacing: if a phase hits a constraint (e.g. npm trusted publishing unsupported for the org), report it in the phase's commit and this doc rather than quietly downgrading.
