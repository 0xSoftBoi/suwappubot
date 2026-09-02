- (2026-08-25, iter 6, nice-to-have) Capability-card kickers on #routing (CROSS-CHAIN /
  HYPERLIQUID / TEMPO / CURVE FINANCE) reprise the mono-caps rhythm 4x in one grid.
  They carry real venue names so they stay for now; if the grid ever gets imagery or
  tinted cells, drop the kickers and let the venue name lead the headline instead.
- (2026-08-25, iter 8) DepthSurfaceGL rehomed beside the #routing headline (the
  sanctioned figure-split). Still orphaned: ToolConstellationGL (needs an honest
  toolCount — the old MCP_TOOLS list is gone from src; source it from the api-ts MCP
  registry before wiring) and QuoteRaceGL (known LINES-draw bug + density problem,
  see design-iterate skill notes). The ridge is deliberately faint; judge it in
  motion on the live deploy before deciding to raise its alpha.
- (2026-08-25, iter 9) ToolConstellationGL wired into #terminal, sourced from a new
  `mcpToolCount`/`mcpTools` field in stats.generated.json (parsed from api-ts's real
  TOOLS registry in mcpTools.ts, 22 tools) so the figure can never claim tools that
  don't exist. Remaining orphan: QuoteRaceGL (known LINES-draw bug), still not wired.
- (2026-09-02, parity pass) #portfolio is the last homepage section with an empty
  right column. Root cause was product, not design: the terminal's GET /webapp/portfolio was a
  stub and portfolio history had no backend. Both are now wired for real on this branch
  (commits 3021934, e5f7648): shared build_portfolio_for_user with real balances priced via
  price_service, portfolio_value_snapshots table, PortfolioSnapshotter every 15 min plus
  request-path snapshots, GET /webapp/portfolio/history, api-ts proxy + Drizzle mirror,
  terminal usePortfolioHistory + EquityCurve states. Remaining, after deploy: sign in to the
  live terminal, let snapshots accrue, capture the Portfolio pane as a 3160px plate and place
  it in #portfolio with ProofShot like #routing's perps plate. Evidence of the pre-fix state:
  docs/design/portfolio-plate-2026-09-02.png.
- (2026-09-02) Screenshot hygiene: the homepage sets html{scroll-behavior:smooth}, so any
  Playwright frame taken right after window.scrollTo shows a stale cream band above the sticky
  header. It is a capture artefact, not a page defect (verified: with scroll-behavior forced to
  auto the top pixels are pure black). Force `html{scroll-behavior:auto}` in capture scripts.
