# Cross-Chain Stablecoin Swap Telegram Bot - Implementation Plan

## Project Overview

A Telegram bot that enables users to swap stablecoins across different blockchain networks (Ethereum, BSC, Polygon, Arbitrum, Optimism, Solana, etc.) directly through Telegram chat interface using Li.Fi API for cross-chain swaps and Jupiter API for Solana.

## Core Features

### Phase 1: MVP (Minimum Viable Product)
1. **Multi-chain Support**
   - Ethereum (USDT, USDC, DAI)
   - Binance Smart Chain (BUSD, USDT)
   - Polygon (USDT, USDC)
   - Arbitrum (USDT, USDC)
   - Optimism (USDT, USDC)
   - Solana (USDT, USDC)

2. **Basic Swap Functionality**
   - Select source chain and token
   - Select destination chain and token
   - Enter amount
   - Display estimated fees and exchange rate
   - Execute swap

3. **Telegram Interface**
   - Command-based interactions (`/start`, `/swap`, `/balance`, `/help`)
   - Inline keyboard buttons for chain/token selection
   - Transaction status updates
   - Error handling and user feedback

### Phase 2: Enhanced Features
1. **Wallet Management**
   - Connect wallet via private key (encrypted storage)
   - View balances across chains
   - Transaction history

2. **Advanced Features**
   - Price alerts
   - Slippage tolerance settings
   - Gas optimization
   - Multi-hop swaps for better rates

3. **Security**
   - Private key encryption
   - Transaction signing verification
   - Rate limiting
   - User authentication

## Architecture

### System Components

```
┌─────────────────┐
│  Telegram Bot   │
│   (Python)      │
└────────┬────────┘
         │
         ├───> Command Handler
         ├───> State Manager
         ├───> Wallet Manager
         └───> Swap Engine
                  │
                  ├───> Li.Fi API (Cross-chain swaps)
                  ├───> Jupiter API (Solana swaps)
                  └───> Blockchain RPCs (EVM + Solana)
```

### Technology Stack

1. **Bot Framework**
   - `python-telegram-bot` (v20+) - Modern async Telegram bot library
   - `python-dotenv` - Environment variable management

2. **Blockchain Integration**
   - `web3.py` - Ethereum and EVM-compatible chains
   - `eth-account` - Account management and signing
   - `eth-utils` - Ethereum utilities
   - `solana-py` / `solders` - Solana blockchain integration
   - `anchorpy` (optional) - Solana program interactions

3. **Cross-Chain & Swap APIs**
   - **Li.Fi API** - Unified cross-chain bridge aggregator
     - Supports: Ethereum, BSC, Polygon, Arbitrum, Optimism, and more
     - API: https://docs.li.fi/
     - Handles route finding, quotes, and execution
   - **Jupiter API** - Solana DEX aggregator
     - Best routes for Solana swaps
     - API: https://docs.jup.ag/
     - Supports USDT, USDC, and other tokens on Solana

4. **Data & Utilities**
   - `requests` / `aiohttp` - HTTP requests
   - `cryptography` - Private key encryption
   - `sqlite3` or `PostgreSQL` - User data storage
   - `redis` (optional) - Caching and rate limiting

5. **Configuration**
   - `pydantic` - Settings validation
   - `pyyaml` - Configuration files

## Project Structure

```
suwappubot/
├── bot/
│   ├── __init__.py
│   ├── main.py                 # Bot entry point
│   ├── handlers/
│   │   ├── __init__.py
│   │   ├── start.py            # /start command
│   │   ├── swap.py             # Swap flow handlers
│   │   ├── balance.py          # Balance queries
│   │   └── help.py             # Help commands
│   ├── services/
│   │   ├── __init__.py
│   │   ├── wallet.py           # Wallet management (EVM + Solana)
│   │   ├── swap_engine.py      # Swap execution logic
│   │   ├── lifi_api.py         # Li.Fi API client
│   │   ├── jupiter_api.py      # Jupiter API client
│   │   └── price_service.py    # Price fetching
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py             # User data models
│   │   ├── swap.py             # Swap transaction models
│   │   └── chain.py            # Chain configuration
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── encryption.py       # Key encryption
│   │   ├── validators.py       # Input validation
│   │   └── formatters.py       # Message formatting
│   └── config/
│       ├── __init__.py
│       ├── chains.py           # Chain configurations
│       └── tokens.py           # Token addresses
├── database/
│   ├── __init__.py
│   └── db.py                   # Database setup
├── tests/
│   ├── __init__.py
│   ├── test_handlers.py
│   ├── test_swap_engine.py
│   └── test_wallet.py
├── .env.example                 # Environment variables template
├── requirements.txt             # Python dependencies
├── config.yaml                  # Configuration file
├── README.md                    # Project documentation
└── PLAN.md                      # This file
```

