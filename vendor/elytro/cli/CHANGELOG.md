# Changelog

All notable changes to the Elytro CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.9] - 2026-04-13

### Added

- Polygon network support

## [0.8.8] - 2026-04-10

### Fixed

- Context switch bug when switching between accounts

## [0.8.7] - 2026-04-09

### Changed

- Tuned x402 retry mechanism timing and backoff parameters

## [0.8.6] - 2026-04-09

### Changed

- Security hardening of context and chain services

## [0.8.5] - 2026-04-09

### Changed

- Version bump and dependency updates

## [0.8.4] - 2026-04-08

### Added

- Auto retry logic with exponential backoff for x402 bad requests

### Fixed

- Address mapping issue in account resolution

## [0.8.3] - 2026-04-01

### Changed

- Improved display formatting for swap, transaction, and OTP commands
- Reorganized SKILL documentation into `SKILLS/` directory with expanded concepts reference

## [0.8.2] - 2026-03-31

### Changed

- SDK dependency update

## [0.8.1] - 2026-03-31

### Fixed

- Recovery flow issue when initiating guardian recovery
- Updated Node.js engine constraint to `>=18.0.0`

## [0.8.0] - 2026-03-27

### Changed

- Major dependency and SDK updates

## [0.7.4] - 2026-03-26

### Added

- Swap and bridge commands via LiFi (`swap quote`, `swap send`)
- Token search and lookup command (`token --search`)

### Changed

- Updated x402 payment integration

## [0.7.3] - 2026-03-25

### Changed

- Improved services registry command output and formatting

## [0.7.2] - 2026-03-25

### Added

- Skills for service discovery in agent SKILL file

## [0.7.1] - 2026-03-24

### Added

- Services registry command (`elytro services`) for browsing x402-compatible services
- JSON output mode and environment-configurable registry API URL
- `ServiceDetail` type with structured docs field

### Fixed

- Strengthened x402 payment validation checks

## [0.6.2] - 2026-03-20

### Added

- Prettier, commitlint, husky, and lint-staged for code quality tooling
- Environment variable passing rules for agent workflows

### Changed

- Merged x402 payment support into main branch

## [0.6.1] - 2026-03-19

### Added

- x402 payment protocol support (EIP-3009, USDC transfers)
- EIP-3009 authorization signing utilities
- Delegation management commands (`delegation add`, `verify`, `revoke`, `renew`, `sync`)
- `elytro request` command for paid HTTP requests

### Changed

- Removed all blocking confirmation prompts in favor of agent-driven approval
- Security hardening of keyring and chain services

## [0.6.0] - 2026-03-18

### Added

- Social recovery commands (`recovery contacts set/list/clear`, `recovery initiate`, `recovery status`)
- Prune command for wallet maintenance
- Recovery backup export/import for offline guardian info storage
- Recovery guard utilities and social recovery contract helpers

## [0.5.2] - 2026-03-16

### Added

- Agent Communication Standard with structured response templates and principles

### Fixed

- OTP challenges now always include `challengeId` before verification

## [0.5.1] - 2026-03-12

### Added

- Base chain (8453) support
- Cross-platform credential storage via `@napi-rs/keyring`

## [0.5.0] - 2026-03-12

### Added

- CLI version display (`--version` flag)
- Runtime version resolution with build-time injection and dev-time fallback

## [0.4.0] - 2026-03-11

### Changed

- Version bump from initial migration; first standalone release

## [0.1.0] - 2026-03-11

### Added

- Initial migration from Elytro monorepo
- Core CLI framework with Commander.js
- Account management (`account create`, `list`, `info`, `switch`, `activate`)
- Transaction simulation and sending (`tx simulate`, `tx send`)
- Chain and balance queries (`query chain`, `query balance`, `query tx`)
- Security commands (`security 2fa install`, `email bind`, `spending-limit`, `status`)
- OTP verification flow (`otp list`, `otp submit`)
- Configuration management (`config show`)
- Update checker (`update check`)
- Keychain-based secret storage
- Multi-chain support (OP Sepolia)
