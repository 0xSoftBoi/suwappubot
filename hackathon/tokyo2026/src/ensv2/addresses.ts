/**
 * ENSv2 Sepolia deployment addresses.
 *
 * ⚠️ Interfaces were non-final at research time (Sept 2026). Re-confirm these
 * against the current ENS workshop / docs before the demo. Source:
 * ETHGlobal New York 2026 winners (Herit, etc.).
 */
import type { Address } from 'viem'

export const SEPOLIA_CHAIN_ID = 11155111 as const

export const ENSV2_SEPOLIA = {
	PermissionedRegistry: '0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67' as Address,
	ETHRegistrar: '0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA' as Address,
	PaymentToken: '0x3DfC8b53dAFa5eBbb071a8B97678Ab534Ed838D9' as Address,
	VerifiableFactory: '0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198' as Address,
	UniversalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' as Address,
} as const

/** Text-record keys this project uses on agent subnames. */
export const TEXT_KEYS = {
	policy: 'suwappu.policy',
	worldId: 'suwappu.worldid',
	risk: 'suwappu.risk',
	version: 'suwappu.agent-version',
} as const

export function agentSubname(agent: string, parent = 'suwappu'): string {
	return `${agent}.${parent}.eth`
}
