/**
 * Suwappu Aqua app — ship / dock / quote / swap against 1inch Aqua.
 *
 * Uses @1inch/aqua-sdk (0.3.4) and @1inch/swap-vm-sdk (0.4.4) purely as
 * calldata encoders. Both SDKs make zero HTTP calls — everything is onchain.
 *
 * Sepolia note: the Aqua registry is canonical; for SwapVM use
 * SWAPVM_ROUTER_SEPOLIA (the previous router, the only one on Sepolia).
 */
import {
	AquaProtocolContract,
	Address as AquaAddress,
	HexString as AquaHex,
} from '@1inch/aqua-sdk'
import {
	SwapVMContract,
	Address as SvmAddress,
	HexString as SvmHex,
	Order,
	MakerTraits,
	TakerTraits,
	AquaProgramBuilder,
	instructions,
} from '@1inch/swap-vm-sdk'

const { ConcentrateGrowLiquidity2DArgs, FlatFeeArgs } = {
	ConcentrateGrowLiquidity2DArgs: instructions.concentrate.ConcentrateGrowLiquidity2DArgs,
	FlatFeeArgs: instructions.fee.FlatFeeArgs,
}
import { AQUA_REGISTRY, SWAPVM_ROUTER_SEPOLIA } from './addresses.js'

export interface CallTx {
	to: `0x${string}`
	data: `0x${string}`
	value: bigint
}

const aqua = new AquaProtocolContract(new AquaAddress(AQUA_REGISTRY))
const swapVM = new SwapVMContract(new SvmAddress(SWAPVM_ROUTER_SEPOLIA))

/**
 * Build a concentrated-liquidity XYC AMM program.
 * Prices are P = tokenGt/tokenLt in 1e18 fixed point.
 */
export function buildXycProgram(opts: {
	rawPriceMin: bigint
	rawPriceMax: bigint
	feeBps: number
	deadline: bigint
	salt: bigint
}) {
	return new AquaProgramBuilder()
		.xycSwapXD()
		.concentrateGrowLiquidity2D(
			ConcentrateGrowLiquidity2DArgs.fromRawPrices(opts.rawPriceMin, opts.rawPriceMax),
		)
		.flatFeeAmountInXD(FlatFeeArgs.fromBps(opts.feeBps))
		.deadline({ deadline: opts.deadline })
		.salt({ salt: opts.salt })
		.build()
}

/** Wrap a program in a maker order. */
export function buildOrder(maker: `0x${string}`, program: ReturnType<typeof buildXycProgram>) {
	return Order.new({
		maker: new SvmAddress(maker),
		program,
		traits: MakerTraits.default(),
	})
}

/** Encode ship(app, strategy, tokens, amounts). Returns tx + expected strategyHash. */
export function buildShip(params: {
	app: `0x${string}`
	order: ReturnType<typeof buildOrder>
	amountsAndTokens: { token: `0x${string}`; amount: bigint }[]
}): { tx: CallTx; strategyHash: string } {
	const strategy = new AquaHex(params.order.encode().toString())
	const call = aqua.ship({
		app: new AquaAddress(params.app),
		strategy,
		amountsAndTokens: params.amountsAndTokens.map((a) => ({
			token: new AquaAddress(a.token),
			amount: a.amount,
		})),
	})
	return {
		tx: { to: call.to as `0x${string}`, data: call.data as `0x${string}`, value: call.value },
		strategyHash: AquaProtocolContract.calculateStrategyHash(strategy).toString(),
	}
}

/** Encode dock(app, strategyHash, tokens). */
export function buildDock(params: {
	app: `0x${string}`
	strategyHash: `0x${string}`
	tokens: `0x${string}`[]
}): CallTx {
	const call = aqua.dock({
		app: new AquaAddress(params.app),
		strategyHash: new AquaHex(params.strategyHash),
		tokens: params.tokens.map((t) => new AquaAddress(t)),
	})
	return { to: call.to as `0x${string}`, data: call.data as `0x${string}`, value: call.value }
}

/** Encode SwapVM quote(order, tokenIn, tokenOut, amount, takerTraits). */
export function buildQuote(params: {
	order: ReturnType<typeof buildOrder>
	tokenIn: `0x${string}`
	tokenOut: `0x${string}`
	amount: bigint
}): CallTx {
	const call = swapVM.quote({
		order: params.order,
		tokenIn: new SvmAddress(params.tokenIn),
		tokenOut: new SvmAddress(params.tokenOut),
		amount: params.amount,
		takerTraits: TakerTraits.default(),
	})
	return { to: call.to as `0x${string}`, data: call.data as `0x${string}`, value: call.value }
}

/** Encode SwapVM swap(order, tokenIn, tokenOut, amount, takerTraits). */
export function buildSwap(params: {
	order: ReturnType<typeof buildOrder>
	tokenIn: `0x${string}`
	tokenOut: `0x${string}`
	amount: bigint
}): CallTx {
	const call = swapVM.swap({
		order: params.order,
		tokenIn: new SvmAddress(params.tokenIn),
		tokenOut: new SvmAddress(params.tokenOut),
		amount: params.amount,
		takerTraits: TakerTraits.default(),
	})
	return { to: call.to as `0x${string}`, data: call.data as `0x${string}`, value: call.value }
}

/** Decode a shipped order back from its onchain encoding. */
export function decodeOrder(encoded: `0x${string}`) {
	return Order.decode(new SvmHex(encoded))
}
