from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Telegram
    telegram_bot_token: str = Field(..., description="Telegram bot token from BotFather")
    
    # Database
    database_url: str = Field(default="sqlite:///bot.db", description="Database connection URL")
    
    # Encryption
    encryption_key: str = Field(..., description="32-byte key for encrypting private keys")
    
    # EVM RPC Endpoints
    ethereum_rpc_url: str = Field(
        default="https://eth.llamarpc.com",
        description="Ethereum mainnet RPC URL"
    )
    bsc_rpc_url: str = Field(
        default="https://bsc-dataseed.binance.org/",
        description="BSC mainnet RPC URL"
    )
    polygon_rpc_url: str = Field(
        default="https://polygon-rpc.com/",
        description="Polygon mainnet RPC URL"
    )
    arbitrum_rpc_url: str = Field(
        default="https://arb1.arbitrum.io/rpc",
        description="Arbitrum mainnet RPC URL"
    )
    optimism_rpc_url: str = Field(
        default="https://mainnet.optimism.io",
        description="Optimism mainnet RPC URL"
    )
    base_rpc_url: str = Field(
        default="https://mainnet.base.org",
        description="Base mainnet RPC URL"
    )
    
    # Solana RPC
    solana_rpc_url: str = Field(
        default="https://api.mainnet-beta.solana.com",
        description="Solana mainnet RPC URL"
    )
    
    # API Keys (optional for higher rate limits)
    lifi_api_key: Optional[str] = Field(default=None, description="Li.Fi API key")
    jupiter_api_key: Optional[str] = Field(default=None, description="Jupiter API key")
    
    # WhatsApp Business API (Optional)
    whatsapp_phone_number_id: Optional[str] = Field(default=None, description="WhatsApp Business Phone Number ID")
    whatsapp_access_token: Optional[str] = Field(default=None, description="WhatsApp Cloud API Access Token")
    whatsapp_verify_token: str = Field(default="suwappu_verify", description="Webhook verification token")
    
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

