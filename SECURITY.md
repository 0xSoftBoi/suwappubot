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
- **Fix timeline**: Depends on severity, typically within 30 days

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
- All secrets should be stored in AWS Secrets Manager
- Run `git grep -i "password\|secret\|token\|key"` before committing to check for leaks
