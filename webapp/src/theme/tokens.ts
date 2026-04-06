export const swapTokens = {
	color: {
		canvas: '#fdf7ef',
		surface: '#fffaf2',
		surfaceStrong: '#fff1d8',
		text: '#27180f',
		textMuted: '#7c6657',
		border: '#e9d1bf',
		accent: '#ff7a59',
		accentStrong: '#e95b35',
		success: '#1e9b63',
		warn: '#d38700',
		danger: '#d44747',
		provider: {
			lifi: '#111827',
			socket: '#0f766e',
			cctp: '#1d4ed8',
			across: '#7c3aed',
			cow: '#b45309',
			ccip: '#2563eb',
		},
	},
	radius: {
		sm: '12px',
		md: '18px',
		lg: '24px',
		pill: '999px',
	},
	shadow: {
		card: '0 20px 50px rgba(39, 24, 15, 0.08)',
		glow: '0 12px 32px rgba(255, 122, 89, 0.22)',
	},
	space: {
		xs: '0.25rem',
		sm: '0.5rem',
		md: '0.75rem',
		lg: '1rem',
		xl: '1.5rem',
	},
}

export type SwapProviderName = keyof typeof swapTokens.color.provider
