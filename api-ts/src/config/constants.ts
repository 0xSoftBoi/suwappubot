/**
 * Shared runtime constants for the api-ts service.
 */

/**
 * Default swap slippage tolerance as a fraction (0.005 = 0.5%).
 *
 * Kept in sync with every other surface — the Python bot, webapp, and terminal
 * all default to 0.5%. Do not diverge from this without changing the others.
 */
export const DEFAULT_SLIPPAGE = 0.005

/**
 * ERC-20 approval policy for swap routers, mirroring the Python bot's
 * `approval_mode` setting (bot/config/settings.py).
 *
 * - 'unlimited' (default): approve max uint256 so the router is approved once
 *   and subsequent swaps skip the approval tx (fewer txs, but the full token
 *   balance stays exposed to the router forever).
 * - 'exact': approve only the amount this swap will pull (token base units), so
 *   no standing allowance survives the swap.
 *
 * Defaults to 'unlimited' unless APPROVAL_MODE is explicitly set to 'exact'.
 */
export const APPROVAL_MODE = (process.env.APPROVAL_MODE === 'exact' ? 'exact' : 'unlimited') as
	| 'exact'
	| 'unlimited'

/**
 * Single source of truth for the agent-surface platform swap fee on SOLANA
 * (Jupiter `platformFeeBps`).
 *
 * Intentionally a FLAT rate, not the Python bot's subscription tier table
 * (1% / 0.5% / 0.3% / 0.1%): agents authenticate via x402 prepaid credits and
 * have no Telegram subscription tier, so the per-tier discount the bot applies
 * cannot be resolved here. 30 bps == 0.3% == the bot's PREMIUM-tier rate.
 *
 * EnvService reads `FEE_BPS` (overridable per-deploy) and falls back to this.
 * Both EnvService's default and JupiterService MUST derive from this constant —
 * do not re-hardcode "30" anywhere or the displayed/charged fee will drift.
 */
export const DEFAULT_AGENT_FEE_BPS = 30

/**
 * Agent-surface platform swap fee on EVM chains (Li.Fi `fee` integrator param),
 * expressed as a FRACTION (0.008 = 0.8%). Li.Fi's API wants a fraction, not bps.
 *
 * KNOWN DIVERGENCE (intentional, documented): this is 0.8% while the Solana
 * agent fee above is 0.3%. They are NOT unified because changing either would
 * change what agents are actually charged on-chain — out of scope for a
 * coherence pass that must not silently move charged amounts. This constant
 * exists so the value lives in exactly one place (was hardcoded as a string
 * literal in SwapService with a stale "matches bot" comment — the bot's
 * canonical FREE rate is 1%, so it never matched). Reconciling EVM↔Solana agent
 * fees, or making them tier-aware, is a deliberate product decision left to a
 * follow-up.
 */
export const AGENT_FEE_FRACTION_EVM = '0.008'

/**
 * Default Solana fee-collection wallet (receives Jupiter platform fees).
 * Overridable via FEE_WALLET_SOLANA env. Single literal shared by EnvService
 * and JupiterService so the two can never point at different wallets.
 */
export const DEFAULT_FEE_WALLET_SOLANA = '4Xxbeusi6NL46AtZQHJrPREtYFCByKE48oxrpLvWEWJh'

/**
 * Default EVM fee-collection wallet. Overridable via FEE_WALLET_EVM env.
 */
export const DEFAULT_FEE_WALLET_EVM = '0x6456f69215C470e1545Ed6eea4621C136B30D85d'
