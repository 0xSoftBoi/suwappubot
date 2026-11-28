/**
 * Open payment-request URIs (pure functions): EIP-681 (EVM) and Solana Pay, plus the QR payload string.
 * Amounts are integer minor units; Solana Pay carries decimal user units so `decimals` is required there.
 */

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/

export interface Eip681Request {
	kind: 'erc20' | 'native'
	/** ERC-20 contract (erc20) or recipient (native). */
	target: string
	chainId?: number | undefined
	recipient: string
	/** Token base units (erc20) or wei (native). */
	amountMinor?: bigint | undefined
}

/** Parse an EIP-681 number: integer, or `1.5e18` style scientific notation, into an exact bigint. */
export function parseEip681Number(s: string): bigint {
	const m = /^(\d+)(?:\.(\d+))?(?:[eE]\+?(\d+))?$/.exec(s)
	if (!m) throw new Error(`invalid EIP-681 number: ${s}`)
	const frac = m[2] ?? ''
	const exp = Number(m[3] ?? '0')
	if (exp < frac.length) throw new Error(`EIP-681 number has sub-unit precision: ${s}`)
	return BigInt(m[1]! + frac) * 10n ** BigInt(exp - frac.length)
}

export function buildEip681Erc20(p: { tokenAddress: string; chainId: number; recipient: string; amountMinor: bigint }): string {
	if (!EVM_ADDR.test(p.tokenAddress) || !EVM_ADDR.test(p.recipient)) throw new Error('invalid EVM address')
	if (p.amountMinor <= 0n) throw new Error('amount must be positive')
	return `ethereum:${p.tokenAddress}@${p.chainId}/transfer?address=${p.recipient}&uint256=${p.amountMinor.toString()}`
}

export function buildEip681Native(p: { recipient: string; chainId: number; valueWei: bigint }): string {
	if (!EVM_ADDR.test(p.recipient)) throw new Error('invalid EVM address')
	return `ethereum:${p.recipient}@${p.chainId}?value=${p.valueWei.toString()}`
}

export function parseEip681(uri: string): Eip681Request {
	const m = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([A-Za-z0-9_]+))?(?:\?(.*))?$/.exec(uri.trim())
	if (!m) throw new Error('not an EIP-681 URI with a 0x address target')
	const [, target, chain, fn, query] = m
	const q = new URLSearchParams(query ?? '')
	const chainId = chain ? Number(chain) : undefined
	if (fn === 'transfer') {
		const address = q.get('address')
		const amt = q.get('uint256')
		if (!address || !EVM_ADDR.test(address)) throw new Error('transfer URI missing a valid address parameter')
		return { kind: 'erc20', target: target!, chainId, recipient: address, amountMinor: amt ? parseEip681Number(amt) : undefined }
	}
	if (fn) throw new Error(`unsupported EIP-681 function: ${fn}`)
	const value = q.get('value')
	return { kind: 'native', target: target!, chainId, recipient: target!, amountMinor: value ? parseEip681Number(value) : undefined }
}

export interface SolanaPayRequest {
	recipient: string
	/** Decimal user units as carried on the wire. */
	amount?: string | undefined
	splToken?: string | undefined
	reference?: string[] | undefined
	label?: string | undefined
	message?: string | undefined
	memo?: string | undefined
}

export function minorToDecimal(minor: bigint, decimals: number): string {
	if (minor < 0n) throw new Error('negative amount')
	const s = minor.toString().padStart(decimals + 1, '0')
	const whole = s.slice(0, s.length - decimals)
	const frac = s.slice(s.length - decimals).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}

export function decimalToMinor(dec: string, decimals: number): bigint {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(dec)
	if (!m) throw new Error(`invalid decimal amount: ${dec}`)
	const frac = m[2] ?? ''
	if (frac.length > decimals) throw new Error(`amount has more than ${decimals} decimals`)
	return BigInt(m[1]! + frac.padEnd(decimals, '0'))
}

export function buildSolanaPay(p: { recipient: string; amountMinor: bigint; decimals: number; splToken?: string; reference?: string; label?: string; message?: string; memo?: string }): string {
	const q = new URLSearchParams()
	q.set('amount', minorToDecimal(p.amountMinor, p.decimals))
	if (p.splToken) q.set('spl-token', p.splToken)
	if (p.reference) q.set('reference', p.reference)
	if (p.label) q.set('label', p.label)
	if (p.message) q.set('message', p.message)
	if (p.memo) q.set('memo', p.memo)
	return `solana:${p.recipient}?${q.toString()}`
}

export function parseSolanaPay(uri: string): SolanaPayRequest {
	const m = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?(.*))?$/.exec(uri.trim())
	if (!m) throw new Error('not a Solana Pay transfer URI')
	const q = new URLSearchParams(m[2] ?? '')
	const refs = q.getAll('reference')
	return {
		recipient: m[1]!,
		amount: q.get('amount') ?? undefined,
		splToken: q.get('spl-token') ?? undefined,
		reference: refs.length ? refs : undefined,
		label: q.get('label') ?? undefined,
		message: q.get('message') ?? undefined,
		memo: q.get('memo') ?? undefined,
	}
}

/** The string a QR encoder should render for a payment request (the URI itself, per both standards). */
export const qrPayload = (uri: string): string => uri
