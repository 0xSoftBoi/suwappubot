import { createHash, createHmac } from 'node:crypto'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Deterministic public contract sandbox.
 *
 * SECURITY BOUNDARY: this module MUST stay dependency-free from Suwappu services,
 * databases, RPC/provider clients, wallet/signing code, billing, and internal APIs.
 * It is a pure in-memory simulator: it cannot quote live liquidity, sign, broadcast,
 * charge, mutate production state, or move funds.
 *
 * This is intentionally a namespaced contract-testing surface, not a claim that
 * devapi.suwappu.bot is an isolated customer environment. See #874.
 */

export const SANDBOX_WEBHOOK_TEST_SECRET = 'suwappu_sandbox_test_secret_v1'
export const SANDBOX_MAX_OPERATIONS = 1_000
export const SANDBOX_OPERATION_TTL_MS = 15 * 60 * 1000

const sandboxRoutes = new Hono()

type ScenarioName =
	| 'success'
	| 'validation_error'
	| 'policy_rejected'
	| 'quote_expired'
	| 'payment_required'
	| 'rate_limited'
	| 'upstream_unavailable'
	| 'unknown_outcome'

type SandboxIntent = {
	scenario?: ScenarioName
	from_token?: string
	to_token?: string
	amount?: string
	chain?: string
	idempotency_key?: string
}

type StoredOperation = {
	id: string
	fingerprint: string
	idempotencyKey?: string
	createdAt: number
	statusCode: ContentfulStatusCode
	body: Record<string, unknown>
}

const operations = new Map<string, StoredOperation>()
const idempotencyIndex = new Map<string, string>()

const SCENARIOS: Record<
	ScenarioName,
	{
		status: ContentfulStatusCode
		outcome: string
		errorCode?: string
		detail: string
		reconcileRequired?: boolean
		retryAfterSeconds?: number
	}
> = {
	success: {
		status: 200,
		outcome: 'simulated_success',
		detail: 'The sandbox operation completed successfully. No transaction was signed or broadcast.',
	},
	validation_error: {
		status: 400,
		outcome: 'rejected',
		errorCode: 'VALIDATION_ERROR',
		detail: 'Forced sandbox validation failure.',
	},
	policy_rejected: {
		status: 403,
		outcome: 'blocked',
		errorCode: 'POLICY_VIOLATION',
		detail: 'Forced sandbox policy rejection before signing or broadcast.',
	},
	quote_expired: {
		status: 409,
		outcome: 'rejected',
		errorCode: 'QUOTE_EXPIRED',
		detail: 'Forced sandbox quote-expiry failure. Request a new quote before retrying.',
	},
	payment_required: {
		status: 402,
		outcome: 'rejected',
		errorCode: 'PAYMENT_REQUIRED',
		detail: 'Forced sandbox metering/payment challenge. No payment is accepted by this sandbox.',
	},
	rate_limited: {
		status: 429,
		outcome: 'retry_later',
		errorCode: 'RATE_LIMITED',
		detail: 'Forced sandbox rate-limit response.',
		retryAfterSeconds: 2,
	},
	upstream_unavailable: {
		status: 503,
		outcome: 'retry_later',
		errorCode: 'UPSTREAM_ERROR',
		detail: 'Forced sandbox upstream-unavailable response. No upstream was actually called.',
	},
	unknown_outcome: {
		status: 202,
		outcome: 'unknown',
		detail:
			'Forced sandbox unknown-outcome state. Reconcile the operation before retrying with a new idempotency key.',
		reconcileRequired: true,
	},
}

function setSandboxHeaders(c: Parameters<(typeof sandboxRoutes)['get']>[1] extends never ? never : any) {
	c.header('X-Suwappu-Environment', 'sandbox')
	c.header('Cache-Control', 'no-store')
}

