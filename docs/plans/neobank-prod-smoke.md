# Neobank prod smoke (api.suwappu.bot, 2026-11-28)

| Step | HTTP | Result | Note |
|---|---|---|---|
| 1a GET /health | 200 | PASS | source_fingerprint aec2a8c13615, db connected |
| 1b GET /v1/agent/bank/assets (no key) | 401 | PASS | UNAUTHORIZED |
