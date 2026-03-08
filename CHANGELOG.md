# Changelog

All notable changes to Suwappu will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-01-31

### Added

#### Webapp Features
- **History Page** - View swap transaction history with filters (#94)
- **Points & Rewards** - Daily check-in, leaderboard, rewards redemption (#95)
- **Limit Orders** - Create and manage limit orders UI (#96)
- **Price Alerts** - Set price alerts with notifications UI (#97)
- **Favorites** - Save favorite tokens and swap pairs (#98)
- **Quick Swap** - One-tap swap from favorite pairs (#99)
- **Copy Trading** - Follow and copy successful traders UI (#100)
- **Gas Settings** - Configure transaction speed presets (#101)
- **Referrals** - Referral link sharing and tracking UI (#102)
- **Subscriptions** - Premium tier plans UI (#103)

#### Testing
- Integration tests hitting real dev API (18 tests)
- Unit tests for hooks and API client (16 tests)
- Test configuration with bun and happy-dom

#### Documentation
- Architecture diagrams (Mermaid)
- Feature roadmap (Gantt chart)
- Data flow sequence diagrams
- CI/CD pipeline documentation
- Release process documentation

### Changed
- Navigation: replaced Portfolio with History in bottom nav
- FeatureGrid: updated with correct routes to new pages
- API: added Points endpoints for webapp (`/webapp/me/points/*`)
- API: added dev auth bypass for testing

### Infrastructure
- Separate dev environment (devapi, devfront, dev database)
- Auto-migrations on API startup
- SSL configured for dev RDS

## [0.3.0] - 2026-01-31

### Added
- Dev/prod environment separation
- Webapp Settings page with slippage, notifications
- API TypeScript rewrite with Effect

## [0.2.0] - 2026-01-30

### Added
- Webapp MVP with Swap, Portfolio, Wallet pages
- Telegram Mini App integration
- Turnkey wallet creation

## [0.1.0] - 2026-01-15

### Added
- Initial Telegram bot with swap functionality
- Li.Fi and Jupiter integration
- PostgreSQL database schema
