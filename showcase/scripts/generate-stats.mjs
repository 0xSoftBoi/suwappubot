/**
 * generate-stats — derive published product numbers from source, at build time.
 *
 * WHY THIS EXISTS
 * The marketing site repeatedly drifted from reality: /about advertised "9 routers
 * raced" when the swap engine builds quote tasks for 18 providers, and a later fix
 * over-corrected by stamping the platform chain count (41) onto /agents, where the
 * authoritative number is whatever GET /v1/agent/chains serves (17). Hand-typed
 * numbers rot. These are parsed from the code that actually ships.
 *
 * THREE SURFACES, THREE NUMBERS. They are genuinely different and must not be
 * collapsed into one figure:
 *   platformChains — chains the bot/terminal expose to users
 *   agentApiChains — chains reachable through the public agent API
 *   routers        — distinct routing providers raced for quotes
 *
 * Offline and deterministic by design: it parses repo files and never calls the
 * network, so a CI build cannot break because api.suwappu.bot blipped.
 *
 * Fails loudly. A parse that finds zero entries means the upstream shape changed;
 * emitting a stale or zero count onto a public page is far worse than a red build.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const OUT = resolve(HERE, '../src/data/stats.generated.json')

const read = (rel) => {
  try {
    return readFileSync(resolve(REPO, rel), 'utf8')
  } catch (err) {
    throw new Error(`generate-stats: cannot read ${rel} — ${err.message}`)
  }
}

/** Slice a source file from a marker line to the first line that is exactly `close`. */
const blockAfter = (src, marker, close) => {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.includes(marker))
  if (start === -1) throw new Error(`generate-stats: marker not found: ${marker}`)
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === close)
  if (end === -1) throw new Error(`generate-stats: unterminated block for: ${marker}`)
  return lines.slice(start, end).join('\n')
}

// ---------------------------------------------------------------- platform chains
// bot/config/chains.py CHAINS{}. TEMPO_TESTNETS is a separate dict the source marks
// "intentionally NOT in CHAINS (not user-selectable)", so slicing at CHAINS excludes
// it for free. base-sepolia lives inside CHAINS and must be filtered explicitly.
const TESTNET = /sepolia|testnet|goerli|devnet/i
const chainsPy = blockAfter(read('bot/config/chains.py'), 'CHAINS: dict[str, ChainConfig] = {', '}')
const platformKeys = [...chainsPy.matchAll(/^\s{4}"([a-z0-9_-]+)":\s*ChainConfig/gm)].map((m) => m[1])
const platformChains = platformKeys.filter((k) => !TESTNET.test(k))

// ---------------------------------------------------------------- agent API chains
// GET /v1/agent/chains = Object.values(CHAINS) deduped by numeric id, plus the
// non-EVM chains the handler appends inline. Mirror that composition exactly.
const tokenSvc = blockAfter(read('api-ts/src/services/TokenService.ts'), 'export const CHAINS', '}')
const evmIds = new Set([...tokenSvc.matchAll(/\bid:\s*(\d+)/g)].map((m) => m[1]))
const agentRoute = blockAfter(read('api-ts/src/routes/agent.ts'), 'const chains = [', '\t]')
const inlineChains = [...agentRoute.matchAll(/^\t{3}key:\s*'([a-z0-9_-]+)'/gm)].map((m) => m[1])
const agentApiChains = evmIds.size + inlineChains.length

// ---------------------------------------------------------------- routing providers
// Providers raced for a quote, taken from where the quote tasks are built. Note these
// are CHAIN-GATED: a Solana swap races Jupiter, a TRON swap races SunSwap. The site may
// say "18 providers integrated" but must never say "every swap races 18".
// Boundaries matter: _gather_quotes is defined ABOVE get_quote, so slicing to it
// would run backwards and silently yield nothing. Cut from get_quote to the first
// individual provider definition that follows it.
const engine = read('bot/services/swap_engine.py')
const sliceBetween = (src, from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a + 1)
  if (a === -1 || b === -1 || b <= a)
    throw new Error(`generate-stats: could not slice swap_engine between "${from}" and "${to}"`)
  return src.slice(a, b)
}
const quoteBuild = sliceBetween(engine, 'async def get_quote(', 'async def _get_lifi_quote(')
const routerKeys = [...new Set([...quoteBuild.matchAll(/self\._get_([a-z0-9_]+)_quote\(/g)].map((m) => m[1]))]

const DISPLAY = {
  '0x': '0x', '1inch': '1inch', okx_dex: 'OKX', kyberswap: 'KyberSwap', lifi: 'Li.Fi',
  cow: 'CoW', cctp: 'CCTP', ccip: 'CCIP', across: 'Across', wormhole: 'Wormhole',
  socket: 'Socket', layerzero: 'LayerZero', jupiter: 'Jupiter', sunswap: 'SunSwap',
  avnu: 'AVNU', goatswap: 'GoatSwap', juiceswap: 'JuiceSwap', tempo_dex: 'Tempo DEX',
  univ3_fork: 'Uniswap V3 forks',
}
const routers = routerKeys.map((k) => DISPLAY[k] ?? k).sort((a, b) => a.localeCompare(b))

// ---------------------------------------------------------------- guard + emit
// A zero here means an upstream file changed shape. Never publish a zero.
const assertNonEmpty = (label, n) => {
  if (!n)
    throw new Error(
      `generate-stats: parsed 0 for ${label} — upstream source shape changed. Fix the parser; do not publish a zero.`
    )
}
assertNonEmpty('platformChains', platformChains.length)
assertNonEmpty('agentApiChains', agentApiChains)
assertNonEmpty('routers', routers.length)

const stats = {
  _comment: 'GENERATED by scripts/generate-stats.mjs — do not edit by hand. Run `bun run stats:generate`.',
  platformChains: platformChains.length,
  agentApiChains,
  routerCount: routers.length,
  routers,
  notes: {
    platformChains: 'bot/config/chains.py CHAINS, excluding testnets. Bot + terminal surface.',
    agentApiChains: 'Mirrors GET /v1/agent/chains. Do NOT use the platform number on agent-API pages.',
    routers: 'Providers raced for quotes. CHAIN-GATED — never claim every swap races all of them.',
  },
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(stats, null, 2) + '\n')
console.log(
  `generate-stats: platform=${stats.platformChains} agentApi=${stats.agentApiChains} routers=${stats.routerCount}`
)
console.log(`  routers: ${routers.join(', ')}`)