function canonicalFingerprint(input: SandboxIntent): string {
	const normalized = {
		scenario: input.scenario ?? 'success',
		from_token: input.from_token ?? 'ETH',
		to_token: input.to_token ?? 'USDC',
		amount: input.amount ?? '0.1',
		chain: input.chain ?? 'base',
	}
	return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function operationIdFor(fingerprint: string, idempotencyKey?: string): string {
	const seed = `${idempotencyKey ?? crypto.randomUUID()}|${fingerprint}`
	return `sbx_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

function pruneOperations(now = Date.now()) {
	for (const [id, operation] of operations) {
		if (now - operation.createdAt > SANDBOX_OPERATION_TTL_MS) {
			operations.delete(id)
			if (operation.idempotencyKey && idempotencyIndex.get(operation.idempotencyKey) === id) {
				idempotencyIndex.delete(operation.idempotencyKey)
			}
		}
	}

	while (operations.size >= SANDBOX_MAX_OPERATIONS) {
		const oldest = operations.keys().next().value as string | undefined
		if (!oldest) break
		const operation = operations.get(oldest)
		operations.delete(oldest)
		if (operation?.idempotencyKey && idempotencyIndex.get(operation.idempotencyKey) === oldest) {
			idempotencyIndex.delete(operation.idempotencyKey)
		}
	}
}

sandboxRoutes.get('/', (c) => {
	setSandboxHeaders(c)
	return c.json({
		environment: 'sandbox',
		kind: 'deterministic-contract-simulator',
		real_funds: false,
		live_quotes: false,
		provider_calls: false,
		rpc_calls: false,
		signing: false,
		broadcast: false,
		billing: false,
		production_database: false,
		persistence: 'ephemeral-in-memory',
		operation_ttl_seconds: SANDBOX_OPERATION_TTL_MS / 1000,
		scenarios: Object.keys(SCENARIOS),
		endpoints: {
			simulate: 'POST /v1/sandbox/simulate',
			operation: 'GET /v1/sandbox/operations/:id',
			resolve_unknown: 'POST /v1/sandbox/operations/:id/resolve',
			webhook_fixture: 'POST /v1/sandbox/webhook-fixture',
			clock: 'POST /v1/sandbox/clock/advance',
		},
		warning:
			'This contract sandbox is not devapi.suwappu.bot and makes no claim about devapi isolation. It never signs, broadcasts, charges, or calls production providers.',
	})
})

sandboxRoutes.post('/simulate', async (c) => {
	setSandboxHeaders(c)
	pruneOperations()

	let input: SandboxIntent
	try {
		input = (await c.req.json()) as SandboxIntent
	} catch {
		return c.json(
			{
				environment: 'sandbox',
				error_code: 'VALIDATION_ERROR',
				detail: 'Invalid JSON body.',
				real_funds: false,
				broadcast: false,
			},
			400,
		)
	}

	const scenario = input.scenario ?? 'success'
	if (!(scenario in SCENARIOS)) {
		return c.json(
			{
				environment: 'sandbox',
				error_code: 'VALIDATION_ERROR',
				detail: `Unknown sandbox scenario: ${String(input.scenario)}`,
				allowed_scenarios: Object.keys(SCENARIOS),
				real_funds: false,
				broadcast: false,
			},
			400,
		)
	}

	const idempotencyKey = (c.req.header('Idempotency-Key') ?? input.idempotency_key)?.trim()
	if (idempotencyKey && !/^[A-Za-z0-9_.:-]{1,64}$/.test(idempotencyKey)) {
		return c.json(
			{
				environment: 'sandbox',
				error_code: 'VALIDATION_ERROR',
				detail: 'Invalid Idempotency-Key. Use 1-64 characters from A-Za-z0-9_.:-',
				real_funds: false,
				broadcast: false,
			},
			400,
		)
	}

	const fingerprint = canonicalFingerprint(input)
	if (idempotencyKey) {
		const existingId = idempotencyIndex.get(idempotencyKey)
		const existing = existingId ? operations.get(existingId) : undefined
		if (existing) {
			if (existing.fingerprint !== fingerprint) {
				return c.json(
					{
						environment: 'sandbox',
						error_code: 'IDEMPOTENCY_CONFLICT',
						detail: 'This Idempotency-Key was already used with different economic terms.',
						operation_id: existing.id,
						real_funds: false,
						broadcast: false,
					},
					409,
				)
			}
			c.header('X-Idempotent-Replayed', 'true')
			if (existing.statusCode === 429) c.header('Retry-After', '2')
			return c.json({ ...existing.body, idempotent_replay: true }, existing.statusCode)
		}
	}

	const config = SCENARIOS[scenario]
	const operationId = operationIdFor(fingerprint, idempotencyKey)
	const body: Record<string, unknown> = {
		environment: 'sandbox',
		operation_id: operationId,
		scenario,
		outcome: config.outcome,
		detail: config.detail,
		intent: {
			from_token: input.from_token ?? 'ETH',
			to_token: input.to_token ?? 'USDC',
			amount: input.amount ?? '0.1',
			chain: input.chain ?? 'base',
		},
		real_funds: false,
		live_quote: false,
		signed: false,
		broadcast: false,
		tx_hash: null,
		reconcile_required: config.reconcileRequired ?? false,
		status_url: `/v1/sandbox/operations/${operationId}`,
		created_at: new Date().toISOString(),
	}
	if (config.errorCode) body.error_code = config.errorCode
	if (config.retryAfterSeconds) {
		body.retry_after_seconds = config.retryAfterSeconds
		c.header('Retry-After', String(config.retryAfterSeconds))
	}

	const stored: StoredOperation = {
		id: operationId,
		fingerprint,
		idempotencyKey,
		createdAt: Date.now(),
		statusCode: config.status,
		body,
	}
	operations.set(operationId, stored)
	if (idempotencyKey) idempotencyIndex.set(idempotencyKey, operationId)

	return c.json(body, config.status)
})

sandboxRoutes.get('/operations/:id', (c) => {
	setSandboxHeaders(c)
	pruneOperations()
	const operation = operations.get(c.req.param('id'))
	if (!operation) {
		return c.json(
		{
			environment: 'sandbox',
			error_code: 'NOT_FOUND',
			detail: 'Sandbox operation not found or expired.',
			real_funds: false,
			broadcast: false,
		},
		404,
		)
	}
	return c.json({ ...operation.body, inspected: true })
})

sandboxRoutes.post('/operations/:id/resolve', async (c) => {
	setSandboxHeaders(c)
	pruneOperations()
	const operation = operations.get(c.req.param('id'))
	if (!operation) {
		return c.json({ environment: 'sandbox', error_code: 'NOT_FOUND', detail: 'Sandbox operation not found.' }, 404)
	}
	if (operation.body.outcome !== 'unknown') {
		return c.json(
		{
			environment: 'sandbox',
			error_code: 'VALIDATION_ERROR',
			detail: 'Only unknown-outcome simulations can be manually resolved.',
			operation_id: operation.id,
		},
		409,
		)
	}

	let requested: { resolution?: 'simulated_success' | 'simulated_failure' }
	try {
		requested = (await c.req.json()) as { resolution?: 'simulated_success' | 'simulated_failure' }
	} catch {
		requested = {}
	}
	if (requested.resolution !== 'simulated_success' && requested.resolution !== 'simulated_failure') {
		return c.json(
		{
			environment: 'sandbox',
			error_code: 'VALIDATION_ERROR',
			detail: 'resolution must be simulated_success or simulated_failure',
		},
		400,
		)
	}

	operation.statusCode = 200
	operation.body = {
		...operation.body,
		outcome: requested.resolution,
		reconcile_required: false,
		resolved_at: new Date().toISOString(),
		detail: `Sandbox unknown outcome manually resolved as ${requested.resolution}.`,
	}
	operations.set(operation.id, operation)
	return c.json(operation.body)
})

sandboxRoutes.post('/webhook-fixture', async (c) => {
	setSandboxHeaders(c)
	let input: { event_type?: string; operation_id?: string; timestamp?: string }
	try {
		input = (await c.req.json()) as { event_type?: string; operation_id?: string; timestamp?: string }
	} catch {
		input = {}
	}

	const timestamp = input.timestamp ?? new Date().toISOString()
	const payload = {
		event: input.event_type ?? 'swap.status.updated',
		timestamp,
		data: {
			operation_id: input.operation_id ?? 'sbx_example',
			status: 'simulated_success',
			environment: 'sandbox',
			real_funds: false,
		},
	}
	const rawBody = JSON.stringify(payload)
	const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000).toString()
	const signature = createHmac('sha256', createHash('sha256').update(SANDBOX_WEBHOOK_TEST_SECRET).digest())
		.update(rawBody)
		.digest('hex')
	const deliveryId = `sbx_wh_${createHash('sha256').update(rawBody).digest('hex').slice(0, 20)}`

	return c.json({
		environment: 'sandbox',
		real_delivery: false,
		test_secret: SANDBOX_WEBHOOK_TEST_SECRET,
		raw_body: rawBody,
		headers: {
			'Content-Type': 'application/json',
			'X-Suwappu-Event': payload.event,
			'X-Suwappu-Delivery': deliveryId,
			'X-Suwappu-Timestamp': unixTimestamp,
			'X-Suwappu-Signature': signature,
		},
		verification:
			'HMAC-SHA256 over raw_body using SHA256(test_secret) as the HMAC key. This secret is public and sandbox-only.',
	})
})

sandboxRoutes.post('/clock/advance', async (c) => {
	setSandboxHeaders(c)
	let input: { now?: string; seconds?: number }
	try {
		input = (await c.req.json()) as { now?: string; seconds?: number }
	} catch {
		input = {}
	}
	const base = input.now ? new Date(input.now) : new Date()
	const seconds = input.seconds ?? 3600
	if (!Number.isFinite(base.getTime()) || !Number.isFinite(seconds) || seconds < 0 || seconds > 31 * 24 * 60 * 60) {
		return c.json(
		{
			environment: 'sandbox',
			error_code: 'VALIDATION_ERROR',
			detail: 'Provide a valid ISO timestamp and seconds between 0 and 2678400 (31 days).',
		},
		400,
		)
	}
	const advanced = new Date(base.getTime() + seconds * 1000)
	return c.json({
		environment: 'sandbox',
		virtual_only: true,
		base_time: base.toISOString(),
		advance_seconds: seconds,
		virtual_time: advanced.toISOString(),
		production_clock_changed: false,
	})
})

export { sandboxRoutes }
