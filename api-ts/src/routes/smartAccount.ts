import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { isAddress } from 'viem'
import { mapErrorToResponse, ValidationError } from '../errors'
import { runEffectEither } from '../runtime'
import { SmartAccountService } from '../services'

// ERC-4337 smart-account endpoints (Kernel v0.3.1 via permissionless.js).
// Read-only by design: address prediction and the capability descriptor. The
// UserOperation-sending path lives in SmartAccountService but is intentionally
// NOT exposed here until it has been verified end-to-end on a testnet.
export const smartAccountRoutes = new Hono()

// GET /v1/smart-account/config — what's deployed and whether sending is enabled.
smartAccountRoutes.get('/config', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* SmartAccountService
			return yield* svc.getConfig()
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as Error)
		return c.json(body, status)
	}
	const cfg = result.right
	return c.json({
		enabled: cfg.enabled,
		entry_point: cfg.entryPointAddress,
		entry_point_version: cfg.entryPointVersion,
		kernel_version: cfg.kernelVersion,
		supported_chain_ids: cfg.supportedChainIds,
	})
})

// POST /v1/smart-account/predict — counterfactual address for { chainId, owner }.
smartAccountRoutes.post('/predict', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { chainId?: unknown; owner?: unknown }
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* SmartAccountService
			const chainId = Number(body.chainId)
			const owner = String(body.owner ?? '')
			if (!Number.isInteger(chainId) || chainId <= 0) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'chainId must be a positive integer',
						fields: { chainId: 'required' },
					}),
				)
			}
			if (!isAddress(owner)) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'owner must be a valid EVM address',
						fields: { owner: 'invalid' },
					}),
				)
			}
			return yield* svc.predictAddress({ chainId, owner })
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left as Error)
		return c.json(errBody, status)
	}
	const r = result.right
	return c.json({
		chain_id: r.chainId,
		owner: r.owner,
		smart_account_address: r.smartAccountAddress,
		is_deployed: r.isDeployed,
	})
})
