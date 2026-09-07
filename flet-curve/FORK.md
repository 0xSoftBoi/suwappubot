# Fork provenance

This directory is Suwappu's fork of
[michwill/flet-curve-demo](https://github.com/michwill/flet-curve-demo) — an
alternative Curve Finance UI written in Python/Flet that runs both as a static
website (WASM) and as a native desktop app.

- Forked from upstream commit `835259b7bc2cc7f9906bb6299c08552d6ebf9953` (2026-08-23).
- Vendored into the monorepo (rather than a GitHub fork) so it deploys and
  evolves with the rest of Suwappu; upstream `.git` history is not carried.
- `vendor/electric-router` is vendored from
  [michwill/electric-router](https://github.com/michwill/electric-router) at
  upstream commit `e194e256954fe30305caa48308952982f2c17d6c` — the
  physics-based cross-pool router (swaps solved as electric circuits; Rust
  solver + EVM compiled to WASM for the browser, deployed `RouteQuoter.vy` at
  `0x9a32418b9fd744efd6820577037529d5ba9de679` on every supported chain). See
  its `docs/browser-port.md` for the integration seams. The `curve-assets`
  submodule is not vendored — fetch from upstream if you need a full local
  flet build.

## Why it's here

It is the reference implementation behind Suwappu's **first-class native Curve
support**:

- `terminal/` — native Curve pools venue (`terminal/src/lib/curve.ts`,
  `terminal/src/components/curve/`) speaks the same Curve Prices API
  (`prices.curve.finance` v1/v2 + `api2.curve.finance` for Lite chains) with
  the same field semantics documented in `src/curve/api.py` here
  (`base_weekly_apr` is percent in v2, `MAX_PAGE_SIZE = 50`, `min_tvl` floor).
- `showcase/` — the Curve integration surface on the marketing site.

Upstream docs live in `README.md` and `docs/` unchanged.
