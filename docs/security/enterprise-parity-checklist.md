# Enterprise Parity Checklist — Custodial Wallet System

Audit baseline for Suwappu's turnkey (user) and company wallets, distilled from the
official enterprise security documentation of OpenAI (ChatGPT Enterprise), Anthropic
(Claude Enterprise), and NVIDIA (AI Enterprise / PSIRT). Compiled 2026-08-26.

Sourcing caveat: trust.openai.com / trust.anthropic.com are JS-rendered portals that
block direct scraping; controls marked UNVERIFIED are corroborated only by secondary
summaries of those portals, the rest come from the companies' own published pages.

## Encryption
1. **AES-256 at rest, TLS 1.2+ in transit** — OpenAI (openai.com/enterprise-privacy)
2. **Enterprise Key Management** — customer/operator controls encryption keys — OpenAI
3. **Decryption only in restricted, attested environments** — Anthropic (Confidential Inference, anthropic.com/transparency)
4. **Hardware-rooted encryption + remote attestation** for sensitive decryption (AES-GCM-256, per-VM ephemeral keys) — NVIDIA (confidential computing docs)

## Key management / secrets
5. **Envelope encryption (KEK wraps DEK) with a documented rotation policy** — OpenAI EKM model; rotation cadence UNVERIFIED
6. **Signed artifacts** (containers/builds touching key material verifiable by public key) — NVIDIA (AI Enterprise security whitepaper)
7. **SBOM available** for security-relevant components — NVIDIA

## Access control / identity
8. **SSO/SAML 2.0** for operator/admin access — OpenAI + Anthropic
9. **SCIM / automated offboarding** of access — OpenAI + Anthropic
10. **RBAC with least-privilege tiers** — OpenAI + Anthropic
11. **IP allowlisting for admin access** — OpenAI (UNVERIFIED, secondary source)
12. **Least-privilege hardening** — non-root execution, minimal attack surface — NVIDIA

## Audit / logging
13. **Admin audit logs + auth logs, exportable** (compliance API) — OpenAI
14. **Audit logs of who accessed what and when**, available to security teams — Anthropic

## Data retention / deletion
15. **Configurable retention; sensitive data excluded from secondary use; documented deletion** — OpenAI

## Compliance attestation
16. **SOC 2 Type II** independent audit — OpenAI + Anthropic
17. **ISO 27001:2022** (+ 42001 for AI mgmt at Anthropic) — both, UNVERIFIED vs raw portal
18. **Public sub-processor list + pen-test summaries without NDA** — Anthropic

## Vulnerability management / secure SDLC
19. **PSIRT function**: coordinated disclosure, security bulletins — NVIDIA (product-security/psirt-policies)
20. **Bug bounty program** — NVIDIA (Intigriti) + Anthropic (HackerOne)
21. **No Critical/High vulns at release gate; continuous re-scan of shipped artifacts** — NVIDIA
22. **Secure SDLC**: threat modeling, static analysis + secrets scanning, dynamic/pen testing — NVIDIA (security-lifecycle.html)

## Incident response
23. **Detection & response lifecycle** (detect → respond → remediate → postmortem) + threat intel — Anthropic
24. **Severity-scaled remediation timelines** — NVIDIA PSIRT

---

Per-control PASS/GAP results for Suwappu live in `wallet-enterprise-audit.md` in this
directory (produced by the wallet audit against this checklist).
