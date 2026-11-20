# Intercepta API feedback (ETHGlobal Tokyo 2026)

- The quick-scan endpoint (`GET /api/public/v2/extension/account/{address}/quick-scan`)
  is simple to integrate and the `traits[]` field on a flagged response is genuinely
  useful — we surface it directly in our payment-rejection error so the caller sees
  *why* a charge was blocked, not just that it was.
- The API key signup flow (a Typeform embedded in the docs site) is a bit of friction
  during a hackathon's tight build window — a self-serve key generation button on the
  docs page itself (even a rate-limited sandbox key) would have let us complete live
  testing instead of shipping fail-closed-but-unverified.
- No documented rate limits or pricing tiers were visible from the docs pages we read —
  worth surfacing that upfront so integrators can size their caching strategy
  correctly (we used a 60s in-memory TTL cache as a reasonable default).
