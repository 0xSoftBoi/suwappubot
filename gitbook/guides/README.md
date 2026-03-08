# Guides

Practical guides for common workflows with the Suwappu API. Each guide includes complete code examples in curl, Python, and TypeScript.

## Available Guides

### [Cross-Chain Swaps](cross-chain-swaps.md)

Bridge tokens between different blockchain networks. Learn how to use the `from_chain` and `to_chain` parameters to move assets across chains -- for example, bridging USDC from Ethereum to Arbitrum.

### [Managed Wallets](managed-wallets.md)

Create and use server-side managed wallets for hands-free swap execution. Suwappu holds the private keys and signs transactions on your behalf, so your agent never needs to handle keys directly.

### [Webhook Setup](webhook-setup.md)

Receive real-time notifications when swaps complete or fail. Set up a webhook endpoint, configure your agent's callback URL, and handle incoming events.

### [Building a Trading Bot](building-a-trading-bot.md)

End-to-end tutorial for building an automated trading bot. Complete, runnable scripts in Python and TypeScript that register an agent, create a wallet, monitor prices, and execute swaps based on conditions.
