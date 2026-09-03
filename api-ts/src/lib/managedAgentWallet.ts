import { Effect } from 'effect'
import type { Agent } from '../db'
import { ExternalServiceError, ValidationError } from '../errors'
import { TurnkeyService, type TurnkeyWallet } from '../services/TurnkeyService'
import {
	managedAgentWalletIdentityFromMetadata,
	managedAgentWalletIsProvisioned,
} from './managedWalletMetadata'

/**
 * Resolve an agent's canonical managed wallet and re-attest it at Turnkey.
 *
 * Metadata version checks are not sufficient on their own: every metadata key
 * was caller-writable before the v2 reservation shipped, so legacy records can
 * contain forged canonical-looking values. Privileged consumers must call this
 * helper immediately before using a Turnkey sub-org or wallet address.
 */
export function attestManagedAgentWallet(
	agent: Pick<Agent, 'id' | 'metadata'>,
): Effect.Effect<TurnkeyWallet, ValidationError | ExternalServiceError, TurnkeyService> {
	return Effect.gen(function* () {
		const identity = managedAgentWalletIdentityFromMetadata(agent.metadata)
		if (!identity || !managedAgentWalletIsProvisioned(agent.metadata)) {
			return yield* Effect.fail(
				new ValidationError({
					message: 'Managed wallet is not fully provisioned; create or repair it before continuing',
				}),
			)
		}

		const turnkey = yield* TurnkeyService
		return yield* turnkey
			.verifyAgentWallet(agent.id, identity.subOrgId, identity.address, 'evm')
			.pipe(
				Effect.mapError(
					(error) =>
						new ExternalServiceError({
							message: 'Managed wallet ownership could not be verified',
							service: 'turnkey',
							cause: error,
						}),
				),
			)
	})
}
