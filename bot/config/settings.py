from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from typing import Optional, List
from functools import lru_cache
import random


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Telegram
    telegram_bot_token: str = Field(..., description="Telegram bot token from BotFather")
    
    # Database
    database_url: str = Field(default="sqlite:///bot.db", description="Database connection URL")
    
    # Encryption
    encryption_key: str = Field(..., description="32-byte key for encrypting private keys")
    
    # EVM RPC Endpoints (Can be comma-separated lists)
    ethereum_rpc_url: str = Field(
        default="https://eth.llamarpc.com,https://rpc.ankr.com/eth,https://1rpc.io/eth",
        description="Ethereum mainnet RPC URL(s)"
    )
    bsc_rpc_url: str = Field(
        default="https://bsc-dataseed.binance.org/,https://rpc.ankr.com/bsc,https://binance.llamarpc.com",
        description="BSC mainnet RPC URL(s)"
    )
    polygon_rpc_url: str = Field(
        default="https://polygon-rpc.com/,https://rpc.ankr.com/polygon,https://polygon.llamarpc.com",
        description="Polygon mainnet RPC URL(s)"
    )
    arbitrum_rpc_url: str = Field(
        default="https://arb1.arbitrum.io/rpc,https://rpc.ankr.com/arbitrum,https://arbitrum.llamarpc.com",
        description="Arbitrum mainnet RPC URL(s)"
    )
    optimism_rpc_url: str = Field(
        default="https://mainnet.optimism.io,https://rpc.ankr.com/optimism,https://optimism.llamarpc.com",
        description="Optimism mainnet RPC URL(s)"
    )
    base_rpc_url: str = Field(
        default="https://mainnet.base.org,https://rpc.ankr.com/base,https://base.llamarpc.com",
        description="Base mainnet RPC URL(s)"
    )
    
    # Solana RPC
    solana_rpc_url: str = Field(
        default="https://api.mainnet-beta.solana.com,https://solana-mainnet.rpc.extrnode.com",
        description="Solana mainnet RPC URL(s)"
    )

    def get_rpc_url(self, chain_name: str) -> str:
        """Get a random RPC URL for a given chain to avoid rate limits."""
        attr_name = f"{chain_name.lower().replace('-', '_')}_rpc_url"
        urls_str = getattr(self, attr_name, "")
        if not urls_str:
            # Fallback for chains that might not have a direct setting
            return ""
        
        urls = [u.strip() for u in urls_str.split(",") if u.strip()]
        return random.choice(urls) if urls else ""
    
    # API Keys (optional for higher rate limits)
    lifi_api_key: Optional[str] = Field(default=None, description="Li.Fi API key")
    jupiter_api_key: Optional[str] = Field(default=None, description="Jupiter API key")
    
    # WhatsApp Business API (Optional)
    whatsapp_phone_number_id: Optional[str] = Field(default=None, description="WhatsApp Business Phone Number ID")
    whatsapp_access_token: Optional[str] = Field(default=None, description="WhatsApp Cloud API Access Token")
    whatsapp_verify_token: str = Field(default="suwappu_verify", description="Webhook verification token")
    
    # Agent Interoperability
    agent_api_key: Optional[str] = Field(default=None, description="Secret key for other AI agents to access the API")

    # Admin API (for dashboard / ops tooling)
    admin_api_key: Optional[str] = Field(default=None, description="Secret key for admin dashboard access")
    
    # Application Settings
    log_level: str = Field(default="INFO", description="Logging level")
    max_swap_amount: float = Field(default=100000, description="Maximum swap amount in USD")
    default_slippage: float = Field(default=0.5, description="Default slippage tolerance in %")
    
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

