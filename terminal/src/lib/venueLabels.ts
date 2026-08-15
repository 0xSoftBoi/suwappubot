/**
 * Human-readable labels for swap venue ids.
 *
 * The API returns the engine's internal provider id in `quote.route` (e.g.
 * `propamm_titan`, `0x_crosschain`). Rendering those raw leaks debug-looking
 * strings into the trade ticket, so map the known ones and fall back to the
 * raw id for anything new — a venue we haven't labelled yet should still
 * display, never blank.
 */
const VENUE_LABELS: Record<string, string> = {
  '0x': '0x',
  '0x_crosschain': '0x Cross-Chain',
  '1inch': '1inch',
  across: 'Across',
  avnu: 'AVNU',
  cctp: 'Circle CCTP',
  ccip: 'Chainlink CCIP',
  cow: 'CoW Protocol',
  goatswap: 'GoatSwap',
  jito: 'Jito',
  juiceswap: 'JuiceSwap',
  jupiter: 'Jupiter',
  kyberswap: 'KyberSwap',
  layerzero: 'LayerZero',
  lifi: 'Li.Fi',
  okx_dex: 'OKX DEX',
  propamm_titan: 'PropAMM · Titan',
  socket: 'Socket',
  sunswap: 'SunSwap',
  tempo_dex: 'Tempo DEX',
  usdt0: 'USDT0',
  wormhole: 'Wormhole',
}

export function venueLabel(route: string | null | undefined): string {
  if (!route) return '—'
  return VENUE_LABELS[route] ?? VENUE_LABELS[route.toLowerCase()] ?? route
}

/**
 * Best-route savings vs the runner-up, as shown on the ticket.
 *
 * Returns null when there is nothing honest to show: no runner-up raced, no
 * measurable edge, or a non-finite figure. Sub-cent amounts are suppressed —
 * "$0.00 saved" reads as broken, and the number is an estimate at quote time,
 * not a realized amount.
 */
export function formatSavings(
  usd: number | null | undefined,
  runnerUp: string | null | undefined,
): { amount: string; versus: string } | null {
  if (usd == null || !Number.isFinite(usd) || usd < 0.01) return null
  if (!runnerUp) return null
  return { amount: `$${usd.toFixed(2)}`, versus: venueLabel(runnerUp) }
}
