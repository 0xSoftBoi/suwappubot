import { describe, expect, it } from 'bun:test'
import { Effect, Option } from 'effect'
import { DrizzleService } from '../db/DrizzleService'
import type { DbClient } from '../db/client'
import { CaptureServiceLive, CaptureService } from '../services/CaptureService'

/**
 * FIX 3: resolvedAction/payload are structured data built from route handlers
 * — including third-party quote/order blobs — and are NEVER screened by
 * screenForSecrets (which only inspects rawText). CaptureService must run
 * them through the same recursive secret redaction Sentry uses
 * (redactSensitiveData / CREDENTIALED_URL) before persisting, so a
 * credentialed RPC URL nested anywhere inside resolvedAction never lands in
 * cleartext in the capture tables.
 */

function fakeDb(capture: { insertedValues: unknown }): DbClient {
	return {
		insert: () => ({
			values: (v: unknown) => {
				capture.insertedValues = v
				return Promise.resolve([{ id: 1 }])
			},
		}),
	} as unknown as DbClient
}

describe('CaptureService resolvedAction/payload redaction', () => {
	it('redacts a credentialed alchemy URL nested deep inside resolvedAction before persisting', async () => {
		const capture: { insertedValues: unknown } = { insertedValues: undefined }
		const db = fakeDb(capture)

		const nestedAlchemyUrl =
			'https://eth-mainnet.g.alchemy.com/v2/SUPER-SECRET-ALCHEMY-KEY-123'

		// Run recordIntent against the fake db-backed layer.
		const captureServiceEffect = Effect.gen(function* () {
			const captureService = yield* CaptureService
			yield* captureService.recordIntent({
				surface: 'api',
				sessionKey: 'test-session',
				intentType: 'swap',
				resolvedAction: {
					provider: 'lifi',
					route: {
						steps: [
							{
								estimate: {
									// Third-party quote blobs (LI.FI/Jupiter) can bury a
									// credentialed RPC URL arbitrarily deep in nested route data.
									rpcUrl: nestedAlchemyUrl,
								},
							},
						],
					},
				},
				resolutionStatus: 'resolved',
			})
		})

		await Effect.runPromise(
			captureServiceEffect.pipe(
				Effect.provide(CaptureServiceLive),
				Effect.provideService(DrizzleService, Option.some(db)),
			),
		)

		const inserted = capture.insertedValues as { resolvedAction: Record<string, unknown> }
		expect(inserted).toBeDefined()
		const serialized = JSON.stringify(inserted.resolvedAction)
		expect(serialized).not.toContain('SUPER-SECRET-ALCHEMY-KEY-123')
		expect(serialized).toContain('alchemy.com')
		expect(serialized).toContain('[REDACTED]')
	})
})
