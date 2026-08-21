import { http, type Address, createPublicClient, getAddress, isAddress, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'
import { Hono } from 'hono'

/**
 * Read-only HTTP surface over the immutable Suwappu on-chain primitives
 * (TimeCurve / AmortizingVault / MutualCredit) deployed on Base Sepolia.
 *
 * Self-contained (ABIs + addresses inlined) so it builds in the api-ts Docker
 * context without the sibling @suwappu/primitives-client package. Mirror of that
 * client's read surface. Testnet only — unaudited immutable contracts.
 */

const RPC = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'

const ADDR = {
	chainId: baseSepolia.id,
	timeCurve: '0x13189B1fae4f7CBCfF12bb57fBB6fEF83abe1B5C' as Address,
	amortizingVault: '0x07Bc798F3f6D9a5C672C209CaBe69289AF19d8DA' as Address,
	mutualCredit: '0x3938B15649129B21f53dB20D58F9084366a5570b' as Address,
	reserveAsset: '0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8' as Address,
	collateralVault: '0xF459a90B2aEA6a8Dc8e98a2fd9c41CD7Fef678b4' as Address,
}

const curveAbi = parseAbi([
	'function name() view returns (string)',
	'function symbol() view returns (string)',
	'function decimals() view returns (uint8)',
	'function totalSupply() view returns (uint256)',
	'function reserve() view returns (address)',
	'function basePrice() view returns (uint256)',
	'function slope() view returns (uint256)',
	'function rate() view returns (int256)',
	'function sinkRate() view returns (uint256)',
	'function totalSunk() view returns (uint256)',
	'function reserveBalance() view returns (uint256)',
	'function spotPrice() view returns (uint256)',
	'function multiplier() view returns (uint256)',
	'function quoteBuy(uint256) view returns (uint256)',
	'function quoteSell(uint256) view returns (uint256)',
])

const vaultAbi = parseAbi([
	'function asset() view returns (address)',
	'function collateralVault() view returns (address)',
	'function borrowRate() view returns (uint256)',
	'function maxLtv() view returns (uint256)',
	'function liqLtv() view returns (uint256)',
	'function liqBonus() view returns (uint256)',
	'function cash() view returns (uint256)',
	'function poolAssets() view returns (uint256)',
	'function totalDebtAssets() view returns (uint256)',
	'function nextPositionId() view returns (uint256)',
	'function positions(uint256) view returns (address owner, uint256 shares, uint256 baselineAssets, uint256 debtScaled)',
	'function debtOf(uint256) view returns (uint256)',
	'function pendingYield(uint256) view returns (uint256)',
])

const creditAbi = parseAbi([
	'function owedBy(address debtor, address creditor, address token) view returns (uint256)',
	'function lineKey(address x, address y, address token) view returns (bytes32)',
	'function defaults(address) view returns (uint256)',
])

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) })

/** Recursively stringify bigints so Hono's JSON serializer accepts the payload. */
function jsonSafe<T>(value: T): unknown {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(jsonSafe)
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]))
	}
	return value
}

const primitivesRoutes = new Hono()

// Wrap a handler so RPC failures surface as 502 rather than a 500 stack.
async function guard(fn: () => Promise<unknown>) {
	try {
		return { ok: true as const, data: await fn() }
	} catch (err) {
		return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
	}
}

primitivesRoutes.get('/', (c) =>
	c.json({
		network: 'base-sepolia',
		chainId: ADDR.chainId,
		note: 'Read-only view over immutable Suwappu primitives. Testnet only; unaudited.',
		addresses: {
			timeCurve: ADDR.timeCurve,
			amortizingVault: ADDR.amortizingVault,
			mutualCredit: ADDR.mutualCredit,
			reserveAsset: ADDR.reserveAsset,
			collateralVault: ADDR.collateralVault,
		},
		endpoints: [
			'GET /v1/primitives/curve',
			'GET /v1/primitives/curve/quote?side=buy|sell&amount=<wei>',
			'GET /v1/primitives/vault',
			'GET /v1/primitives/vault/position/:id',
			'GET /v1/primitives/credit/owed?debtor=&creditor=&token=',
		],
	}),
)

primitivesRoutes.get('/curve', async (c) => {
	const r = await guard(async () => {
		const a = { address: ADDR.timeCurve, abi: curveAbi } as const
		const [name, symbol, decimals, totalSupply, spot, mult, reserveBalance, totalSunk, basePrice, slope, rate, sinkRate, reserve] =
			await Promise.all([
				client.readContract({ ...a, functionName: 'name' }),
				client.readContract({ ...a, functionName: 'symbol' }),
				client.readContract({ ...a, functionName: 'decimals' }),
				client.readContract({ ...a, functionName: 'totalSupply' }),
				client.readContract({ ...a, functionName: 'spotPrice' }),
				client.readContract({ ...a, functionName: 'multiplier' }),
				client.readContract({ ...a, functionName: 'reserveBalance' }),
				client.readContract({ ...a, functionName: 'totalSunk' }),
				client.readContract({ ...a, functionName: 'basePrice' }),
				client.readContract({ ...a, functionName: 'slope' }),
				client.readContract({ ...a, functionName: 'rate' }),
				client.readContract({ ...a, functionName: 'sinkRate' }),
				client.readContract({ ...a, functionName: 'reserve' }),
			])
		return {
			address: ADDR.timeCurve,
			name,
			symbol,
			decimals,
			totalSupply,
			spotPrice: spot,
			multiplier: mult,
			reserveBalance,
			totalSunk,
			reserve,
			params: { basePrice, slope, rate, sinkRate },
		}
	})
	return r.ok ? c.json(jsonSafe(r.data) as object) : c.json({ error: r.message }, 502)
})

