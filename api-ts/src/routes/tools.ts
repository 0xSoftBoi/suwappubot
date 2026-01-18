import { Hono } from 'hono'

const toolsRoutes = new Hono()

// Agent tool discovery endpoint
toolsRoutes.get('/tools', (c) => {
	return c.json({
		name: 'Suwappu DEX Bot',
		description: 'Cross-chain DEX trading bot with support for 7+ chains',
		tools: [
			{
				name: 'get_portfolio',
				description: 'Get user portfolio with token balances across all chains',
				inputSchema: {
					type: 'object',
					properties: {
						user_id: { type: 'string', description: 'User ID' },
					},
					required: ['user_id'],
				},
			},
			{
				name: 'get_wallets',
				description: 'Get user wallets',
				inputSchema: {
					type: 'object',
					properties: {
						user_id: { type: 'string', description: 'User ID' },
					},
					required: ['user_id'],
				},
			},
			{
				name: 'get_swaps',
				description: 'Get user swap history',
				inputSchema: {
					type: 'object',
					properties: {
						user_id: { type: 'string', description: 'User ID' },
						limit: { type: 'number', description: 'Max results', default: 20 },
						offset: { type: 'number', description: 'Offset for pagination', default: 0 },
					},
					required: ['user_id'],
				},
			},
			{
				name: 'execute',
				description: 'Execute a natural language trading command',
				inputSchema: {
					type: 'object',
					properties: {
						user_id: { type: 'string', description: 'User ID' },
						command: {
							type: 'string',
							description: 'Natural language command (e.g., "swap 0.1 ETH to USDC on Base")',
						},
					},
					required: ['user_id', 'command'],
				},
			},
		],
	})
})

export { toolsRoutes }
