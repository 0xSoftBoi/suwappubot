/** Shared wallet-selection helper. There's exactly one "the user's own
 * receiving address" concept in this app — Receive and the card on-ramp both
 * need it — so it lives here once instead of being re-derived per screen. */
import type { Wallet } from '../types/api'

export function pickPrimaryEvmWallet(wallets: Wallet[]): Wallet | null {
  const evm = wallets.filter((w) => w.chainType.toLowerCase() === 'evm')
  return evm.find((w) => w.isDefault) ?? evm[0] ?? wallets[0] ?? null
}