primitivesRoutes.get('/curve/quote', async (c) => {
	const side = c.req.query('side')
	const amountRaw = c.req.query('amount')
	if (side !== 'buy' && side !== 'sell') return c.json({ error: "side must be 'buy' or 'sell'" }, 400)
	let amount: bigint
	try {
		amount = BigInt(amountRaw ?? '')
		if (amount <= 0n) throw new Error('non-positive')
	} catch {
		return c.json({ error: 'amount must be a positive integer (wei)' }, 400)
	}
	const r = await guard(async () => {
		const quote = await client.readContract({
			address: ADDR.timeCurve,
			abi: curveAbi,
			functionName: side === 'buy' ? 'quoteBuy' : 'quoteSell',
			args: [amount],
		})
		return { side, amount, quote }
	})
	return r.ok ? c.json(jsonSafe(r.data) as object) : c.json({ error: r.message }, 502)
})

primitivesRoutes.get('/vault', async (c) => {
	const r = await guard(async () => {
		const a = { address: ADDR.amortizingVault, abi: vaultAbi } as const
		const [asset, collateralVault, borrowRate, maxLtv, liqLtv, liqBonus, cash, poolAssets, totalDebtAssets, nextPositionId] =
			await Promise.all([
				client.readContract({ ...a, functionName: 'asset' }),
				client.readContract({ ...a, functionName: 'collateralVault' }),
				client.readContract({ ...a, functionName: 'borrowRate' }),
				client.readContract({ ...a, functionName: 'maxLtv' }),
				client.readContract({ ...a, functionName: 'liqLtv' }),
				client.readContract({ ...a, functionName: 'liqBonus' }),
				client.readContract({ ...a, functionName: 'cash' }),
				client.readContract({ ...a, functionName: 'poolAssets' }),
				client.readContract({ ...a, functionName: 'totalDebtAssets' }),
				client.readContract({ ...a, functionName: 'nextPositionId' }),
			])
		return {
			address: ADDR.amortizingVault,
			asset,
			collateralVault,
			params: { borrowRate, maxLtv, liqLtv, liqBonus },
			cash,
			poolAssets,
			totalDebtAssets,
			nextPositionId,
		}
	})
	return r.ok ? c.json(jsonSafe(r.data) as object) : c.json({ error: r.message }, 502)
})

primitivesRoutes.get('/vault/position/:id', async (c) => {
	let id: bigint
	try {
		id = BigInt(c.req.param('id'))
		if (id < 0n) throw new Error('negative')
	} catch {
		return c.json({ error: 'id must be a non-negative integer' }, 400)
	}
	const r = await guard(async () => {
		const a = { address: ADDR.amortizingVault, abi: vaultAbi } as const
		const [pos, debt, pending] = await Promise.all([
			client.readContract({ ...a, functionName: 'positions', args: [id] }),
			client.readContract({ ...a, functionName: 'debtOf', args: [id] }),
			client.readContract({ ...a, functionName: 'pendingYield', args: [id] }),
		])
		const [owner, shares, baselineAssets, debtScaled] = pos as readonly [Address, bigint, bigint, bigint]
		return { id, owner, shares, baselineAssets, debtScaled, debt, pendingYield: pending }
	})
	return r.ok ? c.json(jsonSafe(r.data) as object) : c.json({ error: r.message }, 502)
})

primitivesRoutes.get('/credit/owed', async (c) => {
	const debtor = c.req.query('debtor')
	const creditor = c.req.query('creditor')
	const token = c.req.query('token') ?? ADDR.reserveAsset
	if (!debtor || !isAddress(debtor)) return c.json({ error: 'debtor must be a valid address' }, 400)
	if (!creditor || !isAddress(creditor)) return c.json({ error: 'creditor must be a valid address' }, 400)
	if (!isAddress(token)) return c.json({ error: 'token must be a valid address' }, 400)
	const r = await guard(async () => {
		const a = { address: ADDR.mutualCredit, abi: creditAbi } as const
		const [owed, lineKey] = await Promise.all([
			client.readContract({ ...a, functionName: 'owedBy', args: [getAddress(debtor), getAddress(creditor), getAddress(token)] }),
			client.readContract({ ...a, functionName: 'lineKey', args: [getAddress(debtor), getAddress(creditor), getAddress(token)] }),
		])
		return { debtor: getAddress(debtor), creditor: getAddress(creditor), token: getAddress(token), owed, lineKey }
	})
	return r.ok ? c.json(jsonSafe(r.data) as object) : c.json({ error: r.message }, 502)
})

export { primitivesRoutes }
