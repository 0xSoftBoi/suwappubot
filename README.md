# Cross-Chain Stablecoin Swap Telegram Bot

A Telegram bot that enables users to swap stablecoins across different blockchain networks directly through Telegram.

## Features

- 🔄 Cross-chain stablecoin swaps (Ethereum, BSC, Polygon, Arbitrum, Optimism, Solana)
- 💰 Support for major stablecoins (USDT, USDC, DAI, BUSD)
- 🌉 Powered by Li.Fi API for cross-chain swaps
- 🪐 Jupiter API integration for Solana swaps
- 🔐 Secure wallet management with encrypted private keys (EVM + Solana)
- 📊 Real-time price quotes and fee estimation
- 🚀 Fast and user-friendly Telegram interface

## Quick Start

### Prerequisites

- Python 3.10 or higher
- Telegram Bot Token (get it from [@BotFather](https://t.me/botfather))
- RPC endpoints for supported chains (Alchemy, Infura, or public RPCs)
- Solana RPC endpoint (public or dedicated provider)
- Optional: Li.Fi and Jupiter API keys for higher rate limits

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd suwappubot
```

2. Create a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

5. Run the bot:
```bash
python -m bot.main
```

## Configuration

See `.env.example` for all available configuration options. Key settings:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `DATABASE_URL`: Database connection string
- `ENCRYPTION_KEY`: 32-byte key for encrypting private keys
- RPC URLs for each supported EVM chain
- `SOLANA_RPC_URL`: Solana RPC endpoint
- `LIFI_API_KEY`: Optional Li.Fi API key
- `JUPITER_API_KEY`: Optional Jupiter API key

## Usage

1. Start a chat with your bot on Telegram
2. Send `/start` to begin
3. Use `/swap` to initiate a cross-chain swap
4. Follow the interactive prompts to select chains, tokens, and amounts
5. Confirm the transaction details
6. Wait for the swap to complete

## Commands

- `/start` - Start the bot and show main menu
- `/swap` - Initiate a cross-chain swap
- `/balance` - Check your wallet balances across chains
- `/help` - Show help information

## Security

⚠️ **Important Security Notes:**

- Private keys are encrypted at rest using AES-256
- Never share your private key with anyone
- Start with small amounts for testing
- Use testnet for initial testing
- The bot does not store your private key in plain text

## Supported Chains & Tokens

### Ethereum
- USDT, USDC, DAI

### Binance Smart Chain
- USDT, BUSD

### Polygon
- USDT, USDC

### Arbitrum
- USDT, USDC

### Optimism
- USDT, USDC

### Solana
- USDT, USDC

## API Integrations

- **Li.Fi API**: Handles all cross-chain swaps between EVM chains and Solana
  - Documentation: https://docs.li.fi/
  - Aggregates multiple bridges for best routes
  
- **Jupiter API**: Handles Solana-to-Solana swaps
  - Documentation: https://docs.jup.ag/
  - Best routes across all Solana DEXs

## Development

See [PLAN.md](PLAN.md) for detailed implementation plan and architecture.

### Project Structure

```
suwappubot/
├── bot/              # Main bot code
├── database/         # Database models and setup
├── tests/            # Test files
├── .env.example      # Environment variables template
├── requirements.txt  # Python dependencies
└── README.md         # This file
```

## Testing

Run tests with:
```bash
pytest tests/
```

For testnet testing, update RPC URLs in `.env` to testnet endpoints.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

[Add your license here]

## Disclaimer

This bot interacts with blockchain networks and handles cryptocurrency. Use at your own risk. Always:
- Test thoroughly on testnets first
- Start with small amounts
- Understand the risks of cross-chain swaps
- Keep your private keys secure

## Support

For issues and questions, please open an issue on GitHub.