## Implementation Roadmap

### Step 1: Project Setup
- [ ] Initialize Python project structure
- [ ] Set up virtual environment
- [ ] Install dependencies
- [ ] Create configuration files
- [ ] Set up environment variables

### Step 2: Core Infrastructure
- [ ] Database schema design and setup
- [ ] Chain configuration (RPC endpoints, token addresses)
- [ ] Wallet management system (encryption, storage)
- [ ] Basic Telegram bot setup with command handlers

### Step 3: Blockchain Integration
- [ ] Web3 connection setup for EVM chains
- [ ] Solana RPC connection setup
- [ ] Balance checking functionality (EVM + Solana)
- [ ] Token allowance management (EVM)
- [ ] Transaction building and signing (EVM + Solana)

### Step 4: API Integration
- [ ] Implement Li.Fi API client
  - [ ] Route quote fetching
  - [ ] Transaction building
  - [ ] Status tracking
- [ ] Implement Jupiter API client
  - [ ] Quote fetching for Solana swaps
  - [ ] Transaction building
  - [ ] Route optimization
- [ ] Handle cross-chain swaps (EVM ↔ Solana via Li.Fi)
- [ ] Handle Solana-only swaps (via Jupiter)

### Step 5: Telegram Bot Interface
- [ ] Command handlers (`/start`, `/help`)
- [ ] Swap flow with inline keyboards
- [ ] Chain and token selection UI
- [ ] Amount input handling
- [ ] Transaction status updates
- [ ] Error messages and user feedback

### Step 6: Security & Safety
- [ ] Private key encryption at rest
- [ ] Input validation and sanitization
- [ ] Rate limiting per user
- [ ] Transaction confirmation prompts
- [ ] Slippage protection

### Step 7: Testing
- [ ] Unit tests for core functions
- [ ] Integration tests for swap flow
- [ ] Testnet testing
- [ ] Security audit

### Step 8: Deployment
- [ ] Production configuration
- [ ] Monitoring and logging setup
- [ ] Error tracking (Sentry, etc.)
- [ ] Documentation

## Security Considerations

1. **Private Key Management**
   - Never store private keys in plain text
   - Use encryption (AES-256) with user-specific keys
   - Consider hardware wallet integration for advanced users
   - Implement key derivation from user passwords

2. **Transaction Safety**
   - Always show transaction details before execution
   - Implement slippage tolerance checks
   - Set maximum swap amounts (configurable)
   - Transaction simulation before execution

3. **Access Control**
   - Rate limiting per user
   - Transaction limits per day/hour
   - Whitelist/blacklist functionality
   - Admin commands for monitoring

4. **Data Privacy**
   - Encrypt sensitive user data
   - GDPR compliance considerations
   - Secure database connections
   - Regular security audits

## Configuration

### Environment Variables
```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Database
DATABASE_URL=sqlite:///bot.db
# or for PostgreSQL:
# DATABASE_URL=postgresql://user:pass@localhost/dbname

# Encryption
ENCRYPTION_KEY=your_encryption_key_here

# RPC Endpoints (EVM Chains)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_RPC_URL=https://bsc-dataseed.binance.org/
POLYGON_RPC_URL=https://polygon-rpc.com/
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
OPTIMISM_RPC_URL=https://mainnet.optimism.io

# Solana RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# Or use a dedicated RPC provider:
# SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY

# API Keys
LIFI_API_KEY=optional  # Li.Fi API key (optional, public API available)
JUPITER_API_KEY=optional  # Jupiter API key (optional, public API available)
```

