/**
 * Impersonation guardrails for tenant bots.
 *
 * Why this file exists, plainly: the product lets anyone stand up an
 * official-looking Telegram bot under a name of their choosing in about two
 * minutes. That is the same primitive currently being abused at scale — the
 * "Safeguard" verification bot is a live malware campaign that works precisely
 * because it imitates the verification bots crypto communities are trained to
 * trust, then asks victims to paste code that steals their session and wallet.
 *
 * We cannot stop someone writing that bot. We can decline to be the place they
 * host it, and we can refuse to hand them our infrastructure and our uptime.
 *
 * The design is deliberately conservative in one direction only:
 *
 * - **Blocking is narrow.** Only names that claim to BE a protected identity or
 *   a security/verification function are refused, because those are the ones
 *   that convert a name into a credential in a victim's mind. "Pepe Burn Bot"
 *   is fine. "USDC Verification" is not.
 * - **Refusals explain themselves.** A team hitting this by accident (a project
 *   genuinely called Guardian, say) gets told what triggered and what to change,
 *   rather than a generic 400. A guardrail people cannot understand becomes a
 *   guardrail people route around.
 * - **This is not a trademark system.** We are not adjudicating who owns a name.
 *   We are refusing the specific naming patterns that make a scam work.
 */

/** Names that assert a security/verification/support function.
 *
 * This is the pattern that does the damage. A bot called "Verify" is granted
 * authority by its name alone, and the whole attack is getting the victim to
 * follow instructions from something that sounds official. There is no
 * legitimate reason for a *community token bot* to be called this, so the
 * false-positive cost is low and the abuse it prevents is the exact live one. */
const AUTHORITY_TERMS = [
	'safeguard',
	'verify',
	'verification',
	'verifier',
	'authenticate',
	'authentication',
	'validator', // in this position: "OFFICIAL VALIDATOR", not a staking validator
	'security',
	'antibot',
	'anti-bot',
	'guardian',
	'moderator',
	'admin',
	'administrator',
	'support',
	'helpdesk',
	'customer service',
	'wallet connect',
	'walletconnect',
	'restore',
	'recovery',
	'migration',
	'airdrop claim',
	'claim portal',
	'kyc',
]

/** Identities a tenant bot must not present itself as.
 *
 * Impersonating any of these turns the bot into a phishing surface with our
 * uptime behind it. Includes us: a tenant bot calling itself "Suwappu Support"
 * would borrow trust we did not extend. */
const PROTECTED_IDENTITIES = [
	// Us.
	'suwappu',
	// Telegram itself — the highest-authority name in the room.
	'telegram',
	'tg support',
	// Major venues and issuers, the usual phishing targets.
	'binance',
	'coinbase',
	'kraken',
	'okx',
	'bybit',
	'bitget',
	'metamask',
	'phantom',
	'trust wallet',
	'ledger',
	'trezor',
	'uniswap',
	'pancakeswap',
	'jupiter',
	'hyperliquid',
	'tether',
	'usdt',
	'usdc',
	'circle',
	'opensea',
	'blur',
	'etherscan',
	'basescan',
	'solscan',
	'dexscreener',
	'coingecko',
	'coinmarketcap',
]

export type ImpersonationReason =
	| 'protected_identity'
	| 'authority_role'
	| 'unicode_spoofing'
	| 'empty'

export interface ImpersonationVerdict {
	allowed: boolean
	reason?: ImpersonationReason
	/** What the operator should be told. Written to be actionable. */
	message?: string
	/** The specific term that triggered it, for the audit log. */
	matched?: string
}

/**
 * Fold the confusable tricks a name can hide behind before matching.
 *
 * `Ѕafeguard` with a Cyrillic Ѕ, `Safe­guard` with a soft hyphen, and
 * `S a f e g u a r d` all read as the same word to a human being deciding
 * whether to trust a bot, so they have to read as the same word here. Matching
 * the raw string would let every one of them through.
 */
export function normalizeName(input: string): string {
	return (
		input
			.normalize('NFKD')
			// Strip combining marks left by the decomposition.
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			// Homoglyphs: Cyrillic and Greek letters that render as Latin ones.
			.replace(/[аӑ]/g, 'a')
			.replace(/[еёє]/g, 'e')
			.replace(/[оө]/g, 'o')
			.replace(/[рρ]/g, 'p')
			.replace(/[сϲ]/g, 'c')
			.replace(/[ѕ]/g, 's')
			.replace(/[іїi]/g, 'i')
			.replace(/[ху]/g, 'x')
			.replace(/[кκ]/g, 'k')
			.replace(/[мμ]/g, 'm')
			.replace(/[тτ]/g, 't')
			.replace(/[νv]/g, 'v')
			// Leetspeak, which is how most casual evasion is spelled.
			.replace(/0/g, 'o')
			.replace(/1/g, 'l')
			.replace(/3/g, 'e')
			.replace(/4/g, 'a')
			.replace(/5/g, 's')
			.replace(/7/g, 't')
			.replace(/\$/g, 's')
			// Zero-width and formatting characters used to split words invisibly.
			.replace(/[​-‏⁠﻿­]/g, '')
			// Everything that is not a letter or digit becomes a single space, so
			// "S-a-f-e_g u a r d" collapses toward the word it is imitating.
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
	)
}

