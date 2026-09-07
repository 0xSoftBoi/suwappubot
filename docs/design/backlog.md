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
