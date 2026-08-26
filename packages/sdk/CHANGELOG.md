# Changelog

All notable changes to `@suwappu/sdk` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `SuwappuConfig.timeoutMs` — per-request timeout (default 30s, `0` to
  disable) applied to every HTTP call via `AbortSignal.timeout`. Timeouts and
  network failures now surface as a typed `SuwappuError` (`status: 0`,
  `code: "timeout"` or `"network_error"`) instead of an unhandled
  `fetch`/`AbortError` rejection.
- `Suwappu` now also resolves `baseUrl` from the `SUWAPPU_API_URL` env var
  (matching the CLI's existing `--base-url` resolution order), falling back
  to `DEFAULT_BASE_URL` as before.
- `DEFAULT_TIMEOUT_MS` exported alongside `DEFAULT_BASE_URL`.
- Filled in missing JSDoc on `getPortfolio`, `getPrices`, `listChains`,
  `listTokens`, and `getSwapStatus`; fixed a misplaced doc comment that had
  drifted from `getSwapStatus` onto `simulateSwap`.

### Changed
- `package.json`: richer `description`, expanded `keywords` (agent,
  telegram, stablecoin, hyperliquid, polymarket, morpho, cli, typescript),
  `homepage` now points at https://suwappu.bot, added `engines.node >=18`,
  `sideEffects: false`, and a `./package.json` export for tooling that reads
  package metadata. No version bump, no behavior change to existing methods.
- README: no content changes required beyond what already documented the
  managed vs. self-custody swap paths and structured CLI errors — reviewed
  against the current `client.ts` method set and confirmed accurate.

### Fixed
- None — no API response-shape drift was found between the SDK's
  `getQuote()`/`listChains()` mappings and the current `api-ts` routes
  (`/v1/agent/quote`, `/v1/agent/chains`) during this review.

No breaking changes. All additions are backwards compatible for existing
`webapp`, `mobile`, and `api-ts` consumers.