/** The de-spaced form, which catches letter-by-letter spacing evasion. */
function squashed(normalized: string): string {
	return normalized.replace(/\s+/g, '')
}

/** True if a name is dominated by characters from a non-Latin script while
 *  still reading as Latin — a strong signal of deliberate spoofing rather than
 *  a genuinely non-English project name. */
function looksLikeScriptSpoof(raw: string): boolean {
	const latin = (raw.match(/[a-zA-Z]/g) ?? []).length
	const confusable = (raw.match(/[Ѐ-ӿͰ-Ͽ]/g) ?? []).length
	// Mixed scripts inside one name, with Latin dominant, is the spoof shape. A
	// wholly Cyrillic or Greek name is just a name in that language.
	return confusable > 0 && latin > 0 && confusable <= latin
}

/**
 * Decide whether a tenant may present a bot under this name.
 *
 * Checks the display name and, when given, the Telegram @handle — the handle is
 * what a victim actually sees in a forwarded message, so a clean display name
 * over a `@usdc_verify_bot` handle must still be refused.
 */
export function checkImpersonation(
	name: string,
	telegramUsername?: string | null,
): ImpersonationVerdict {
	const candidates = [name, telegramUsername ?? ''].filter((s) => s.trim().length > 0)
	if (candidates.length === 0) {
		return { allowed: false, reason: 'empty', message: 'A name is required.' }
	}

	for (const raw of candidates) {
		if (looksLikeScriptSpoof(raw)) {
			return {
				allowed: false,
				reason: 'unicode_spoofing',
				matched: raw,
				message:
					'That name mixes look-alike characters from another alphabet, which is how ' +
					'impersonation bots disguise themselves. Please use plain characters.',
			}
		}

		const norm = normalizeName(raw)
		const flat = squashed(norm)

		for (const identity of PROTECTED_IDENTITIES) {
			const target = squashed(identity)
			if (flat.includes(target)) {
				return {
					allowed: false,
					reason: 'protected_identity',
					matched: identity,
					message:
						`This bot can't be named after "${identity}". Bots that borrow a known ` +
						`name are the main way holders get phished, so we don't host them. ` +
						`Name it after your own project instead.`,
				}
			}
		}

		for (const term of AUTHORITY_TERMS) {
			const target = squashed(term)
			if (flat.includes(target)) {
				return {
					allowed: false,
					reason: 'authority_role',
					matched: term,
					message:
						`"${term}" isn't available in a bot name. Bots that sound like security, ` +
						`verification or support are being actively used to steal wallets, so we ` +
						`don't host them — and a community bot named this way gets reported. ` +
						`Try a name built on your token or project instead.`,
				}
			}
		}
	}

	return { allowed: true }
}

/**
 * Text a tenant bot may not send, regardless of its name.
 *
 * The name is only half the attack; the payload is an instruction to run code
 * or hand over a seed phrase. Branding fields are operator-supplied and get
 * broadcast to a whole community by us, so they are checked too.
 */
const SCAM_PAYLOAD_PATTERNS: [RegExp, string][] = [
	[/seed\s*phrase|recovery\s*phrase|mnemonic|private\s*key/i, 'asks for wallet secrets'],
	[/\b(powershell|cmd\.exe|iex\s*\(|curl\s+[^\s]+\s*\|\s*(ba)?sh)\b/i, 'asks the reader to run code'],
	[/win\s*\+\s*r|press\s+windows\s*\+\s*r/i, 'walks the reader through the Windows Run dialog'],
	[/verify\s+your\s+(wallet|identity|account)/i, 'imitates a verification flow'],
	[/connect\s+your\s+wallet\s+to\s+(claim|verify|restore)/i, 'imitates a wallet-drainer prompt'],
]

/** Screen operator-authored copy before we broadcast it for them. */
export function checkBroadcastCopy(text: string): ImpersonationVerdict {
	for (const [pattern, why] of SCAM_PAYLOAD_PATTERNS) {
		if (pattern.test(text)) {
			return {
				allowed: false,
				reason: 'authority_role',
				matched: pattern.source,
				message: `We can't send that — the wording ${why}, which is the shape of a wallet-drainer message.`,
			}
		}
	}
	return { allowed: true }
}
