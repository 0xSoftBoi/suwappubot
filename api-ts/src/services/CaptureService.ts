import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, interactionEvents, requireDb, userIntents } from '../db'
import { DatabaseError } from '../errors'
import { logger } from '../lib/logger'
import { redactSensitiveData } from '../lib/sentryRedact'
import { screenForSecrets } from '../utils/captureRedaction'

export type CaptureSurface = 'telegram' | 'webapp' | 'terminal' | 'api' | 'mcp' | 'whatsapp'

export interface RecordIntentInput {
	userId?: number | null
	surface: CaptureSurface
	rawText?: string | null
	sessionKey: string
	turnIndex?: number
	intentType?: string | null
	resolvedAction?: Record<string, unknown> | null
	resolutionStatus?: 'resolved' | 'clarified' | 'abandoned' | 'failed'
	swapId?: number | null
}

export interface RecordEventInput {
	userId?: number | null
	surface: CaptureSurface
	eventType: string
	payload?: Record<string, unknown> | null
	sessionKey?: string | null
}

export interface CaptureServiceInterface {
	/**
	 * Bank one (input -> resolved structured action) training pair. NEVER
	 * fails the caller — capture is best-effort telemetry for a future
	 * fine-tune, not a request-path dependency. Any DB or screening error is
	 * caught and logged, and the effect always succeeds with void.
	 */
	readonly recordIntent: (input: RecordIntentInput) => Effect.Effect<void, never, DrizzleService>
	/**
	 * Record broad append-only telemetry. Same failure-isolation guarantee as
	 * recordIntent.
	 */
	readonly recordEvent: (input: RecordEventInput) => Effect.Effect<void, never, DrizzleService>
}

export class CaptureService extends Context.Tag('CaptureService')<
	CaptureService,
	CaptureServiceInterface
>() {}

export const CaptureServiceLive = Layer.succeed(CaptureService, {
	recordIntent: (input: RecordIntentInput) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			let rawText: string | null = input.rawText ?? null
			let redacted = false
			let redactionReason: string | null = null

			if (rawText) {
				const screen = screenForSecrets(rawText)
				if (screen.unsafe) {
					rawText = null
					redacted = true
					redactionReason = screen.reason ?? 'secret_detected'
				}
			}

			// SECURITY (defense in depth): resolvedAction is structured data built
			// from route handlers — often including third-party quote/order blobs
			// (LI.FI/Jupiter/CLOB responses) — that is NEVER screened by
			// screenForSecrets, which only inspects rawText. A credentialed RPC
			// URL (Alchemy/Helius/QuickNode with an embedded API key) or a JWT/AWS
			// key nested anywhere in that object would otherwise be persisted in
			// cleartext. Route handlers should already strip known-bad fields
			// (e.g. raw_quote) before calling recordIntent, but this recursive
			// screen is the backstop that fails closed regardless.
			const screenedResolvedAction = input.resolvedAction
				? redactSensitiveData(input.resolvedAction)
				: null

			yield* Effect.tryPromise({
				try: () =>
					db.insert(userIntents).values({
						userId: input.userId ?? null,
						surface: input.surface,
						rawText,
						redacted,
						redactionReason,
						intentType: input.intentType ?? null,
						resolvedAction: screenedResolvedAction,
						resolutionStatus: input.resolutionStatus ?? 'resolved',
						turnIndex: input.turnIndex ?? 0,
						sessionKey: input.sessionKey,
						swapId: input.swapId ?? null,
					}),
				catch: (e) => new DatabaseError({ message: `Failed to record intent: ${e}`, cause: e }),
			})
		}).pipe(
			Effect.catchAll((e) =>
				Effect.sync(() => {
					logger.warn(`[CaptureService] recordIntent failed (non-fatal): ${e}`)
				}),
			),
		),

	recordEvent: (input: RecordEventInput) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// See recordIntent above: payload is unscreened structured data and
			// gets the same recursive secret redaction as a backstop.
			const screenedPayload = input.payload ? redactSensitiveData(input.payload) : null

			yield* Effect.tryPromise({
				try: () =>
					db.insert(interactionEvents).values({
						userId: input.userId ?? null,
						surface: input.surface,
						eventType: input.eventType,
						payload: screenedPayload,
						sessionKey: input.sessionKey ?? null,
					}),
				catch: (e) => new DatabaseError({ message: `Failed to record event: ${e}`, cause: e }),
			})
		}).pipe(
			Effect.catchAll((e) =>
				Effect.sync(() => {
					logger.warn(`[CaptureService] recordEvent failed (non-fatal): ${e}`)
				}),
			),
		),
})
