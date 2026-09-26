# Intercepta API Feedback — Suwappu Trust Layer (ETHGlobal Tokyo 2026)

_Intercepta asks for 3–5 lines of API feedback; this file is the long form for
the repo. Keep it honest and specific._

## Integration

- Client: `src/intercepta/client.ts` (address / token / transaction scans)
- Policy mapping: `src/intercepta/policy.ts`
  (findings → `PolicyVerdict` allow/block/require_approval + trust penalty)
- Orchestration: `src/intercepta/screen.ts`
  (pre-sign `payTo` screen → pre-execute unsigned-tx screen)

## Feedback

1. [ ] e.g. "Sandbox key arrived [fast/slow]; the 1,000-request quota was
   [enough/tight] for a hackathon because [reason]."
2. [ ] e.g. "Address screening request/response shape: [what worked, what was
   missing — e.g. we wanted X field for the user-facing block reason]."
3. [ ] e.g. "Transaction screening latency p50/p95 was [X/Y ms]; [fine / too
   slow to run inline before /execute — we had to cache]."
4. [ ] e.g. "Docs gap: [the exact REST paths weren't in the quickstart; we
   confirmed them at the booth]."
5. [ ] e.g. "Most valuable addition for agent builders: [e.g. a single
   'screen this intent' endpoint returning a verdict enum instead of three
   separate scan calls]."

## Notes for the demo judges

- Every screen happens **before signing** (x402 `payTo`) and **before
  execution** (unsigned L3 tx) — never after the fact.
- Blocked/held payments always surface the **visible reason** from the
  findings (`PolicySignal.reason`), and the held path escalates to World ID
  step-up rather than a blind approve button.
- At least one live API call is exercised in the demo; the verdict-mapping
  unit tests (`tests/interceptaPolicy.test.ts`) run without a key.
