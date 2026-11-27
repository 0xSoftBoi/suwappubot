/**
 * ISO 20022-style serialisers for the bank-core connector. Pure functions, no I/O.
 *  - pain.001.001.09-shaped CustomerCreditTransferInitiation: JSON model <-> XML (parse + serialise, validated)
 *  - camt.053.001.08-shaped BankToCustomerStatement: JSON model -> XML
 * Amounts are decimal strings in XML and integer minor units in JSON. NOTE: the ISO XSD limits
 * ActiveCurrencyAndAmount to 5 fraction digits; 6-decimal stablecoins (USDC) are emitted with their
 * full 6 digits (lossless) and the stablecoin asset/chain travel in SplmtryData. Banks whose schema
 * validation enforces 5 digits must round on their side.
 */
import { bankErr } from './errors'

export interface CreditTransfer {
	endToEndId: string
	amountMinor: string
	/** ISO 4217 currency of the tracked fiat (USD, EUR ...). */
	currency: string
	decimals: number
	debtorAccountId: string
	creditorName: string
	/** Suwappu bank account id (acct_...) or 0x address (on-chain). */
	creditorAccountId: string
	asset?: string
	chain?: string
	remittanceInfo?: string
}
export interface CreditTransferBatch {
	messageId: string
	createdAt: string
	initiatingParty: string
	debtorName: string
	requestedExecutionDate: string
	transfers: CreditTransfer[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function minorToDecimal(minor: string, decimals: number): string {
	if (!/^\d+$/.test(minor)) throw bankErr('VALIDATION', `Invalid minor amount ${minor}`)
	const s = minor.padStart(decimals + 1, '0')
	const i = s.slice(0, s.length - decimals)
	const f = s.slice(s.length - decimals).replace(/0+$/, '')
	return f ? `${i}.${f}` : i
}
export function decimalToMinor(dec: string, decimals: number): string {
	const m = /^(\d{1,60})(?:\.(\d+))?$/.exec(dec.trim())
	if (!m) throw bankErr('VALIDATION', `Invalid decimal amount "${dec}"`)
	const f = m[2] ?? ''
	if (f.length > decimals) throw bankErr('VALIDATION', `Amount "${dec}" has more than ${decimals} fraction digits`)
	return (BigInt(m[1]! + f.padEnd(decimals, '0'))).toString()
}

const ID = /^[A-Za-z0-9\-+?/:().,' ]{1,35}$/

export function validateBatch(b: CreditTransferBatch): void {
	if (!b.messageId || b.messageId.length > 35) throw bankErr('VALIDATION', 'messageId required (max 35 chars)')
	if (Number.isNaN(Date.parse(b.createdAt))) throw bankErr('VALIDATION', 'createdAt must be an ISO date-time')
	if (!/^\d{4}-\d{2}-\d{2}$/.test(b.requestedExecutionDate)) throw bankErr('VALIDATION', 'requestedExecutionDate must be YYYY-MM-DD')
	if (!b.transfers.length) throw bankErr('VALIDATION', 'Batch has no transactions')
	const seen = new Set<string>()
	for (const t of b.transfers) {
		if (!ID.test(t.endToEndId)) throw bankErr('VALIDATION', `Invalid EndToEndId "${t.endToEndId}"`)
		if (seen.has(t.endToEndId)) throw bankErr('VALIDATION', `Duplicate EndToEndId ${t.endToEndId}`)
		seen.add(t.endToEndId)
		if (!/^[1-9]\d*$/.test(t.amountMinor)) throw bankErr('VALIDATION', `Transaction ${t.endToEndId}: amount must be positive`)
		if (!/^[A-Z]{3}$/.test(t.currency)) throw bankErr('VALIDATION', `Transaction ${t.endToEndId}: currency must be ISO 4217`)
		if (!t.debtorAccountId || !t.creditorAccountId) throw bankErr('VALIDATION', `Transaction ${t.endToEndId}: debtor and creditor account ids required`)
	}
}

export function serialisePain001(b: CreditTransferBatch): string {
	validateBatch(b)
	const ctrl = b.transfers.reduce((a, t) => a + BigInt(t.amountMinor), 0n)
	const dec = b.transfers[0]!.decimals
	const txs = b.transfers
		.map(
			(t) => `<CdtTrfTxInf><PmtId><EndToEndId>${esc(t.endToEndId)}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${t.currency}">${minorToDecimal(t.amountMinor, t.decimals)}</InstdAmt></Amt><Cdtr><Nm>${esc(t.creditorName)}</Nm></Cdtr><CdtrAcct><Id><Othr><Id>${esc(t.creditorAccountId)}</Id></Othr></Id></CdtrAcct>${t.remittanceInfo ? `<RmtInf><Ustrd>${esc(t.remittanceInfo)}</Ustrd></RmtInf>` : ''}${t.asset ? `<SplmtryData><Envlp><SuwappuAsset>${esc(t.asset)}</SuwappuAsset><SuwappuChain>${esc(t.chain ?? '')}</SuwappuChain><SuwappuDecimals>${t.decimals}</SuwappuDecimals><DbtrAcct>${esc(t.debtorAccountId)}</DbtrAcct></Envlp></SplmtryData>` : `<SplmtryData><Envlp><DbtrAcct>${esc(t.debtorAccountId)}</DbtrAcct></Envlp></SplmtryData>`}</CdtTrfTxInf>`,
		)
	// one PmtInf per debtor account
	const byDebtor = new Map<string, string[]>()
	b.transfers.forEach((t, i) => byDebtor.set(t.debtorAccountId, [...(byDebtor.get(t.debtorAccountId) ?? []), txs[i]!]))
	const pmt = [...byDebtor.entries()]
		.map(([acct, list], i) => `<PmtInf><PmtInfId>${esc(`${b.messageId}-${i + 1}`)}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${list.length}</NbOfTxs><ReqdExctnDt><Dt>${b.requestedExecutionDate}</Dt></ReqdExctnDt><Dbtr><Nm>${esc(b.debtorName)}</Nm></Dbtr><DbtrAcct><Id><Othr><Id>${esc(acct)}</Id></Othr></Id></DbtrAcct>${list.join('')}</PmtInf>`)
		.join('')
	return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><GrpHdr><MsgId>${esc(b.messageId)}</MsgId><CreDtTm>${esc(b.createdAt)}</CreDtTm><NbOfTxs>${b.transfers.length}</NbOfTxs><CtrlSum>${minorToDecimal(ctrl.toString(), dec)}</CtrlSum><InitgPty><Nm>${esc(b.initiatingParty)}</Nm></InitgPty></GrpHdr>${pmt}</CstmrCdtTrfInitn></Document>`
}

// ---- tiny XML reader (elements, attributes, text, entities; no DTD/PI processing)
interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }
export function parseXml(xml: string): XNode {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw bankErr('VALIDATION', 'DTD/entity declarations are not allowed')
	const src = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
	const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g
	const root: XNode = { name: '#root', attrs: {}, children: [], text: '' }
	const stack: XNode[] = [root]
	for (let m = re.exec(src); m; m = re.exec(src)) {
		const top = stack[stack.length - 1]!
		if (m[5] !== undefined) {
			top.text += unesc(m[5])
			continue
		}
		const [, close, rawName, attrStr, selfClose] = m
		const name = rawName!.replace(/^[\w.-]+:/, '')
		if (close) {
			if (top.name !== name) throw bankErr('VALIDATION', `Malformed XML: unexpected </${name}>`)
			stack.pop()
			continue
		}
		const attrs: Record<string, string> = {}
		for (const a of (attrStr ?? '').matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]!] = unesc(a[2]!)
		const n: XNode = { name, attrs, children: [], text: '' }
		top.children.push(n)
		if (!selfClose) stack.push(n)
	}
	if (stack.length !== 1) throw bankErr('VALIDATION', 'Malformed XML: unclosed element')
	const el = root.children[0]
	if (!el) throw bankErr('VALIDATION', 'Empty XML document')
	return el
}
const kid = (n: XNode, name: string) => n.children.find((c) => c.name === name)
const kids = (n: XNode, name: string) => n.children.filter((c) => c.name === name)
const path = (n: XNode | undefined, ...p: string[]): XNode | undefined => p.reduce<XNode | undefined>((a, s) => (a ? kid(a, s) : undefined), n)
const need = (n: XNode | undefined, ...p: string[]): string => {
	const v = path(n, ...p)?.text.trim()
	if (!v) throw bankErr('VALIDATION', `pain.001 missing element ${p.join('/')}`)
	return v
}

/** Parse + validate a pain.001 XML document into the JSON model. `decimalsFor` supplies asset decimals when SplmtryData is absent. */
export function parsePain001(xml: string, decimalsFor: (currency: string) => number = () => 6): CreditTransferBatch {
	const doc = parseXml(xml)
	const init = doc.name === 'Document' ? kid(doc, 'CstmrCdtTrfInitn') : undefined
	if (!init) throw bankErr('VALIDATION', 'Not a pain.001 document (missing Document/CstmrCdtTrfInitn)')
	const hdr = kid(init, 'GrpHdr')
	const transfers: CreditTransfer[] = []
	let debtorName = ''
	let execDate = ''
	for (const pi of kids(init, 'PmtInf')) {
		debtorName = need(pi, 'Dbtr', 'Nm')
		execDate = need(pi, 'ReqdExctnDt', 'Dt')
		const debtorAcct = need(pi, 'DbtrAcct', 'Id', 'Othr', 'Id')
		for (const tx of kids(pi, 'CdtTrfTxInf')) {
			const amt = path(tx, 'Amt', 'InstdAmt')
			if (!amt) throw bankErr('VALIDATION', 'pain.001 transaction missing Amt/InstdAmt')
			const env = path(tx, 'SplmtryData', 'Envlp')
			const currency = amt.attrs.Ccy ?? ''
			const decText = env ? kid(env, 'SuwappuDecimals')?.text.trim() : undefined
			const decimals = decText ? Number(decText) : decimalsFor(currency)
			transfers.push({
				endToEndId: need(tx, 'PmtId', 'EndToEndId'),
				amountMinor: decimalToMinor(amt.text, decimals),
				currency,
				decimals,
				debtorAccountId: (env ? kid(env, 'DbtrAcct')?.text.trim() : undefined) || debtorAcct,
				creditorName: need(tx, 'Cdtr', 'Nm'),
				creditorAccountId: need(tx, 'CdtrAcct', 'Id', 'Othr', 'Id'),
				...(env && kid(env, 'SuwappuAsset') ? { asset: kid(env, 'SuwappuAsset')!.text.trim(), chain: kid(env, 'SuwappuChain')?.text.trim() ?? '' } : {}),
				...(path(tx, 'RmtInf', 'Ustrd') ? { remittanceInfo: path(tx, 'RmtInf', 'Ustrd')!.text.trim() } : {}),
			})
		}
	}
	const batch: CreditTransferBatch = { messageId: need(hdr, 'MsgId'), createdAt: need(hdr, 'CreDtTm'), initiatingParty: need(hdr, 'InitgPty', 'Nm'), debtorName, requestedExecutionDate: execDate, transfers }
	validateBatch(batch)
	const nb = Number(need(hdr, 'NbOfTxs'))
	if (nb !== transfers.length) throw bankErr('VALIDATION', `GrpHdr/NbOfTxs ${nb} != ${transfers.length} transactions`)
	const decs = transfers[0]!.decimals
	const ctrl = decimalToMinor(need(hdr, 'CtrlSum'), decs)
	const sum = transfers.reduce((a, t) => a + BigInt(t.amountMinor) * 10n ** BigInt(decs - t.decimals), 0n)
	if (BigInt(ctrl) !== sum) throw bankErr('VALIDATION', `GrpHdr/CtrlSum ${ctrl} != sum of transactions ${sum}`)
	return batch
}

// ---- camt.053
export interface StatementEntry { reference: string; direction: 'credit' | 'debit'; amountMinor: string; bookedAt: string; phase: string; transferId: string; balanceAfterMinor: string | null }
export interface Statement {
	messageId: string
	createdAt: string
	accountId: string
	currency: string
	asset: string
	chain: string
	decimals: number
	from: string
	to: string
	openingMinor: string
	closingMinor: string
	entries: StatementEntry[]
}

export function serialiseCamt053(s: Statement): string {
	const amt = (m: string) => `<Amt Ccy="${s.currency}">${minorToDecimal(m.replace('-', ''), s.decimals)}</Amt>`
	const ind = (m: string) => `<CdtDbtInd>${m.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd>`
	const bal = (code: string, m: string, dt: string) => `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp>${amt(m)}${ind(m)}<Dt><DtTm>${esc(dt)}</DtTm></Dt></Bal>`
	const ntry = s.entries
		.map((e) => `<Ntry><NtryRef>${esc(e.reference)}</NtryRef>${amt(e.amountMinor)}<CdtDbtInd>${e.direction === 'credit' ? 'CRDT' : 'DBIT'}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><DtTm>${esc(e.bookedAt)}</DtTm></BookgDt><AcctSvcrRef>${esc(e.transferId)}</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>${esc(e.transferId)}</TxId></Refs><RmtInf><Ustrd>${esc(e.phase)}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`)
		.join('')
	return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>${esc(s.messageId)}</MsgId><CreDtTm>${esc(s.createdAt)}</CreDtTm></GrpHdr><Stmt><Id>${esc(s.messageId)}</Id><CreDtTm>${esc(s.createdAt)}</CreDtTm><FrToDt><FrDtTm>${esc(s.from)}</FrDtTm><ToDtTm>${esc(s.to)}</ToDtTm></FrToDt><Acct><Id><Othr><Id>${esc(s.accountId)}</Id></Othr></Id><Ccy>${s.currency}</Ccy><Svcr><FinInstnId><Nm>Suwappu Bank</Nm></FinInstnId></Svcr></Acct>${bal('OPBD', s.openingMinor, s.from)}${bal('CLBD', s.closingMinor, s.to)}${ntry}</Stmt></BkToCstmrStmt></Document>`
}
