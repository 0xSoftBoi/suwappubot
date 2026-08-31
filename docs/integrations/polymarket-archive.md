# Polymarket Orderbook Archive (archive.pendulumflow.com)

Free historical Polymarket orderbook data: hourly Parquet files, no auth, no
rate limit. Donation-funded by pendulumflow. Machine-readable spec:
`https://archive.pendulumflow.com/llms.txt`; human pages under `/formats`.

## What we ship

| Surface | Where | What |
|---------|-------|------|
| Bot | `/pmdata` (`bot/handlers/pmdata.py`) | Overview with live latest-hour probe, per-day and per-hour download links, v3 manifest sha256 + per-event-type row counts |
| Service | `bot/services/polymarket_archive.py` | Era registry, URL construction, latest-hour probe, COVERAGE/SCHEMA/INCIDENTS/manifest fetchers (cached 5 min), SHA256SUMS URLs |
| Agent API | `GET /v1/agent/predict/archive/*` (`api-ts/src/routes/predict.ts` + `PolymarketArchiveService`) | info, coverage, incidents, hour-range URL resolution, v3 hour manifest |

We deliberately do **not** parse Parquet server-side: files run ~10^8 rows/hour
(a 2026-08-30 hour: 101.7M rows, 1.02 GB). The integration resolves the right
era and hands traders/agents exact URLs, manifests, and checksums; they pull
data themselves.

## Eras (four, NOT interchangeable — different schemas and provenance)

| Era | Span (UTC hours) | Path shape | Trades | Grade | Licence |
|-----|------------------|-----------|--------|-------|---------|
| `pmxt/v1` | 2026-02-21T18 → 2026-04-16T05 | `pmxt/v1/polymarket_orderbook_YYYY-MM-DDTHH.parquet` | no | snapshot | CC BY 4.0 (pmxt) |
| `pmxt/v2` | 2026-04-13T19 → 2026-08-09T23 | `pmxt/v2/polymarket_orderbook_YYYY-MM-DDTHH.parquet` | yes | snapshot | CC BY 4.0 (pmxt) |
| `third-party/ag6` | 2026-08-09T20 → 2026-08-15T09 | `third-party/ag6/polymarket_orderbook_YYYY-MM-DDTHH.parquet` | yes | snapshot, unaudited | **none stated** (ag6) |
| `v3` | 2026-08-18T06 → ongoing | `v3/YYYY-MM-DD/HH/YYYY-MM-DDTHH.parquet` (+`manifest.json`) | yes | replay | CC BY 4.0 (pendulumflow) |

Resolution preference on overlap: `v3` > `pmxt/v2` > `third-party/ag6` >
`pmxt/v1`. ag6 (single source, no witness pipeline, quality audit pending,
mirrored 2026-08-26 from polymarket-archive.ag6.ai) is used only where nothing
else serves the hour — but it matters: it carries the complete 2026-08-10T00
that pmxt's own capture truncated, and bridges most of the pmxt→v3 handover.
**The only true hole is 68 hours: 2026-08-15T10 → 2026-08-18T05.**

On the v1/v2 overlap (Apr 13–16) 59 basenames exist in both eras with
different bytes — never key by basename, only by era-qualified URL.

## v3 layout — the byte-range trick

v3 rows are grouped by event type (`book`, `price_change`, `best_bid_ask`,
`last_trade_price`, `new_market`, `market_resolved`, `tick_size_change`), one
schema across all types (inapplicable columns are null). The hour's
`manifest.json` carries top-level `sha256`/`bytes`/`row_count` plus
`products.<event_type>` with `byte_range` (half-open), `row_count`, `sha256`,
`columns`, `order_by` — so a query engine (DuckDB `union_by_name`, pyarrow
over an HTTP filesystem) reads a single event type via Range requests without
downloading the hour. Note the manifest range is half-open while HTTP Range is
inclusive: subtract one from the end. `sequence` de-duplicates exactly but is
collector-local — order by `timestamp_received` (µs); use `timestamp` for
event time. Hours before 2026-08-23T21 lost sub-microsecond detail at merge;
hours predating the 28-column widening carry 25 columns (schema seam).

## Verification & metadata (probed live 2026-08-31)

- `v3/COVERAGE.json` — per-hour verdicts `{status: complete|partial|refused,
  minutes, witnesses, first/last_event}` + counts; generated retroactively so
  it lags the newest hours (bot probes actual files for "latest"). Only v3
  publishes COVERAGE/SCHEMA today; pmxt-era URLs 404 → both stacks return
  null/None gracefully.
- `SHA256SUMS.txt` per era for v3 and pmxt/v1+v2 (`<prefix>SHA256SUMS.txt`);
  ag6 has none.
- `INCIDENTS.json` at root; one incident (2026-08-26T04–07 feed interruption,
  cause explicitly not established).
- "Coverage vocabulary": `complete` ≠ lossless; `audit pending` means
  not-looked-at, not OK. Unlisted paths 404 by design — don't guess paths.

## Analysis foot-guns (from the archive's own llms.txt)

Do not compute: spreads from averaged quotes, depth from fills, exact
inter-trade gaps, cross-asset volume sums without complement handling
(a market's outcomes are complements — `new_market.assets_ids`), "wash
trading" from matching sides, people-counts from addresses, turnover without
open interest, or latency across rows with different `source_witness`
(different clocks; `source_witness` reflects merge registry position, not who
heard first — use `witness_set` for who heard it).

## Attribution (required)

Every surface showing archive data appends: v3 by pendulumflow, pmxt eras by
pmxt (archive.pmxt.dev), both CC BY 4.0; third-party/ag6 by ag6 (no licence
stated); free, donation-funded. Constants:
`bot/services/polymarket_archive.py:ATTRIBUTION` and the api-ts info payload.
