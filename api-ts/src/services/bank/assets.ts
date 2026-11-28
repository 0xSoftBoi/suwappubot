/**
 * Supported bank assets. Every address/decimals pair below was verified on-chain
 * (decimals()/symbol() via eth_call, or getTokenSupply on Solana) on 2026-11-27,
 * or comes from the repo registry (bot/config/tokens.py, config/tokenRegistry.ts)
 * and was then re-verified. Unverifiable assets are deliberately absent.
 */
import { CHAIN_ID_TO_KEY } from '../../config/chains'

export type ChainFamily = 'evm' | 'solana'

export interface BankAsset {
	symbol: string
	chain: string
	family: ChainFamily
	/** EVM chain id (null on Solana). */
	chainId: number | null
	/** ERC-20 contract or SPL mint. */
	address: string
	decimals: number
	/** ISO fiat currency the stablecoin tracks. */
	currency: string
	name: string
}

const chainId = (key: string): number => {
	const e = Object.entries(CHAIN_ID_TO_KEY).find(([, v]) => v === key)
	if (!e) throw new Error(`unknown chain key ${key}`)
	return Number(e[0])
}

const evm = (
	symbol: string,
	chain: string,
	address: string,
	decimals: number,
	currency: string,
	name: string,
): BankAsset => ({ symbol, chain, family: 'evm', chainId: chainId(chain), address, decimals, currency, name })

const sol = (symbol: string, address: string, decimals: number, currency: string, name: string): BankAsset => ({
	symbol,
	chain: 'solana',
	family: 'solana',
	chainId: null,
	address,
	decimals,
	currency,
	name,
})

export const BANK_ASSETS: readonly BankAsset[] = [
	evm('USDC', 'ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'USD', 'USD Coin'),
	evm('USDC', 'base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USD', 'USD Coin'),
	evm('USDC', 'polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'USD', 'USD Coin'),
	evm('USDC', 'arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'USD', 'USD Coin'),
	evm('USDC', 'optimism', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'USD', 'USD Coin'),
	evm('USDT', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'USD', 'Tether USD'),
	evm('USDT', 'base', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6, 'USD', 'Tether USD'),
	// On-chain symbol is USD₮0 (USDT0 omnichain Tether) on Arbitrum / USDT0 on Polygon.
	evm('USDT', 'arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, 'USD', 'USDT0'),
	evm('USDT', 'polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, 'USD', 'USDT0'),
	evm('EURC', 'ethereum', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 6, 'EUR', 'Euro Coin'),
	evm('EURC', 'base', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 6, 'EUR', 'Euro Coin'),
	evm('BRZ', 'polygon', '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc', 18, 'BRL', 'BRZ Token'),
	evm('BRZ', 'base', '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', 18, 'BRL', 'BRZ Token'),
	evm('XSGD', 'polygon', '0xDC3326e71D45186F113a2F448984CA0e8D201995', 6, 'SGD', 'XSGD'),
	evm('XSGD', 'ethereum', '0x70e8dE73cE538DA2bEEd35d14187F6959a8ecA96', 6, 'SGD', 'XSGD'),
	evm('MXNB', 'arbitrum', '0xF197FFC28c23E0309B5559e7a166f2c6164C80aA', 6, 'MXN', 'MXNB'),
	evm('JPYC', 'ethereum', '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29', 18, 'JPY', 'JPY Coin'),
	sol('USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 'USD', 'USD Coin'),
	sol('USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6, 'USD', 'Tether USD'),
	sol('EURC', 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', 6, 'EUR', 'Euro Coin'),
]

export function findAsset(symbol: string, chain: string): BankAsset | undefined {
	const s = symbol.toUpperCase()
	const c = chain.toLowerCase()
	return BANK_ASSETS.find((a) => a.symbol === s && a.chain === c)
}

export function listAssets(filter?: { chain?: string; currency?: string }): BankAsset[] {
	return BANK_ASSETS.filter(
		(a) =>
			(!filter?.chain || a.chain === filter.chain.toLowerCase()) &&
			(!filter?.currency || a.currency === filter.currency.toUpperCase()),
	)
}

/** Parse a decimal string ("12.5") into integer minor units. Rejects excess precision. */
export function toMinor(human: string, decimals: number): bigint {
	if (!/^\d+(\.\d+)?$/.test(human)) throw new Error('amount must be a non-negative decimal string')
	const [i = '0', f = ''] = human.split('.')
	if (f.length > decimals) throw new Error(`amount has more than ${decimals} decimal places`)
	return BigInt(i + f.padEnd(decimals, '0'))
}

export function fromMinor(minor: bigint, decimals: number): string {
	const neg = minor < 0n
	const s = (neg ? -minor : minor).toString().padStart(decimals + 1, '0')
	const i = s.slice(0, s.length - decimals)
	const f = s.slice(s.length - decimals).replace(/0+$/, '')
	return `${neg ? '-' : ''}${i}${f ? `.${f}` : ''}`
}
