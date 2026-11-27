/**
 * Pure QR payload codecs: PIX BR Code (EMV MPM + CRC16/CCITT-FALSE), VietQR (NAPAS, EMV MPM),
 * UPI intent URI. A scanned QR text becomes a payout request via `parseQr`.
 * Amounts are integer minor units of the rail currency (BRL/INR 2 decimals, VND 0).
 */
import type { Rail } from './rails'

export interface PayoutRequest {
	rail: Rail
	currency: string
	/** pix: Pix key; vietqr: `${bin}:${account}`; upi: VPA. */
	destination: string
	amountMinor: string | null
	payeeName: string | null
	reference: string | null
	/** pix only: the original BR code (copia e cola) for dynamic/ref'd payments. */
	brCode?: string
}

// ---------------------------------------------------------------- EMV TLV
export function crc16ccitt(s: string): string {
	let crc = 0xffff
	const buf = Buffer.from(s, 'utf8')
	for (const b of buf) {
		crc ^= b << 8
		for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
	}
	return crc.toString(16).toUpperCase().padStart(4, '0')
}

const tlv = (id: string, value: string): string => {
	if (value.length > 99) throw new Error(`EMV field ${id} too long`)
	return `${id}${String(value.length).padStart(2, '0')}${value}`
}

export function parseTlv(s: string): Array<{ id: string; value: string }> {
	const out: Array<{ id: string; value: string }> = []
	let i = 0
	while (i < s.length) {
		if (i + 4 > s.length) throw new Error('truncated EMV TLV')
		const id = s.slice(i, i + 2)
		const len = Number(s.slice(i + 2, i + 4))
		if (!Number.isInteger(len) || i + 4 + len > s.length) throw new Error('bad EMV TLV length')
		out.push({ id, value: s.slice(i + 4, i + 4 + len) })
		i += 4 + len
	}
	return out
}

const field = (tlvs: Array<{ id: string; value: string }>, id: string) => tlvs.find((t) => t.id === id)?.value

const withCrc = (body: string): string => {
	const pre = `${body}6304`
	return pre + crc16ccitt(pre)
}

const verifyCrc = (s: string): void => {
	if (s.length < 8 || s.slice(-8, -4) !== '6304') throw new Error('missing CRC field (63)')
	if (crc16ccitt(s.slice(0, -4)) !== s.slice(-4).toUpperCase()) throw new Error('CRC mismatch')
}

const ascii = (s: string, max: number): string =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\x20-\x7e]/g, '')
		.slice(0, max)

const fromMinorStr = (minor: string, decimals: number): string => {
	if (decimals === 0) return minor
	const p = minor.padStart(decimals + 1, '0')
	return `${p.slice(0, -decimals)}.${p.slice(-decimals)}`
}
const toMinorStr = (dec: string, decimals: number): string => {
	if (!/^\d+(\.\d+)?$/.test(dec)) throw new Error('bad amount')
	const [i = '0', f = ''] = dec.split('.')
	if (f.length > decimals) throw new Error('amount precision exceeds currency')
	return (BigInt(i + f.padEnd(decimals, '0'))).toString()
}

// ---------------------------------------------------------------- PIX
export interface PixInput {
	key: string
	merchantName: string
	merchantCity: string
	amountMinor?: string
	txid?: string
	description?: string
}

/** Static PIX BR Code (copia e cola) per the BCB Manual de Padrões para Iniciação do Pix. */
export function generatePixBrCode(i: PixInput): string {
	const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', i.key) + (i.description ? tlv('02', ascii(i.description, 40)) : '')
	const txid = i.txid ? i.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) : '***'
	let body = tlv('00', '01') + tlv('01', i.amountMinor ? '12' : '11') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986')
	if (i.amountMinor) body += tlv('54', fromMinorStr(i.amountMinor, 2))
	body += tlv('58', 'BR') + tlv('59', ascii(i.merchantName, 25)) + tlv('60', ascii(i.merchantCity, 15)) + tlv('62', tlv('05', txid || '***'))
	return withCrc(body)
}

export function parsePixBrCode(code: string): PayoutRequest {
	const s = code.trim()
	verifyCrc(s)
	const top = parseTlv(s.slice(0, -8))
	if (field(top, '00') !== '01') throw new Error('not an EMV MPM payload')
	if (field(top, '53') !== '986') throw new Error('not BRL (53 != 986)')
	const mai = parseTlv(field(top, '26') ?? '')
	if ((field(mai, '00') ?? '').toLowerCase() !== 'br.gov.bcb.pix') throw new Error('not a PIX BR code (26.00)')
	const key = field(mai, '01')
	const url = field(mai, '25') // dynamic PIX payload URL, no static key
	if (!key && !url) throw new Error('PIX code has neither key (26.01) nor payload url (26.25)')
	const amount = field(top, '54')
	const add = field(top, '62') ? parseTlv(field(top, '62') as string) : []
	return {
		rail: 'pix',
		currency: 'BRL',
		destination: key ?? (url as string),
		amountMinor: amount ? toMinorStr(amount, 2) : null,
		payeeName: field(top, '59') ?? null,
		reference: field(add, '05') ?? null,
		brCode: s,
	}
}

