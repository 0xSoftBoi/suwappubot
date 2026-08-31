# Suwappu vs. top open source — benchmark (Aug 2026)

How this repo compares to (a) the OSS gold standard for engineering hygiene (OpenSSF Scorecard/Badge as practiced by curl, Rust, Kubernetes), (b) the top open-source trading bots, and (c) the top open-source agent/MCP toolkits. All peer facts verified against live pages at research time; Scorecard numbers are point-in-time snapshots (they re-compute continuously). One known tool caveat: Scorecard systematically under-scores projects using non-GitHub-native tooling (Prow, mailing-list review), so raw scores are not practice quality.

## 1. The gold-standard rubric, scored against this repo

OpenSSF Scorecard's 19 checks + Best Practices Badge clusters, adapted for an application repo (not a library). Reference points: curl 6.9, Rust 7.1, Kubernetes 7.2 (all with `-1`/0 blind-spot rows; curl holds a CII **Gold** badge and is its own CNA; Kubernetes signs binaries, SBOMs, and provenance via cosign since v1.26).

| Check | Suwappu today | Evidence |
|---|---|---|
| Security-Policy | **Pass** | `SECURITY.md`: private channel, 48h ack SLA, 30-day fix target, scope list — meets the Badge's <14-day ack bar |
| SAST | **Pass** | CodeQL workflow (`.github/workflows/codeql.yml`) |
| Dependency-Update-Tool | **Pass** | `.github/dependabot.yml` |
| Vulnerabilities | **Pass** | pip-audit + bun audit clean; one documented exception (PYSEC-2026-1325) with evidence + expiry (`docs/security/dependency-exceptions.md`) — exactly the Badge's documented-triage pattern |
| SBOM | **Partial** | CycloneDX SBOM generated in-repo (`sbom/`, `sbom.yml` workflow) but there are no releases to attach it to |
| CI-Tests | **Pass** | test.yml + Docker build gates; 2,930 Python tests + 720 api-ts tests + webapp suites |
| Secret scanning | **Pass** (beyond Scorecard) | gitleaks full-history gate, triaged fingerprint baseline (`secret-scan.yml`) |
| Dangerous-Workflow / Token-Permissions | **Mostly pass** | workflows use least-privilege `permissions:` blocks; SHA-pinned actions are the repo convention |
| Pinned-Dependencies | **Pass** (better than all three reference projects) | lockfiles + `--frozen-lockfile` in Docker; SHA-pinned actions; this is where curl (2/10), Rust (-1), and K8s (0/10) all score worst |
| Scorecard (meta) | **Pass** | `scorecard.yml` runs weekly, SARIF to Security tab |
| License / governance | **Pass** | LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SUPPORT, ARCHITECTURE docs all present |
| Maintained | **Pass** | daily commit activity |
| **Signed-Releases** | **Fail** | 0 git tags, no releases at all — nothing to sign; K8s-style cosign/SLSA provenance is unreachable until a release process exists |
| **Fuzzing** | **Fail** | no OSS-Fuzz/ClusterFuzzLite/native harnesses; the app-repo adaptation (property/fuzz tests on money-path parsers — calldata decoding, fee math, slippage math) is absent |
| **Contributors (bus factor)** | **Fail** | 2 contributors, one org — the check exists precisely to flag this |
| Branch-Protection / Code-Review | **Unknown/Partial** | server-side settings not verifiable from the checkout; review happens via PR flow + Claude Approvals; needs an explicit branch-protection audit |
| Packaging | **Partial** | `@suwappu/sdk` exists (`packages/sdk`) with a publish workflow (`publish-sdk.yml`); the app services correctly N/A |
| CII-Best-Practices badge | **Fail (unclaimed)** | likely passes most passing-level criteria already; nobody has filled in the badge application |
| CHANGELOG / versioned releases | **Fail** | 27-line CHANGELOG, no tags — the Badge's "unique versioned releases" criterion fails |

**DeFi-specific cluster (not in Scorecard, matters more here):** money-path review gate (Opus reviewer, enforced this branch — caught a 100× unit bug and two phantom-success paths before merge), KMS envelope encryption for custodial wallets, policy gate with USD caps/HITL, ETDI-style pinned tool-definition hash failing the build on drift, MCP authorization checklist mapped to file:line with explicit gaps. No generic OSS peer has an equivalent cluster; this is ahead of the reference projects' scope.

### Verdict vs. gold standard

Strengths that already exceed the reference trio: dependency pinning, secret scanning with a triaged baseline, documented dependency-exception process, and the DeFi money-path cluster. The distance to "Linux/Rust-level" is concentrated in **four fixable gaps**:

1. **No releases** — no tags, no versioning, no signed artifacts, SBOM attached to nothing. This single gap fails Signed-Releases, half the Badge's Change Control cluster, and makes the SBOM ornamental. Fix: CalVer/SemVer tags + a release workflow with cosign keyless signing + SBOM attachment.
2. **No fuzz/property testing on money-path parsers** — the app-repo adaptation of Fuzzing. Fix: Hypothesis (Python) property tests on fee/slippage math and calldata decoding; fast-check (TS) on validators.
3. **Bus factor of ~1** — structural, not tooling; honest to state to auditors rather than paper over.
4. **CII Best Practices badge unclaimed** — cheap forcing function; most criteria already met.

## 2. vs. top open-source trading bots

| Project | Scale | Money path | Test/CI signal | Verdict vs. us |
|---|---|---|---|---|
| [Freqtrade](https://github.com/freqtrade/freqtrade) | 53.8k stars, GPL-3.0, pushed same-day | CEX-only via ccxt, user-supplied API keys, zero custody | Strongest of anything scanned: large pytest suite, public CI + Codecov badge | Ahead of us on public test-signal presentation; no custody, no MEV, no agent API |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | 19.7k stars, Apache-2.0, monthly releases | Self-custody; DEX keys in a separate Gateway service (scrypt + AES-256-GCM, "treat like a hot wallet") | Monthly versioned releases | Ahead of us on release cadence and service-isolation framing; no KMS, no policy caps, no MEV protection in the DEX path |
| Top-starred "Telegram Solana DEX bot" repos | e.g. 4.4k stars | — | **No tests, no CI**; READMEs funnel to "DM for the real bot" | Marketing-funnel code, not engineering; our baseline clears the entire open-source entrant field in this niche |
| Actual market leaders (BonkBot, Trojan, Photon, Maestro, GMGN, Banana Gun) | closed-source SaaS | unauditable | unauditable | No public security posture at all — a positioning angle for us, not a code benchmark |

Neither serious OSS project has: custodial multi-chain wallets, KMS envelope encryption, server-side USD policy caps, MEV protection (Jito/private relay), or any agent/MCP API. Those are clean differentiators. What they have that we lack:

- **Freqtrade's dry-run realism**: simulated orderbook fills, explicit slippage cap, limit→market timeout conversion, and a documented "backtest ≠ live" warning — the model for a pre-production mode when we enable a new chain/route.
- **Versioned monthly releases with notes** (both) — the same release-process gap section 1 flagged.
- **Public CI/coverage badges** as a trust signal — cheap, absent from our README.

## 3. vs. top open-source agent/MCP toolkits

*(appended when the agent-toolkit research completes)*
