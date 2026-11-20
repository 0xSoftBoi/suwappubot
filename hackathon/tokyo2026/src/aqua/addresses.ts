/**
 * 1inch Aqua — canonical addresses.
 *
 * Verified 2026-09-25:
 * - Aqua registry 0x1111… (CREATE3 vanity, same on all chains) — has code on
 *   Sepolia; ship() selector 0xf50b870f dispatches and returns a strategyHash.
 * - SwapVM router: current 0x1111…338c (2026-07-26 redeploy) has NO code on
 *   Sepolia; the previous 0x1111…3db0 DOES — its quote() (0x44aa5f14)
 *   dispatches with SDK 0.4.4 encoding. Use the previous router on Sepolia.
 * - The 0x4999… dev-release addresses are SUPERSEDED — do not use.
 */
export const AQUA_REGISTRY = '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a' as const
export const SWAPVM_ROUTER_CURRENT = '0x111111338c5091e8440b67b168bae16a668ac0de' as const
/** Previous router — the one actually deployed on Sepolia. */
export const SWAPVM_ROUTER_SEPOLIA = '0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de' as const