// ---------------------------------------------------------------- VietQR (NAPAS 247)
export interface VietQrInput {
	/** Acquirer BIN (6 digits, e.g. 970436 Vietcombank). */
	bin: string
	account: string
	amountMinor?: string
	purpose?: string
	merchantName?: string
}

export function generateVietQr(i: VietQrInput): string {
	if (!/^\d{6}$/.test(i.bin)) throw new Error('bin must be 6 digits')
	const consumer = tlv('00', i.bin) + tlv('01', i.account)
	const mai = tlv('00', 'A000000727') + tlv('01', consumer) + tlv('02', 'QRIBFTTA')
	let body = tlv('00', '01') + tlv('01', i.amountMinor ? '12' : '11') + tlv('38', mai) + tlv('53', '704')
	if (i.amountMinor) body += tlv('54', i.amountMinor)
	body += tlv('58', 'VN')
	if (i.merchantName) body += tlv('59', ascii(i.merchantName, 25))
	if (i.purpose) body += tlv('62', tlv('08', ascii(i.purpose, 25)))
	return withCrc(body)
}

export function parseVietQr(code: string): PayoutRequest {
	const s = code.trim()
	verifyCrc(s)
	const top = parseTlv(s.slice(0, -8))
	if (field(top, '53') !== '704') throw new Error('not VND (53 != 704)')
	const mai = parseTlv(field(top, '38') ?? '')
	if (field(mai, '00') !== 'A000000727') throw new Error('not a NAPAS VietQR (38.00)')
	if (field(mai, '02') && field(mai, '02') !== 'QRIBFTTA') throw new Error('VietQR service code is not account transfer (QRIBFTTA)')
	const consumer = parseTlv(field(mai, '01') ?? '')
	const bin = field(consumer, '00')
	const acct = field(consumer, '01')
	if (!bin || !acct) throw new Error('VietQR missing bin/account')
	const amount = field(top, '54')
	const add = field(top, '62') ? parseTlv(field(top, '62') as string) : []
	return {
		rail: 'vietqr',
		currency: 'VND',
		destination: `${bin}:${acct}`,
		amountMinor: amount ? toMinorStr(amount, 0) : null,
		payeeName: field(top, '59') ?? null,
		reference: field(add, '08') ?? null,
	}
}

// ---------------------------------------------------------------- UPI intent
export interface UpiInput {
	vpa: string
	payeeName?: string
	amountMinor?: string
	note?: string
	reference?: string
}

export function generateUpiUri(i: UpiInput): string {
	if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9]{2,64}$/.test(i.vpa)) throw new Error('invalid VPA')
	const q = new URLSearchParams()
	q.set('pa', i.vpa)
	if (i.payeeName) q.set('pn', i.payeeName)
	if (i.amountMinor) q.set('am', fromMinorStr(i.amountMinor, 2))
	q.set('cu', 'INR')
	if (i.note) q.set('tn', i.note)
	if (i.reference) q.set('tr', i.reference)
	return `upi://pay?${q.toString().replace(/\+/g, '%20')}`
}

export function parseUpiUri(uri: string): PayoutRequest {
	const u = new URL(uri.trim())
	if (u.protocol !== 'upi:' || u.hostname !== 'pay') throw new Error('not a upi://pay URI')
	const pa = u.searchParams.get('pa')
	if (!pa) throw new Error('UPI URI missing pa (VPA)')
	const cu = u.searchParams.get('cu') ?? 'INR'
	if (cu !== 'INR') throw new Error('UPI currency must be INR')
	const am = u.searchParams.get('am')
	return {
		rail: 'upi',
		currency: 'INR',
		destination: pa,
		amountMinor: am ? toMinorStr(am, 2) : null,
		payeeName: u.searchParams.get('pn'),
		reference: u.searchParams.get('tr') ?? u.searchParams.get('tn'),
	}
}

/** Detect + parse any supported QR text. Throws Error with a precise reason. */
export function parseQr(text: string): PayoutRequest {
	const t = text.trim()
	if (/^upi:\/\//i.test(t)) return parseUpiUri(t)
	if (t.startsWith('000201')) {
		const top = parseTlv(t.slice(0, -8))
		if (field(top, '38')) return parseVietQr(t)
		if (field(top, '26')) return parsePixBrCode(t)
		throw new Error('EMV QR is neither PIX (26) nor VietQR (38)')
	}
	throw new Error('unrecognised QR payload (expected PIX BR code, VietQR or upi:// URI)')
}