### Chain Configuration
Each EVM chain needs:
- Chain ID
- RPC endpoint
- Native token (ETH, BNB, MATIC, etc.)
- Supported stablecoins with contract addresses
- Block explorer URL
- Gas estimation parameters

Solana configuration needs:
- Network (mainnet-beta, devnet, testnet)
- RPC endpoint
- Supported stablecoins with mint addresses (USDT, USDC)
- Block explorer URL (Solscan, Solana Explorer)

## Dependencies (requirements.txt)

```
python-telegram-bot==20.7
web3==6.11.3
eth-account==0.9.0
eth-utils==2.3.1
solders==0.18.1
solana==0.30.2
anchorpy==0.18.0
cryptography==41.0.7
aiohttp==3.9.1
python-dotenv==1.0.0
pydantic==2.5.2
pydantic-settings==2.1.0
sqlalchemy==2.0.23
alembic==1.13.1
pyyaml==6.0.1
base58==2.1.1
```

## API Integrations

### Li.Fi API
- **Primary cross-chain bridge aggregator**
- API Documentation: https://docs.li.fi/
- Base URL: `https://li.quest/v1/`
- Key Endpoints:
  - `/quote` - Get swap quotes across chains
  - `/status` - Check transaction status
  - `/tools` - Get available tools and chains
- Features:
  - Aggregates multiple bridges (Stargate, Hop, Across, etc.)
  - Best route finding
  - Supports 20+ chains including Ethereum, BSC, Polygon, Arbitrum, Optimism
  - Cross-chain swaps (EVM ↔ Solana supported)
  - Real-time quote updates
- Authentication: Optional API key for higher rate limits

### Jupiter API
- **Solana DEX aggregator**
- API Documentation: https://docs.jup.ag/
- Base URL: `https://quote-api.jup.ag/v6/`
- Key Endpoints:
  - `/quote` - Get best swap quote
  - `/swap` - Get swap transaction
  - `/price` - Get token prices
- Features:
  - Best routes across all Solana DEXs
  - Supports USDT, USDC, and other tokens
  - Low slippage routes
  - Fast execution
- Authentication: Optional API key for higher rate limits

### Price Oracles
- CoinGecko API (for price data)
- Chainlink price feeds (on-chain)
- Jupiter price API (for Solana tokens)

## API Implementation Details

### Li.Fi API Integration

**Base URL**: `https://li.quest/v1/`

**Key Endpoints**:
1. **GET `/tools`** - Get available chains and tokens
   - Use to populate chain/token selection menus
   - Cache results (update daily)

2. **GET `/quote`** - Get swap quote
   - Parameters:
     - `fromChain`: Chain ID (e.g., 1 for Ethereum, 8453 for Base)
     - `toChain`: Destination chain ID
     - `fromToken`: Token address or symbol
     - `toToken`: Token address or symbol
     - `fromAmount`: Amount in smallest unit (wei, lamports, etc.)
     - `fromAddress`: User's wallet address
     - `toAddress`: Destination wallet address
     - `slippage`: Slippage tolerance (default: 0.5%)
   - Returns: Quote with route, fees, estimated time, transaction data

3. **POST `/status`** - Check transaction status
   - Parameters:
     - `txHash`: Transaction hash
     - `bridge`: Bridge name used
   - Returns: Status (PENDING, DONE, FAILED), updates

**Implementation Flow**:
1. User selects chains and tokens
2. Call `/quote` to get best route
3. Display quote to user (amount out, fees, time)
4. User confirms
5. Build transaction from quote response
6. Sign transaction (EVM or Solana)
7. Submit transaction
8. Poll `/status` for updates
9. Notify user on completion

**Error Handling**:
- Handle rate limits (429 errors)
- Retry logic for failed requests
- Fallback routes if primary route fails
- Validate quote expiration (quotes expire quickly)

### Jupiter API Integration

**Base URL**: `https://quote-api.jup.ag/v6/`

**Key Endpoints**:
1. **GET `/quote`** - Get swap quote
   - Parameters:
     - `inputMint`: Source token mint address
     - `outputMint`: Destination token mint address
     - `amount`: Amount in smallest unit (lamports)
     - `slippageBps`: Slippage in basis points (e.g., 50 = 0.5%)
     - `onlyDirectRoutes`: Optional, for faster quotes
   - Returns: Quote with route, price impact, route plan

