from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from typing import ClassVar, Dict, Optional, List
from functools import lru_cache
import random


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Telegram
    telegram_bot_token: str = Field(..., description="Telegram bot token from BotFather")
    use_webhook: bool = Field(default=False, description="Use webhooks instead of polling (required for multiple replicas)")
    webhook_url: Optional[str] = Field(default=None, description="Public URL for Telegram webhook (e.g., https://api.example.com/telegram/webhook)")
    webhook_secret_token: Optional[str] = Field(default=None, description="Secret token for webhook verification")
    
    # Database
    database_url: str = Field(default="sqlite:///bot.db", description="Database connection URL")
    
    # Encryption
    encryption_key: str = Field(..., description="32-byte key for encrypting private keys (legacy/fallback)")
    
    # KMS Wallet Encryption (envelope encryption)
    kms_provider: str = Field(
        default="aws",
        description="KMS provider: 'aws' (recommended), 'gcp', or 'dev' (local mock — NOT for production)"
    )
    kms_key_id: Optional[str] = Field(
        default=None,
        description="KMS key ID/ARN (required for aws/gcp providers)"
    )
    kms_region: Optional[str] = Field(
        default=None,
        description="AWS region for KMS (e.g., 'us-east-1')"
    )
    gcp_project_id: Optional[str] = Field(
        default=None,
        description="GCP project ID for KMS"
    )
    gcp_kms_location: str = Field(
        default="global",
        description="GCP KMS location (e.g., 'global', 'us-east1')"
    )
    gcp_kms_keyring: Optional[str] = Field(
        default=None,
        description="GCP KMS keyring name"
    )
    wallet_encryption_scheme: str = Field(
        default="kms_aesgcm_v2",
        description="Default encryption scheme for new wallets: 'legacy_fernet_v1' or 'kms_aesgcm_v2'"
    )
    auto_migrate_legacy_wallets: bool = Field(
        default=True,
        description="Auto-migrate legacy wallets to v2 on first use"
    )
    
    # Turnkey Wallet Infrastructure
    wallet_provider: str = Field(
        default="local",
        description="Wallet provider: 'local' (encrypted in DB) or 'turnkey' (TEE-backed)"
    )
    turnkey_organization_id: Optional[str] = Field(
        default=None,
        description="Turnkey parent organization ID"
    )
    turnkey_api_public_key: Optional[str] = Field(
        default=None,
        description="Turnkey API keypair public key (hex-encoded)"
    )
    turnkey_api_private_key: Optional[str] = Field(
        default=None,
        description="Turnkey API keypair private key (hex-encoded)"
    )
    turnkey_base_url: str = Field(
        default="https://api.turnkey.com",
        description="Turnkey API base URL"
    )
    turnkey_default_evm_curve: str = Field(
        default="CURVE_SECP256K1",
        description="Default curve for EVM wallets"
    )
    turnkey_default_solana_curve: str = Field(
        default="CURVE_ED25519",
        description="Default curve for Solana wallets"
    )

    # OAuth Configuration (Google + Twitter)
    google_client_id: Optional[str] = Field(
        default=None,
        description="Google OAuth 2.0 client ID"
    )
    google_client_secret: Optional[str] = Field(
        default=None,
        description="Google OAuth 2.0 client secret"
    )
    twitter_client_id: Optional[str] = Field(
        default=None,
        description="Twitter/X OAuth 2.0 client ID"
    )
    twitter_client_secret: Optional[str] = Field(
        default=None,
        description="Twitter/X OAuth 2.0 client secret"
    )
    oauth_redirect_base: str = Field(
        default="http://localhost:3000",
        description="Base URL for OAuth redirect URIs (e.g., https://app.suwappu.com)"
    )

    # Infura RPC (primary, reliable RPCs for all major chains)
    infura_api_key: Optional[str] = Field(
        default=None,
        description="Infura API key — used as primary RPC for supported chains"
    )

    # Alchemy Configuration (Full Suite)
    alchemy_api_key: Optional[str] = Field(
        default=None,
        description="Alchemy API key for enhanced RPC, Token API, NFT API"
    )
    alchemy_webhook_auth_token: Optional[str] = Field(
        default=None,
        description="Alchemy webhook authentication token"
    )
    alchemy_network_overrides: Optional[str] = Field(
        default=None,
        description="JSON map of chain->network overrides for Alchemy"
    )

    # JWT Configuration
    jwt_secret_key: Optional[str] = Field(
        default=None,
        description="Secret key for JWT signing (auto-generated if not set)"
    )
    jwt_expiry_hours: int = Field(
        default=168,
        description="JWT token expiry in hours (default: 7 days)"
    )

    # EVM RPC Endpoints — sourced from chainlist.org, no API keys needed
    # Infura/Alchemy are prepended automatically when keys are set
    ethereum_rpc_url: str = Field(
        default="https://ethereum-rpc.publicnode.com,https://1rpc.io/eth,https://eth.drpc.org,https://eth.llamarpc.com",
        description="Ethereum mainnet RPC URL(s)"
    )
    bsc_rpc_url: str = Field(
        default="https://bsc-dataseed.binance.org,https://bsc-rpc.publicnode.com,https://1rpc.io/bnb,https://bsc.drpc.org",
        description="BSC mainnet RPC URL(s)"
    )
    polygon_rpc_url: str = Field(
        default="https://polygon-bor-rpc.publicnode.com,https://1rpc.io/matic,https://polygon.drpc.org",
        description="Polygon mainnet RPC URL(s)"
    )
    arbitrum_rpc_url: str = Field(
        default="https://arb1.arbitrum.io/rpc,https://arbitrum-one-rpc.publicnode.com,https://1rpc.io/arb,https://arbitrum.drpc.org",
        description="Arbitrum mainnet RPC URL(s)"
    )
    optimism_rpc_url: str = Field(
        default="https://mainnet.optimism.io,https://optimism-rpc.publicnode.com,https://1rpc.io/op,https://optimism.drpc.org",
        description="Optimism mainnet RPC URL(s)"
    )
    base_rpc_url: str = Field(
        default="https://mainnet.base.org,https://base-rpc.publicnode.com,https://1rpc.io/base,https://base.drpc.org",
        description="Base mainnet RPC URL(s)"
    )
    avalanche_rpc_url: str = Field(
        default="https://api.avax.network/ext/bc/C/rpc,https://avalanche-c-chain-rpc.publicnode.com,https://1rpc.io/avax/c,https://avalanche.drpc.org",
        description="Avalanche C-Chain RPC URL(s)"
    )
    fantom_rpc_url: str = Field(
        default="https://rpcapi.fantom.network,https://1rpc.io/ftm,https://fantom.drpc.org",
        description="Fantom mainnet RPC URL(s)"
    )
    linea_rpc_url: str = Field(
        default="https://rpc.linea.build,https://linea-rpc.publicnode.com,https://1rpc.io/linea,https://linea.drpc.org",
        description="Linea mainnet RPC URL(s)"
    )
    mantle_rpc_url: str = Field(
        default="https://rpc.mantle.xyz,https://mantle-rpc.publicnode.com,https://1rpc.io/mantle,https://mantle.drpc.org",
        description="Mantle mainnet RPC URL(s)"
    )
    gnosis_rpc_url: str = Field(
        default="https://rpc.gnosischain.com,https://gnosis-rpc.publicnode.com,https://1rpc.io/gnosis,https://gnosis.drpc.org",
        description="Gnosis Chain RPC URL(s)"
    )
    scroll_rpc_url: str = Field(
        default="https://rpc.scroll.io,https://scroll-rpc.publicnode.com,https://1rpc.io/scroll,https://scroll.drpc.org",
        description="Scroll mainnet RPC URL(s)"
    )

    # Solana RPC
    solana_rpc_url: str = Field(
        default="https://api.mainnet-beta.solana.com,https://solana-mainnet.rpc.extrnode.com",
        description="Solana mainnet RPC URL(s)"
    )

    # TRON RPC
    tron_rpc_url: str = Field(
        default="https://api.trongrid.io",
        description="TRON mainnet RPC URL(s)"
    )

    # Infura network name mappings
    INFURA_NETWORKS: ClassVar[Dict[str, str]] = {
        "ethereum": "mainnet",
        "polygon": "polygon-mainnet",
        "arbitrum": "arbitrum-mainnet",
        "optimism": "optimism-mainnet",
        "base": "base-mainnet",
        "avalanche": "avalanche-mainnet",
        "linea": "linea-mainnet",
        "bsc": "bsc-mainnet",
    }

    def get_rpc_url(self, chain_name: str) -> str:
        """Get a random RPC URL for a given chain.

        Priority: Infura (if key set) → Alchemy (if key set) → public RPCs.
        """
        urls = []

        # Infura first (most reliable)
        if self.infura_api_key:
            infura_net = self.INFURA_NETWORKS.get(chain_name.lower())
            if infura_net:
                urls.append(f"https://{infura_net}.infura.io/v3/{self.infura_api_key}")

        # Alchemy second
        alchemy_url = self.get_alchemy_rpc_url(chain_name)
        if alchemy_url:
            urls.append(alchemy_url)

        # Public RPCs as fallback
        attr_name = f"{chain_name.lower().replace('-', '_')}_rpc_url"
        urls_str = getattr(self, attr_name, "")
        if urls_str:
            urls.extend(u.strip() for u in urls_str.split(",") if u.strip())

        if not urls:
            return ""

        # If we have Infura/Alchemy, prefer them (first 70% of the time)
        if len(urls) > 1 and (self.infura_api_key or self.alchemy_api_key):
            return urls[0] if random.random() < 0.7 else random.choice(urls)

        return random.choice(urls)

    def get_alchemy_network(self, chain_name: str) -> Optional[str]:
        """
        Get the Alchemy network identifier for a chain.

        Returns None for chains not supported by Alchemy (BSC, Solana).
        """
        # Default Alchemy network mappings
        alchemy_networks = {
            "ethereum": "eth-mainnet",
            "polygon": "polygon-mainnet",
            "arbitrum": "arb-mainnet",
            "optimism": "opt-mainnet",
            "base": "base-mainnet",
        }

        # Apply custom overrides if configured
        if self.alchemy_network_overrides:
            try:
                import json
                overrides = json.loads(self.alchemy_network_overrides)
                alchemy_networks.update(overrides)
            except (json.JSONDecodeError, TypeError):
                pass

        return alchemy_networks.get(chain_name.lower())

    def get_alchemy_rpc_url(self, chain_name: str) -> Optional[str]:
        """Get the Alchemy RPC URL for a chain."""
        if not self.alchemy_api_key:
            return None

        network = self.get_alchemy_network(chain_name)
        if not network:
            return None

        return f"https://{network}.g.alchemy.com/v2/{self.alchemy_api_key}"

    def is_oauth_configured(self, provider: str) -> bool:
        """Check if OAuth is configured for a provider."""
        if provider == "google":
            return bool(self.google_client_id and self.google_client_secret)
        elif provider == "twitter":
            return bool(self.twitter_client_id and self.twitter_client_secret)
        return False

    def get_webhook_secret(self) -> str:
        """Get or generate webhook secret token for Telegram verification."""
        if self.webhook_secret_token:
            return self.webhook_secret_token
        import hashlib
        return hashlib.sha256(self.telegram_bot_token.encode()).hexdigest()
    
    # API Keys (optional for higher rate limits)
    lifi_api_key: Optional[str] = Field(default=None, description="Li.Fi API key")
    lifi_integrator_id: str = Field(default="SuwappuProduction", description="Li.Fi integrator ID for fee collection")
    jupiter_api_key: Optional[str] = Field(default=None, description="Jupiter API key")
    socket_api_key: Optional[str] = Field(default=None, description="Socket/Bungee API key for super-aggregation")
    
    # WhatsApp Business API (Optional)
    whatsapp_phone_number_id: Optional[str] = Field(default=None, description="WhatsApp Business Phone Number ID")
    whatsapp_access_token: Optional[str] = Field(default=None, description="WhatsApp Cloud API Access Token")
    whatsapp_verify_token: Optional[str] = Field(default=None, description="Webhook verification token — must be set explicitly")

    # Discord Bot
    discord_bot_token: Optional[str] = Field(default=None, description="Discord bot token")
    discord_guild_ids: Optional[str] = Field(default=None, description="Comma-separated guild IDs for slash command sync")
    discord_whale_channel_id: Optional[str] = Field(default=None, description="Channel ID for whale alerts")
    discord_trending_channel_id: Optional[str] = Field(default=None, description="Channel ID for trending tokens")
    discord_leaderboard_channel_id: Optional[str] = Field(default=None, description="Channel ID for leaderboard posts")
    discord_alerts_channel_id: Optional[str] = Field(default=None, description="Channel ID for general alerts")
    discord_forum_channel_id: Optional[str] = Field(default=None, description="Forum channel ID for token analysis")
    discord_admin_role_id: Optional[str] = Field(default=None, description="Admin role ID")
    discord_vip_role_ids: Optional[str] = Field(default=None, description="Comma-separated VIP role IDs")

    def get_discord_guild_ids(self) -> list[int]:
        if not self.discord_guild_ids:
            return []
        return [int(gid.strip()) for gid in self.discord_guild_ids.split(",") if gid.strip()]

    def get_discord_vip_role_ids(self) -> list[int]:
        if not self.discord_vip_role_ids:
            return []
        return [int(rid.strip()) for rid in self.discord_vip_role_ids.split(",") if rid.strip()]
    
    # Telegram Mini App
    webapp_url: str = Field(
        default="https://app.suwappu.bot",
        description="URL for the Telegram Mini App dashboard"
    )

    # Agent Interoperability
    agent_api_key: Optional[str] = Field(default=None, description="Secret key for other AI agents to access the API")

    # Admin API (for dashboard / ops tooling)
    admin_api_key: Optional[str] = Field(default=None, description="Secret key for admin dashboard access")
    admin_telegram_ids: str = Field(default="", description="Comma-separated Telegram user IDs for admin access")
    
    # Application Settings
    log_level: str = Field(default="INFO", description="Logging level")
    max_swap_amount: float = Field(default=100000, description="Maximum swap amount in USD")
    default_slippage: float = Field(default=0.5, description="Default slippage tolerance in %")
    
    # Fee Configuration (competitive pricing)
    swap_fee_percentage: float = Field(default=0.8, description="Swap fee percentage (0.8% = competitive rate)")
    referral_reward_percentage: float = Field(default=30, description="Referral reward percentage (30% of fees)")
    fee_collector_address: Optional[str] = Field(default=None, description="EVM address for fee collection")
    fee_collector_solana: Optional[str] = Field(default=None, description="Solana address for fee collection")
    
    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

