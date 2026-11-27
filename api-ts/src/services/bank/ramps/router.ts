/**
 * Local-fiat liquidity router. bestQuote asks every configured provider that supports the rail,
 * ranks by net received (fees + fx are already inside receiveAmountMinor) and returns ALL quotes.
 */
import { RAILS, type Rail } from './rails'
import { RampError, type ProviderId, type RampProvider, type RampQuote, type RampQuoteRequest } from './RampProvider'

export interface RailSupportRow {
	rail: Rail
	sourceProviders: ProviderId[]
	destinationProviders: ProviderId[]
	/** Providers that would serve it but lack credentials, with the missing env var. */
	unconfigured: Array<{ provider: ProviderId; missing: string }>
}

export function railRegistry(providers: RampProvider[]): RailSupportRow[] {
	return RAILS.map((rail) => {
		const row: RailSupportRow = { rail, sourceProviders: [], destinationProviders: [], unconfigured: [] }
		for (const p of providers) {
			const caps = p.capabilities()
			const missing = p.missingConfig()
			const src = caps.source.includes(rail)
			const dst = caps.destination.includes(rail)
			if (!src && !dst) continue
			if (missing) {
				row.unconfigured.push({ provider: p.id, missing })
				continue
			}
			if (src) row.sourceProviders.push(p.id)
			if (dst) row.destinationProviders.push(p.id)
		}
		return row
	})
}

export interface RoutedQuotes {
	best: RampQuote
	quotes: RampQuote[]
	/** Providers that were asked but failed, with typed reason (never silently dropped). */
	failures: Array<{ provider: ProviderId; error: string }>
}

export async function bestQuote(providers: RampProvider[], direction: 'offramp' | 'onramp', q: RampQuoteRequest): Promise<RoutedQuotes> {
	const rail = direction === 'offramp' ? q.destRail : q.sourceRail
	if (rail === 'crypto') throw new RampError('VALIDATION', 'a fiat rail is required')
	const capable = providers.filter((p) => {
		const c = p.capabilities()
		return (direction === 'offramp' ? c.destination : c.source).includes(rail)
	})
	if (capable.length === 0) {
		throw new RampError('RAIL_NO_PROVIDER', `no provider supports ${rail} as ${direction === 'offramp' ? 'payout destination' : 'deposit source'}`)
	}
	const configured = capable.filter((p) => !p.missingConfig())
	if (configured.length === 0) {
		const m = capable.map((p) => p.missingConfig()).join(', ')
		throw new RampError('PROVIDER_NOT_CONFIGURED', m, { missing: m })
	}
	const settled = await Promise.allSettled(configured.map((p) => (direction === 'offramp' ? p.quoteOfframp(q) : p.quoteOnramp(q))))
	const quotes: RampQuote[] = []
	const failures: RoutedQuotes['failures'] = []
	settled.forEach((s, i) => {
		const id = configured[i]!.id
		if (s.status === 'fulfilled') quotes.push(s.value)
		else failures.push({ provider: id, error: s.reason instanceof Error ? s.reason.message : String(s.reason) })
	})
	if (quotes.length === 0) {
		const first = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined
		throw first?.reason instanceof RampError ? first.reason : new RampError('UPSTREAM', `all providers failed: ${failures.map((f) => f.error).join('; ')}`)
	}
	quotes.sort((a, b) => (BigInt(b.receiveAmountMinor) > BigInt(a.receiveAmountMinor) ? 1 : BigInt(b.receiveAmountMinor) < BigInt(a.receiveAmountMinor) ? -1 : 0))
	return { best: quotes[0]!, quotes, failures }
}
