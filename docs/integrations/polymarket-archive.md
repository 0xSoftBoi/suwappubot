# Polymarket Orderbook Archive (archive.pendulumflow.com)

Free historical Polymarket orderbook data: hourly Parquet files, no auth, no
rate limit, CC BY 4.0. Donation-funded by pendulumflow. Machine-readable spec:
`https://archive.pendulumflow.com/llms.txt`.

## What we ship

| Surface | Where | What |
|---------|-------|------|
| Bot | `/pmdata` (`bot/handlers/pmdata.py`) | Overview, per-day and per-hour download links, v3 manifest sha256 |
| Service | `bot/services/polymarket_archive.py` | Era registry, URL construction, COVERAGE/SCHEMA/INCIDENTS/manifest fetchers (cached 5 min) |
| Agent API | `GET /v1/agent/predict/archive/*` (`api-ts/src/routes/predict.ts` + `PolymarketArchiveService`) | info, coverage, incidents, hour-range URL resolution, v3 hour manifest |

We deliberately do **not** parse Parquet server-side: files run ~10^8 rows/hour
(~2.3B rows/day archive-wide). The integration resolves the right era and hands
traders/agents exact URLs, manifests, and checksums; they pull data themselves.

## Eras (NOT interchangeable — different schemas)

| Era | Span (UTC hours) | Path shape | Trades | Timestamps |
|-----|------------------|-----------|--------|------------|
| `pmxt/v1` | 2026-02-21T18 → 2026-04-16T05 | `pmxt/v1/polymarket_orderbook_YYYY-MM-DDTHH.parquet` | no | ms |
| `pmxt/v2` | 2026-04-13T19 → 2026-08-09T23 | `pmxt/v2/polymarket_orderbook_YYYY-MM-DDTHH.parquet` | yes | ms |
| `v3` | 2026-08-18T06 → ongoing | `v3/YYYY-MM-DD/HH/YYYY-MM-DDTHH.parquet` (+`manifest.json`) | yes | µs, `sequence` |

On the v1/v2 overlap (Apr 13–16) we prefer v2. Same basenames exist in both
with different bytes — never key by basename. There is **no data** between
2026-08-10 and 2026-08-18T05 (the gap between pmxt's capture stopping and
v3 starting).

## Verified facts (probed live 2026-08-31)

- Only `v3/` publishes `COVERAGE.json` / `SCHEMA.json` today; the pmxt-era
  metadata URLs 404. Both stacks return null/None gracefully for those.
- `INCIDENTS.json` is served at the root; one incident recorded
  (2026-08-26T04–07 feed interruption, cause explicitly not established).
- v3 hour manifests carry per-product `sha256` for download verification.

## Analysis foot-guns (from the archive's own llms.txt)

Do not compute: spreads from averaged quotes, depth from fills, exact
inter-trade gaps, cross-asset volume sums without complement handling
(a market's outcomes are complements), "wash trading" from matching sides,
people-counts from addresses, turnover without open interest, or latency
across rows with different `source_witness` (different clocks). Concatenating
v3 hours across the 25→28-column schema seam needs `union_by_name=true`
(DuckDB) or a unified pyarrow schema.

## Attribution (required, CC BY 4.0)

Every surface showing archive data appends: data from the Polymarket
Orderbook Archive (archive.pendulumflow.com) — v3 by pendulumflow, pmxt eras
by pmxt (archive.pmxt.dev) — free, donation-funded. The constant lives in
`bot/services/polymarket_archive.py:ATTRIBUTION` and the api-ts info payload.
