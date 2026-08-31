# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Suwappu, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@suwappu.bot**

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Medium-or-higher severity vulnerabilities are patched within
  30 days of triage (a hard commitment — half the OpenSSF Best Practices 60-day
  bar); lower severities are batched into the next release.

### Project transparency

Suwappu currently has a small maintainer team (bus factor ~2). We state this
openly rather than obscure it: security review depth comes from the layered CI
gates (CodeQL, secret scanning, dependency audits, money-path review process)
documented in `docs/security/`, and external reports through this policy are
correspondingly valued.

### Scope

The following are in scope:
- Smart contract interactions and wallet security
- API authentication and authorization bypasses
- Cross-site scripting (XSS) or injection vulnerabilities
- Sensitive data exposure
- Telegram bot command injection

### Out of scope

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report to the upstream project)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on `main` | Yes |
| Older versions | No |

## Security Best Practices for Contributors

- Never commit secrets, API keys, or private keys
- Use environment variables for all sensitive configuration
- Store secrets only in the configured deployment secret store; never commit them to the repository
- Run `git grep -i "password\|secret\|token\|key"` before committing to check for leaks
