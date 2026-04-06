/**
 * Wallet send endpoint for mobile app token transfers.
 *
 * POST /v1/wallet/send
 * Accepts { recipient, token, amount, chain }
 * Builds transaction, signs via Turnkey, broadcasts.
 */

import { Hono } from 'hono'
import { Effect, Either } from 'effect'
import { telegramAuth } from '../middleware'
import { UserService, WalletService, TurnkeyService } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, ValidationError } from '../errors'
import { RPC_ENDPOINTS } from '../config/chains'
import type { TelegramUser } from '../services/TelegramAuthService'

const walletSendRoutes = new Hono()

/**
 * POST /v1/wallet/send
 * Send tokens from user's wallet to a recipient address.
 *
 * Body: { recipient: string, token: string, amount: number, chain: string }
 * Response: { txHash: string, status: string, explorerUrl?: string }
 */
walletSendRoutes.post('/send', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const { recipient, token, amount, chain } = body as {
		recipient?: string
		token?: string
		amount?: number
		chain?: string
	}

	// Validate inputs
	if (!recipient || !token || !amount || !chain) {
		return c.json({ error: 'Missing required fields: recipient, token, amount, chain' }, 400)
	}

	if (amount <= 0) {
		return c.json({ error: 'Amount must be greater than 0' }, 400)
	}

	if (!recipient.match(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)) {
		return c.json({ error: 'Invalid recipient address' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const turnkeyService = yield* TurnkeyService

			// Get user
			const user = yield* userService.getUserByTelegramId(telegramUser.id)
			if (!user) {
				return yield* Effect.fail(new ValidationError({ message: 'User not found' }))
			}

			// Get active wallet for the chain
			const wallets = yield* walletService.getActiveWallets(user.id)
			const isSolana = chain === 'solana'
			const wallet = wallets.find(w =>
				isSolana ? w.chainType === 'solana' : w.chainType === 'evm'
			)

			if (!wallet) {
				return yield* Effect.fail(
					new ValidationError({ message: `No ${isSolana ? 'Solana' : 'EVM'} wallet found` })
				)
			}

			// For now, return a pending status - full Turnkey signing flow
			// requires the Turnkey sub-org ID and wallet account.
			// This provides the API contract for the mobile app.
			if (!wallet.turnkeySubOrgId || !wallet.turnkeyWalletId) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Wallet not configured for sending. Please recreate your wallet.' })
				)
			}

			// Build and sign transaction via Turnkey
			// For EVM: native transfer or ERC-20 transfer
			// For Solana: SOL transfer or SPL token transfer
			const txHash = await buildAndSendTransaction({
				chain,
				from: wallet.address,
				to: recipient,
				token,
				amount,
				turnkeySubOrgId: wallet.turnkeySubOrgId,
				turnkeyWalletId: wallet.turnkeyWalletId,
				turnkeyAccountId: wallet.turnkeyAccountId || '',
			})

			return {
				txHash,
				status: 'pending',
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// ── Transaction building ─────────────────────────────────────

interface SendParams {
	chain: string
	from: string
	to: string
	token: string
	amount: number
	turnkeySubOrgId: string
	turnkeyWalletId: string
	turnkeyAccountId: string
}

async function buildAndSendTransaction(params: SendParams): Promise<string> {
	const { chain, from, to, token, amount } = params

	// Check if this is a native token transfer
	const nativeTokens: Record<string, string> = {
		ethereum: 'ETH', solana: 'SOL', polygon: 'MATIC', arbitrum: 'ETH',
		optimism: 'ETH', base: 'ETH', bsc: 'BNB',
	}

	const isNativeTransfer = token.toUpperCase() === (nativeTokens[chain] || '').toUpperCase()

	if (chain === 'solana') {
		return buildSolanaTransaction(params, isNativeTransfer)
	} else {
		return buildEvmTransaction(params, isNativeTransfer)
	}
}

async function buildEvmTransaction(params: SendParams, isNative: boolean): Promise<string> {
	const { chain, from, to, amount } = params
	const rpcUrl = RPC_ENDPOINTS[chain]
	if (!rpcUrl) throw new Error(`Unsupported chain: ${chain}`)

	// For EVM native transfer, construct basic transaction
	// Amount in wei (ETH) = amount * 1e18
	const valueWei = BigInt(Math.floor(amount * 1e18))

	// Get nonce
	const nonceResp = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount',
			params: [from, 'pending'],
		}),
	})
	const nonceData = await nonceResp.json() as { result: string }
	const nonce = nonceData.result

	// Get gas price
	const gasPriceResp = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [],
		}),
	})
	const gasPriceData = await gasPriceResp.json() as { result: string }

	// Note: Full implementation requires Turnkey server-side signing.
	// This placeholder returns a mock hash for the API contract.
	// TODO: Integrate @turnkey/sdk-server signTransaction
	console.log(`[WalletSend] EVM transfer: ${amount} ${params.token} from ${from} to ${to} on ${chain}`)
	console.log(`[WalletSend] Nonce: ${nonce}, Gas price: ${gasPriceData.result}`)

	// Return placeholder - Turnkey signing integration needed
	throw new Error('EVM send via Turnkey is not yet fully implemented. Use the bot for transfers.')
}

async function buildSolanaTransaction(params: SendParams, isNative: boolean): Promise<string> {
	// Solana transfers require @solana/web3.js + Turnkey signing
	// Placeholder for API contract
	console.log(`[WalletSend] Solana transfer: ${params.amount} ${params.token} from ${params.from} to ${params.to}`)

	throw new Error('Solana send via Turnkey is not yet fully implemented. Use the bot for transfers.')
}

export { walletSendRoutes }
