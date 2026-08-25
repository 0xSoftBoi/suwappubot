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

## From design-iterate iteration 6 (2026-08-25)

Found by rendering and looking, not fixed this pass (3-fix budget):

- **Nav is the loudest unfinished thing on the page.** A light glass pill on the
  dark hero holding 9 links (Products, Developers, Why Suwappu, Explore, Signals,
  Research, Pricing, Docs, Telegram) plus three CTAs (Launch Terminal in the bar,
  Explore all, and Launch Terminal again in the hero). Reference sites in this
  category carry 4-5 top-level items. Also a duplicate-CTA-intent violation:
  "Launch Terminal" appears twice above the fold. Repro: screenshot `/` at 1440.
- **The sound toggle is `position: fixed` and rides the whole page.** By the
  execution section it sits on top of the "Authorize" card body text. It belongs
  to the hero; it should stop existing once the hero scrolls past. Repro: scroll
  to `#engine` at 1440, look bottom-right.
- **~250px of dead vertical space** between the use-case grid and the execution
  headline (grid bottom -> section boundary -> next headline). Reads as a gap,
  not as rhythm. Repro: frame 3 of a 850px-step capture at 1440.
- **"cross-chain" still breaks at its hyphen on mobile** ("...for cross-" /
  "chain markets."). Permissible English typography, so it is a nice-to-have, but
  a `white-space: nowrap` span around the compound would remove it. Needs
  next-intl rich-text markup across all four locales.
- **The hero video is sky-dominant.** The top 40% of the frame is pale flat
  cloud, which is exactly where the mask holds full opacity and where the
  headline sits; the water - the part worth showing - is in the lower third
  where the mask fades it out. Consider `object-position: center bottom` on the
  poster/video so the horizon rides higher.
