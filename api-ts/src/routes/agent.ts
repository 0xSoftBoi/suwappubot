import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { UserService, WalletService } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, ValidationError } from '../errors'

const agentRoutes = new Hono()

// POST /v1/agent/wallets - Create wallet for user
agentRoutes.post('/wallets', async (c) => {
	// In production, this would create a new wallet
	// For now, return a stub response
	return c.json(
		{
			message: 'Wallet creation endpoint - not yet implemented',
			note: 'This would integrate with the Python backend or Turnkey',
		},
		501
	)
})

// POST /v1/agent/execute - Execute natural language trading command
agentRoutes.post('/execute', async (c) => {
	let body: { user_id?: string; command?: string }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	const { user_id, command } = body

	if (!user_id || !command) {
		return c.json({ error: 'Missing required fields: user_id, command' }, 400)
	}

	const userId = Number(user_id)
	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user_id format' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(
					new ValidationError({ message: 'User not found' })
				)
			}

			const user = userOption.value

			// Get user's active wallets
			const wallets = yield* walletService.getActiveWallets(userId)

			if (wallets.length === 0) {
				return yield* Effect.fail(
					new ValidationError({ message: 'No active wallets found for user' })
				)
			}

			// Parse the command (simplified NLP)
			const lowerCommand = command.toLowerCase()

			// Detect swap intent
			const swapMatch = lowerCommand.match(
				/swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)(?:\s+on\s+(\w+))?/
			)

			if (swapMatch) {
				const [, amount, fromToken, toToken, chain] = swapMatch
				return {
					action: 'swap',
					status: 'parsed',
					parsed: {
						amount,
						fromToken: fromToken.toUpperCase(),
						toToken: toToken.toUpperCase(),
						chain: chain || 'ethereum',
					},
					message: `Parsed swap command: ${amount} ${fromToken.toUpperCase()} → ${toToken.toUpperCase()}`,
					note: 'Execution would be delegated to Python backend',
				}
			}

			// Detect balance check
			if (lowerCommand.includes('balance') || lowerCommand.includes('portfolio')) {
				return {
					action: 'balance',
					status: 'parsed',
					wallets: wallets.map((w) => ({
						address: w.address,
						chainType: w.chainType,
					})),
					message: 'Balance check requested',
				}
			}

			return {
				action: 'unknown',
				status: 'unrecognized',
				message: `Could not parse command: ${command}`,
				suggestions: [
					'swap 0.1 ETH to USDC on Base',
					'check balance',
					'show portfolio',
				],
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { agentRoutes }
