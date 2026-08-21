/**
 * Token registry — single source of truth for token address/decimals metadata
 * across chains.
 *
 * Previously COMMON_TOKENS + the Tempo/Robinhood decimal overrides lived
 * inline in TokenService.ts (EVM) and SOLANA_TOKENS lived inline in
 * JupiterService.ts. Consolidated here (Phase 3,
 * docs/plans/market-data-parity.md) so both the swap-quoting path
 * (TokenService/JupiterService, which re-export these names — no downstream
 * import changes) and the read-only /v1/data/reference/* API
 * (routes/data.ts) share one copy instead of two independently-maintained
 * lists drifting apart.
 */

// Common token addresses by chain (EVM chain id -> symbol -> address)
export const COMMON_TOKENS: Record<number, Record<string, string>> = {
	// Ethereum
	1: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
		DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
		WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
	},
	// Optimism
	10: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x4200000000000000000000000000000000000006',
		USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
		'USDC.e': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
		USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
		DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
	},
	// BSC
	56: {
		BNB: '0x0000000000000000000000000000000000000000',
		WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
		USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
		USDT: '0x55d398326f99059fF775485246999027B3197955',
		BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
	},
	// Polygon
	137: {
		MATIC: '0x0000000000000000000000000000000000000000',
		WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
		USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
		'USDC.e': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
		USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
		DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
	},
	// Arbitrum
	42161: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
		USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
		'USDC.e': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
		USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
		DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
	},
	// Base
	8453: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x4200000000000000000000000000000000000006',
		USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
	},
	// Avalanche
	43114: {
		AVAX: '0x0000000000000000000000000000000000000000',
		WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
		USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
		'USDC.e': '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
		USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
	},
	// Tempo
	4217: {
		pathUSD: '0x20c0000000000000000000000000000000000000',
		AlphaUSD: '0x20c0000000000000000000000000000000000001',
		BetaUSD: '0x20c0000000000000000000000000000000000002',
		ThetaUSD: '0x20c0000000000000000000000000000000000003',
	},
	// Robinhood Chain — anchor stablecoin is Paxos USDG, there is NO USDC here.
	// The two on-chain contracts both report symbol "USDG"; 0x5fc5... is the real
	// one (338.7M supply vs 1.1k) — verified via totalSupply() on 2026-08-04.
	4663: {
		ETH: '0x0000000000000000000000000000000000000000',
		WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
		USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
		USDe: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
	},
	// Plasma (zero-fee stablecoin L1)
	9745: {
		XPL: '0x0000000000000000000000000000000000000000',
		USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
		USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	},
}

// Decimals for Tempo TIP-20 tokens (chain 4217). Kept as a parallel map — not folded
// into COMMON_TOKENS' address-only shape — to avoid churning every other chain's entry.
// Authoritative source: bot/config/tokens.py TOKENS["PATHUSD"|"ALPHAUSD"|"BETAUSD"|"THETAUSD"]
// all declare decimals=18 (get_token_decimals() has no Tempo-specific override, unlike the
// GOAT/Citrea per-chain pins), and bot/services/swap_engine.py's _get_tempo_dex_quote() scales
// raw amounts using that same 18. There is no on-chain "6dp USDC-style" override for Tempo.
export const TEMPO_TOKEN_DECIMALS: Record<string, number> = {
	pathUSD: 18,
	AlphaUSD: 18,
	BetaUSD: 18,
	ThetaUSD: 18,
}

// Decimals for Robinhood Chain (4663) tokens. USDG is 6dp like USDC; the ~100
// tokenized equities (AAPL/TSLA/NVDA/...) are all 18dp. Mirrors
// bot/config/tokens.py ROBINHOOD_EQUITIES. Verified on-chain via decimals().
export const ROBINHOOD_TOKEN_DECIMALS: Record<string, number> = {
	USDG: 6,
	USDe: 18,
	WETH: 18,
	ETH: 18,
}

// Solana token addresses
export const SOLANA_TOKENS: Record<string, { address: string; decimals: number; name: string }> = {
	SOL: { address: 'So11111111111111111111111111111111111111112', decimals: 9, name: 'Solana' },
	WSOL: {
		address: 'So11111111111111111111111111111111111111112',
		decimals: 9,
		name: 'Wrapped SOL',
	},
	USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, name: 'USD Coin' },
	USDT: {
		address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
		decimals: 6,
		name: 'Tether USD',
	},
	BONK: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, name: 'Bonk' },
	WIF: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, name: 'dogwifhat' },
	JUP: { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, name: 'Jupiter' },
	RAY: { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, name: 'Raydium' },
	PYTH: {
		address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
		decimals: 6,
		name: 'Pyth Network',
	},
	JTO: { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, name: 'Jito' },
	ORCA: { address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, name: 'Orca' },
	MNDE: { address: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', decimals: 9, name: 'Marinade' },
	MSOL: {
		address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
		decimals: 9,
		name: 'Marinade Staked SOL',
	},
	JITOSOL: {
		address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
		decimals: 9,
		name: 'Jito Staked SOL',
	},
}
