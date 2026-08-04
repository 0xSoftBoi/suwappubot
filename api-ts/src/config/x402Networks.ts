/**
 * x402 payment-network registry.
 *
 * The 402 challenge advertises one `accepts[]` entry per enabled network. Before
 * this registry existed the challenge hardcoded a single network plus USDC's
 * EIP-712 domain (`{ name: 'USD Coin', version: '2' }`), which silently produced
 * unsignable payloads on any chain whose asset is not USDC.
 *
 * Each entry carries the EIP-712 domain the client needs to sign an EIP-3009
 * `transferWithAuthorization`. Getting `name`/`version` wrong yields a signature
 * that recovers to the wrong address and fails settlement, so every domain here
 * must be verified against the asset's on-chain DOMAIN_SEPARATOR — not guessed
 * and not read from `version()` (some tokens, incl. USDG, revert on it).
 *
 * MONEY-PATH: adding a network here makes the API accept payment on it. Only add
 * assets that (a) implement EIP-3009, (b) are 6-decimal (see `assetDecimals`),
 * and (c) are verifiable by the internal Python verifier
 * (bot/services/x402_service.py `payment_tokens`) — the CDP hosted facilitator
 * covers only Base/Polygon/Arbitrum/World/Solana.
 */

export type X402Network = {
	/** x402 `network` identifier used in the challenge and in X-PAYMENT payloads. */
	network: string
	/** Numeric EVM chain id — used for the EIP-712 domain and for verification routing. */
	chainId: number
	/** Payment asset (ERC-20) address. */
	asset: string
	/** Human label for logs/docs. */
	assetSymbol: string
	/**
	 * Asset decimals. The credit->base-unit helper (creditsToUsdcBaseUnits)
	 * assumes 6. A non-6 asset would misprice every challenge, so this is
	 * asserted at module load rather than left as a latent trap.
	 */
	assetDecimals: number
	/** EIP-712 domain for EIP-3009 signing. Verified against DOMAIN_SEPARATOR. */
	eip712: { name: string; version: string }
}

export const BASE_USDC: X402Network = {
	network: 'base',
	chainId: 8453,
	asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	assetSymbol: 'USDC',
	assetDecimals: 6,
	eip712: { name: 'USD Coin', version: '2' },
}

/**
 * Robinhood Chain (Arbitrum Orbit L2, chain 4663).
 *
 * There is no USDC on this chain — Paxos USDG ("Global Dollar") is the anchor.
 * Verified live on 2026-08-04:
 *   - `authorizationState(address,bytes32)` responds => EIP-3009 supported
 *   - `decimals()` == 6
 *   - `version()` REVERTS, so the EIP-712 version was derived by brute-forcing
 *     the domain against the on-chain DOMAIN_SEPARATOR
 *     (0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036);
 *     name="Global Dollar", version="1" is an exact match.
 * Note there are two contracts on 4663 reporting symbol USDG; this is the one
 * with real supply (338.7M vs 1.1k).
 */
export const ROBINHOOD_USDG: X402Network = {
	network: 'robinhood',
	chainId: 4663,
	asset: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
	assetSymbol: 'USDG',
	assetDecimals: 6,
	eip712: { name: 'Global Dollar', version: '1' },
}

/** Every network the registry knows about, keyed by x402 network id. */
export const X402_NETWORKS: Record<string, X402Network> = {
	[BASE_USDC.network]: BASE_USDC,
	[ROBINHOOD_USDG.network]: ROBINHOOD_USDG,
}

// creditsToUsdcBaseUnits() scales by 1e6. A non-6-decimal asset here would
// over- or under-charge by orders of magnitude — fail loudly at import.
for (const n of Object.values(X402_NETWORKS)) {
	if (n.assetDecimals !== 6) {
		throw new Error(
			`x402 network "${n.network}" asset ${n.assetSymbol} has ${n.assetDecimals} decimals; ` +
				'the credit->base-unit conversion assumes 6. Fix the conversion before adding it.',
		)
	}
}

/**
 * Resolve the networks a 402 challenge should advertise.
 *
 * The env-configured network stays FIRST for back-compat: existing x402 clients
 * take `accepts[0]`. Extra networks are opt-in via X402_EXTRA_NETWORKS (comma
 * separated) so enabling a new payment rail is a deliberate deploy-time act.
 * Unknown or duplicate names are ignored rather than throwing — a typo in env
 * must not take the whole API down.
 */
export function resolveX402Networks(
	primaryNetwork: string,
	primaryAsset: string,
	extraNetworks?: string,
): X402Network[] {
	const known = X402_NETWORKS[primaryNetwork]
	// Honour explicit env overrides of the primary asset even when it matches a
	// known network — operators may point at a testnet deployment.
	const primary: X402Network = known
		? { ...known, asset: primaryAsset || known.asset }
		: {
				network: primaryNetwork,
				chainId: 0,
				asset: primaryAsset,
				assetSymbol: 'USDC',
				assetDecimals: 6,
				// Unknown network: fall back to the historical USDC domain. This is
				// what shipped before the registry, so behaviour is unchanged.
				eip712: { name: 'USD Coin', version: '2' },
			}

	const out = [primary]
	const seen = new Set([primary.network])
	for (const raw of (extraNetworks || '').split(',')) {
		const name = raw.trim()
		if (!name || seen.has(name)) continue
		const n = X402_NETWORKS[name]
		if (!n) continue
		seen.add(name)
		out.push(n)
	}
	return out
}
