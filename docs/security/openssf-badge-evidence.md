# OpenSSF Best Practices badge — evidence map (passing level)

Application prep for https://www.bestpractices.dev. Each criterion → repo evidence. Rows marked **OWNER** need a repository-settings action or web-UI step only a maintainer can perform.

## Basics
| Criterion | Evidence |
|---|---|
| Public project description | `README.md`, https://www.suwappu.bot |
| FLOSS license | `LICENSE` (repo root) |
| Contribution process documented | `CONTRIBUTING.md`; conventions in `CONVENTIONS.md` |
| HTTPS project sites | github.com + suwappu.bot (both HTTPS) |

## Change Control
| Criterion | Evidence |
|---|---|
| Public VCS with history | this repository |
| Unique versioned releases | CalVer tags via `.github/workflows/release.yml` (`docs/development/releases.md`) — **first tag pending merge of this branch** |
| Release notes per release | generated notes + `CHANGELOG.md` (Keep a Changelog) |

## Reporting
| Criterion | Evidence |
|---|---|
| Public issue tracker | GitHub Issues |
| Private vulnerability channel, <14-day ack | `SECURITY.md`: security@suwappu.bot, 48h acknowledgment |
| Vulnerability response process | `SECURITY.md` (scope, timelines); exceptions process in `docs/security/dependency-exceptions.md` |

## Quality
| Criterion | Evidence |
|---|---|
| Working build | Docker gates in `api-ts/Dockerfile`; `bash scripts/verify.sh` |
| Automated test suite | 2,930 Python tests + 720 api-ts tests + webapp suites; `test.yml` |
| Tests for new functionality (policy) | `CONTRIBUTING.md` + enforced in review; property-test lane on money-path math |
| Warning flags enabled | `black --check` blocking; `tsc --noEmit` blocking; flake8 advisory by documented choice (`CHANGELOG.md`) |

## Security
| Criterion | Evidence |
|---|---|
| Secure design knowledge | `docs/security/mcp-authorization-checklist.md` (SoK-mapped controls); money-path review process (`CLAUDE.md` conductor protocol) |
| Crypto best practices | KMS envelope encryption (`kms_aesgcm_v2`); no custom crypto primitives |
| Secured delivery | HTTPS everywhere; cosign-signed releases (`release.yml`) |
| Vulns patched ≤60 days (medium+) | `SECURITY.md` commits to 30 days post-triage |
| No unpatched known vulns | pip-audit + bun audit blocking in CI; documented exception process with expiry |

## Analysis
| Criterion | Evidence |
|---|---|
| Static analysis | CodeQL (`codeql.yml`), every PR |
| Dynamic/fuzz analysis | property-test lane (Hypothesis/fast-check) on money-path math |
| Findings addressed | dependency-exceptions process; Scorecard SARIF to Security tab |

## OWNER actions (cannot be done from a checkout)
1. Submit the application at bestpractices.dev (link this doc as evidence), add the badge to `README.md` once issued.
2. Link npm trusted publishers for the three packages (see `docs/development/releases.md`).
3. **Branch-protection verification** on `main` (Scorecard's Branch-Protection check reads these server-side settings): require PR review before merge, require status checks (test, CodeQL, secret-scan), block force pushes and deletions, enforce for admins. The checkout cannot verify or set these; the Scorecard workflow's next run reports the current state to the Security tab.