2. **POST `/swap`** - Get swap transaction
   - Parameters:
     - `quoteResponse`: Quote from `/quote` endpoint
     - `userPublicKey`: User's Solana public key
     - `wrapUnwrapSOL`: Optional, wrap/unwrap SOL
     - `dynamicComputeUnitLimit`: Optional, for better success rate
   - Returns: Transaction object ready to sign

**Implementation Flow**:
1. User selects Solana tokens (both source and destination)
2. Call `/quote` to get best route
3. Display quote (amount out, price impact, route)
4. User confirms
5. Call `/swap` with quote to get transaction
6. Sign transaction with Solana keypair
7. Submit to Solana network
8. Monitor transaction status
9. Notify user on confirmation

**Error Handling**:
- Handle Jupiter rate limits
- Validate quote freshness (quotes expire in seconds)
- Handle price impact warnings (>1% impact)
- Retry logic for failed swaps

**Solana Token Addresses**:
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

### Wallet Handling Differences

**EVM Wallets**:
- Private key: 64 hex characters (32 bytes)
- Address: 0x followed by 40 hex characters
- Signing: ECDSA with secp256k1
- Transaction format: EIP-1559 or legacy

**Solana Wallets**:
- Private key: 32 bytes (can be base58 encoded)
- Public key: Base58 encoded 32 bytes
- Address: Base58 encoded public key
- Signing: Ed25519 signature
- Transaction format: Solana Transaction with instructions

**Implementation**:
- Store both formats in encrypted database
- Detect chain type from user selection
- Use appropriate signing method
- Handle different transaction building processes

## User Flow Example

1. User sends `/start`
2. Bot welcomes and shows main menu
3. User clicks "Swap Stablecoins"
4. Bot asks: "Select source chain" (inline keyboard)
5. User selects chain (e.g., Ethereum)
6. Bot asks: "Select source token" (USDT, USDC, DAI)
7. User selects token
8. Bot asks: "Select destination chain"
9. User selects chain (e.g., Polygon)
10. Bot asks: "Select destination token"
11. User selects token
12. Bot asks: "Enter amount"
13. User enters amount
14. Bot fetches quote (amount out, fees, estimated time)
15. Bot shows confirmation with details
16. User confirms
17. Bot executes swap
18. Bot sends transaction hash and status updates
19. Bot notifies when swap completes

## Future Enhancements

1. **Multi-wallet Support**
   - Connect multiple wallets
   - Wallet switching

2. **Advanced Trading**
   - Limit orders
   - DCA (Dollar Cost Averaging)
   - Portfolio tracking

3. **Analytics**
   - Swap history
   - Gas cost tracking
   - Best time to swap analysis

4. **Social Features**
   - Referral system
   - Leaderboards
   - Community features

5. **Additional Chains** (via Li.Fi)
   - Avalanche
   - Fantom
   - Base
   - zkSync
   - LayerZero chains
   - Cosmos chains
   - And 20+ more supported by Li.Fi

## Risk Management

1. **Smart Contract Risks**
   - Audit bridge contracts before integration
   - Use reputable, well-audited bridges
   - Implement circuit breakers

2. **Market Risks**
   - Slippage protection
   - Price impact warnings
   - Maximum swap limits

3. **Technical Risks**
   - RPC endpoint redundancy
   - Transaction monitoring and retry logic
   - Comprehensive error handling

## Success Metrics

- Number of successful swaps
- Average swap time
- User retention rate
- Total volume swapped
- Error rate
- User satisfaction

## Notes

- Start with testnet deployment
- Implement comprehensive logging
- Use async/await throughout for better performance
- Consider implementing a queue system for swap requests
- Regular backups of user data
- Monitor gas prices and suggest optimal times
- **Li.Fi Integration**: Use Li.Fi for all cross-chain swaps (including EVM ↔ Solana)
- **Jupiter Integration**: Use Jupiter for Solana-to-Solana swaps only
- **Wallet Handling**: Solana uses different keypair format than EVM - handle both formats
- **Transaction Signing**: EVM uses ECDSA, Solana uses Ed25519 - implement both signing methods

