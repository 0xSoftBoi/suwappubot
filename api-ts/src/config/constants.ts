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
