/**
 * Rail registry. A rail stays listed even when no provider can serve it; a new
 * adapter that declares the rail in capabilities() lights it up (see router.ts).
 */
export const RAILS = ['ach', 'wire', 'fednow', 'sepa', 'spei', 'pix', 'upi', 'vietqr', 'bre_b', 'swift'] as const
export type Rail = (typeof RAILS)[number]

export interface RailInfo {
	rail: Rail
	country: string
	/** ISO currency the rail settles in (swift/wire: usd default, multi-currency for swift). */
	currency: string
	instant: boolean
	/** Decimals of the fiat currency (minor units). */
	decimals: number
}

export const RAIL_INFO: Record<Rail, RailInfo> = {
	ach: { rail: 'ach', country: 'US', currency: 'USD', instant: false, decimals: 2 },
	wire: { rail: 'wire', country: 'US', currency: 'USD', instant: false, decimals: 2 },
	fednow: { rail: 'fednow', country: 'US', currency: 'USD', instant: true, decimals: 2 },
	sepa: { rail: 'sepa', country: 'EU', currency: 'EUR', instant: false, decimals: 2 },
	spei: { rail: 'spei', country: 'MX', currency: 'MXN', instant: true, decimals: 2 },
	pix: { rail: 'pix', country: 'BR', currency: 'BRL', instant: true, decimals: 2 },
	upi: { rail: 'upi', country: 'IN', currency: 'INR', instant: true, decimals: 2 },
	vietqr: { rail: 'vietqr', country: 'VN', currency: 'VND', instant: true, decimals: 0 },
	bre_b: { rail: 'bre_b', country: 'CO', currency: 'COP', instant: true, decimals: 2 },
	swift: { rail: 'swift', country: 'INTL', currency: 'USD', instant: false, decimals: 2 },
}

export const isRail = (s: string): s is Rail => (RAILS as readonly string[]).includes(s)

/** Currency -> decimals for fiat amounts handled by ramps. Stablecoins use bank asset decimals. */
export const FIAT_DECIMALS: Record<string, number> = {
	USD: 2,
	EUR: 2,
	GBP: 2,
	MXN: 2,
	BRL: 2,
	COP: 2,
	INR: 2,
	VND: 0,
	NGN: 2,
}
