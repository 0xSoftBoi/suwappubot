# Releases

## Versioning

- **App (this repo's services)**: CalVer — `vYYYY.MM.PATCH` (e.g. `v2026.09.0`). The services deploy continuously to Railway; a release tag marks an audited, signed snapshot, not a deploy gate.
- **`@suwappu/sdk`**: independent SemVer, published via `publish-sdk.yml`.

## Cutting a release

1. Ensure `main` is green (`bash scripts/verify.sh`) and `CHANGELOG.md`'s `[Unreleased]` section is current.
2. Move `[Unreleased]` content under a new `## [vYYYY.MM.PATCH] - YYYY-MM-DD` heading; commit.
3. Tag and push: `git tag vYYYY.MM.PATCH && git push origin vYYYY.MM.PATCH`.
4. `.github/workflows/release.yml` does the rest: source tarball from the tagged tree, CycloneDX SBOM (Syft), cosign **keyless** signatures (GitHub OIDC — no long-lived keys), GitHub Release with generated notes and all four assets attached.

Cadence: monthly, or on-demand after a significant security fix.

## Verifying release artifacts

Every artifact ships with a Sigstore bundle (`<artifact>.sigstore.json`) embedding the certificate, signature, and Rekor transparency-log proof:

```bash
cosign verify-blob \
  --bundle suwappubot-vYYYY.MM.PATCH.tar.gz.sigstore.json \
  --certificate-identity-regexp 'github.com/0xSoftBoi/suwappubot' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  suwappubot-vYYYY.MM.PATCH.tar.gz
```

The identity is the GitHub Actions workflow of this repository — a signature from anywhere else fails verification. The SBOM (`.cdx.json`) verifies the same way.

## npm trusted publishing (`@suwappu/sdk`, `@suwappu/openclaw`, `@suwappu/mcp-server`)

`publish-sdk.yml` publishes via **OIDC trusted publishing** with `--provenance` — no long-lived npm token exists in CI. One-time manual prerequisite per package (npm maintainer, npmjs.com UI): Package Settings → Trusted Publisher → GitHub Actions, Repository `0xSoftBoi/suwappubot`, Workflow `publish-sdk.yml`, no Environment. Until linked, publishes fail auth by design.

## Notes

- On-demand SBOMs outside a release: `sbom.yml` via workflow_dispatch.
- The `sbom/suwappubot.cdx.json` checked into the repo is a convenience snapshot; the per-release SBOM attached (and signed) by `release.yml` is the authoritative one for a given version.
