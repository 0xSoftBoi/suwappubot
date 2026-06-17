from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from typing import ClassVar, Dict, Optional, List
from functools import lru_cache
import random


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Telegram
    telegram_bot_token: str = Field(..., description="Telegram bot token from BotFather")
    use_webhook: bool = Field(
        default=False,
        description="Use webhooks instead of polling (required for multiple replicas)",
    )
    webhook_url: Optional[str] = Field(
        default=None,
        description="Public URL for Telegram webhook (e.g., https://api.example.com/telegram/webhook)",
    )
    webhook_secret_token: Optional[str] = Field(
        default=None, description="Secret token for webhook verification"
    )
    bot_concurrent_updates: int = Field(
        default=0,
        description=(
            "Max concurrent Telegram updates (per-user serialized). "
            "0 = sequential processing (PTB default). Recommended: 256."
        ),
    )

    # Service-split knobs (env: ENABLE_BACKGROUND_SERVICES / RUN_TELEGRAM_BOT)
    enable_background_services: bool = Field(
        default=True,
        description="Enable background services (fee sweeper, alerts, orders, tx poller, balance refresher). Set to false on the 'python-api' service when a dedicated 'python-worker' runs them.",
    )
    run_telegram_bot: bool = Field(
        default=True,
        description="Run the Telegram bot (Application build + webhook/polling). Set to false on the 'python-worker' service so only one instance consumes Telegram updates.",
    )

    # Database
    database_url: str = Field(default="sqlite:///bot.db", description="Database connection URL")

    # Encryption
    encryption_key: str = Field(
        ..., description="32-byte key for encrypting private keys (legacy/fallback)"
    )

    # KMS Wallet Encryption (envelope encryption)
    kms_provider: str = Field(
        default="aws",
        description="KMS provider: 'aws', 'gcp', 'local' (env-var KEK, production-acceptable for the fallback/backup + OAuth tier), or 'dev' (local mock — NOT for production)",
    )
    wallet_master_kek: Optional[str] = Field(
        default=None,
        description="High-entropy base64/hex KEK used by the 'local' KMS provider to wrap per-wallet DEKs. Distinct from encryption_key. Generate: python3 -c \"import os,base64;print(base64.b64encode(os.urandom(32)).decode())\"",
    )
    kms_key_id: Optional[str] = Field(
        default=None, description="KMS key ID/ARN (required for aws/gcp providers)"
    )
    kms_region: Optional[str] = Field(
        default=None, description="AWS region for KMS (e.g., 'us-east-1')"
    )
    gcp_project_id: Optional[str] = Field(default=None, description="GCP project ID for KMS")
    gcp_kms_location: str = Field(
        default="global", description="GCP KMS location (e.g., 'global', 'us-east1')"
    )
    gcp_kms_keyring: Optional[str] = Field(default=None, description="GCP KMS keyring name")
    wallet_encryption_scheme: str = Field(
        default="kms_aesgcm_v2",
        description="Default encryption scheme for new wallets: 'legacy_fernet_v1' or 'kms_aesgcm_v2'",
    )
    auto_migrate_legacy_wallets: bool = Field(
        default=True, description="Auto-migrate legacy wallets to v2 on first use"
    )

    # Turnkey Wallet Infrastructure
    wallet_provider: str = Field(
        default="local",
        description="Wallet provider: 'local' (encrypted in DB) or 'turnkey' (TEE-backed)",
    )
    turnkey_organization_id: Optional[str] = Field(
        default=None, description="Turnkey parent organization ID"
    )
    turnkey_api_public_key: Optional[str] = Field(
        default=None, description="Turnkey API keypair public key (hex-encoded)"
    )
    turnkey_api_private_key: Optional[str] = Field(
        default=None, description="Turnkey API keypair private key (hex-encoded)"
    )
    # Internal API (service-to-service between TS API and Python)
    internal_api_key: str = Field(default="", description="Shared secret for internal API calls")

    turnkey_base_url: str = Field(
        default="https://api.turnkey.com", description="Turnkey API base URL"
    )
    turnkey_default_evm_curve: str = Field(
        default="CURVE_SECP256K1", description="Default curve for EVM wallets"
    )
    turnkey_default_solana_curve: str = Field(
        default="CURVE_ED25519", description="Default curve for Solana wallets"
    )

    # Turnkey Fallback Signing
    turnkey_fallback_enabled: bool = Field(
        default=True, description="Enable fallback to local signing when Turnkey is unavailable"
    )
    turnkey_fallback_mode: str = Field(
        default="auto",
        description="Fallback mode: 'auto' (circuit breaker), 'manual' (always local), 'disabled'",
    )
    turnkey_circuit_breaker_threshold: int = Field(
        default=3,
        description="Number of consecutive Turnkey failures before opening circuit breaker",
    )
    turnkey_circuit_breaker_recovery_seconds: int = Field(
        default=300, description="Seconds to wait before testing if Turnkey recovered"
    )

    # OAuth Configuration (Google + Twitter)
    google_client_id: Optional[str] = Field(default=None, description="Google OAuth 2.0 client ID")
    google_client_secret: Optional[str] = Field(
        default=None, description="Google OAuth 2.0 client secret"
    )
    twitter_client_id: Optional[str] = Field(
        default=None, description="Twitter/X OAuth 2.0 client ID"
    )
    twitter_client_secret: Optional[str] = Field(
        default=None, description="Twitter/X OAuth 2.0 client secret"
    )
    oauth_redirect_base: str = Field(
        default="http://localhost:3000",
        description="Base URL for OAuth redirect URIs (e.g., https://app.suwappu.com)",
    )
    webauthn_rp_id: str = Field(
        default="suwappu.bot",
        description=(
            "WebAuthn Relying Party ID for Turnkey passkeys. MUST be a registrable domain "
            "suffix of the page origin: 'suwappu.bot' is valid for app./terminal./www. "
            "subdomains, so one passkey works across all of them. Decoupled from "
            "oauth_redirect_base on purpose (that one defaults to localhost:3000, which is an "
            "invalid rpId for prod and broke passkey connect). Set to 'localhost' for local dev."
        ),
    )
    passkey_auth_enabled: bool = Field(
        default=False,
        description=(
            "Master switch for /auth/passkey/* endpoints. DISABLED by default because the "
            "current register/complete + authenticate/complete handlers do NOT verify the "
            "WebAuthn attestation/assertion signature (no COSE public key is stored at "
            "registration), so possession of a Redis challenge alone yields a session JWT for "
            "any credentialId — an account-takeover hole. Keep False until real verification "
            "(py_webauthn) plus a public-key storage column are implemented. When False the "
            "endpoints return 503."
        ),
    )

    # Infura RPC (primary, reliable RPCs for all major chains)
    infura_api_key: Optional[str] = Field(
        default=None, description="Infura API key — used as primary RPC for supported chains"
    )

    # Alchemy Configuration (Full Suite)
    alchemy_api_key: Optional[str] = Field(
        default=None, description="Alchemy API key for enhanced RPC, Token API, NFT API"
    )
    alchemy_webhook_auth_token: Optional[str] = Field(
        default=None, description="Alchemy webhook authentication token"
    )
    alchemy_network_overrides: Optional[str] = Field(
        default=None, description="JSON map of chain->network overrides for Alchemy"
    )

    # JWT Configuration
    jwt_secret_key: Optional[str] = Field(
        default=None, description="Secret key for JWT signing (auto-generated if not set)"
    )
    jwt_expiry_hours: int = Field(
        default=168, description="JWT token expiry in hours (default: 7 days)"
    )

    # EVM RPC Endpoints — sourced from chainlist.org, no API keys needed
    # Infura/Alchemy are prepended automatically when keys are set
    ethereum_rpc_url: str = Field(
        default="https://ethereum-rpc.publicnode.com,https://1rpc.io/eth,https://eth.drpc.org,https://eth.llamarpc.com",
        description="Ethereum mainnet RPC URL(s)",
    )
    bsc_rpc_url: str = Field(
        default="https://bsc-dataseed.binance.org,https://bsc-rpc.publicnode.com,https://1rpc.io/bnb,https://bsc.drpc.org",
        description="BSC mainnet RPC URL(s)",
    )
    polygon_rpc_url: str = Field(
        default="https://polygon-bor-rpc.publicnode.com,https://1rpc.io/matic,https://polygon.drpc.org",
        description="Polygon mainnet RPC URL(s)",
    )
    arbitrum_rpc_url: str = Field(
        default="https://arb1.arbitrum.io/rpc,https://arbitrum-one-rpc.publicnode.com,https://1rpc.io/arb,https://arbitrum.drpc.org",
        description="Arbitrum mainnet RPC URL(s)",
    )
    optimism_rpc_url: str = Field(
        default="https://mainnet.optimism.io,https://optimism-rpc.publicnode.com,https://1rpc.io/op,https://optimism.drpc.org",
        description="Optimism mainnet RPC URL(s)",
    )
    base_rpc_url: str = Field(
        default="https://mainnet.base.org,https://base-rpc.publicnode.com,https://1rpc.io/base,https://base.drpc.org",
        description="Base mainnet RPC URL(s)",
    )
    avalanche_rpc_url: str = Field(
        default="https://api.avax.network/ext/bc/C/rpc,https://avalanche-c-chain-rpc.publicnode.com,https://1rpc.io/avax/c,https://avalanche.drpc.org",
        description="Avalanche C-Chain RPC URL(s)",
    )
    fantom_rpc_url: str = Field(
        default="https://rpcapi.fantom.network,https://fantom-rpc.publicnode.com,https://1rpc.io/ftm,https://fantom.drpc.org,https://rpc.ftm.tools",
        description="Fantom mainnet RPC URL(s)",
    )
    linea_rpc_url: str = Field(
        default="https://rpc.linea.build,https://linea-rpc.publicnode.com,https://1rpc.io/linea,https://linea.drpc.org,https://linea.blockpi.network/v1/rpc/public",
        description="Linea mainnet RPC URL(s)",
    )
    mantle_rpc_url: str = Field(
        default="https://rpc.mantle.xyz,https://mantle-rpc.publicnode.com,https://1rpc.io/mantle,https://mantle.drpc.org",
        description="Mantle mainnet RPC URL(s)",
    )
    gnosis_rpc_url: str = Field(
        default="https://rpc.gnosischain.com,https://gnosis-rpc.publicnode.com,https://1rpc.io/gnosis,https://gnosis.drpc.org",
        description="Gnosis Chain RPC URL(s)",
    )
    scroll_rpc_url: str = Field(
        default="https://rpc.scroll.io,https://scroll-rpc.publicnode.com,https://1rpc.io/scroll,https://scroll.drpc.org,https://scroll.blockpi.network/v1/rpc/public",
        description="Scroll mainnet RPC URL(s)",
    )
    tempo_rpc_url: str = Field(
        default="https://tempo-mainnet.drpc.org,https://rpc.tempo.xyz",
        description="Tempo mainnet RPC URL(s)",
    )
    goat_rpc_url: Optional[str] = Field(
        default="https://rpc.goat.network",
        description="GOAT Network (Bitcoin L2, chain id 2345) RPC URL",
    )
    rootstock_rpc_url: str = Field(
        default="https://public-node.rsk.co",
        description="Rootstock (Bitcoin sidechain, chain id 30) RPC URL(s)",
    )
    citrea_rpc_url: str = Field(
        default="https://rpc.mainnet.citrea.xyz",
        description="Citrea (Bitcoin ZK rollup, chain id 4114) RPC URL(s)",
    )

    # New Li.Fi chains (RPCManager auto-discovers from chainlist.org)
    sonic_rpc_url: str = Field(default="https://rpc.soniclabs.com", description="Sonic RPC")
    opbnb_rpc_url: str = Field(
        default="https://opbnb-mainnet-rpc.bnbchain.org", description="opBNB RPC"
    )
    fraxtal_rpc_url: str = Field(default="https://rpc.frax.com", description="Fraxtal RPC")
    zksync_rpc_url: str = Field(
        default="https://mainnet.era.zksync.io", description="zkSync Era RPC"
    )
    worldchain_rpc_url: str = Field(
        default="https://worldchain-mainnet.g.alchemy.com/public", description="World Chain RPC"
    )
    flow_rpc_url: str = Field(
        default="https://mainnet.evm.nodes.onflow.org", description="Flow RPC"
    )
    hyperevm_rpc_url: str = Field(
        default="https://rpc.hyperliquid.xyz/evm", description="HyperEVM RPC"
    )

    # HyperLiquid builder codes — Suwappu earns a builder fee on perp orders routed
    # through it. The builder wallet must accrue $1k of trading volume before
    # HyperLiquid permits fee collection (see check_builder_eligibility).
    hl_builder_address: Optional[str] = Field(
        default=None,
        description="Suwappu's HyperLiquid builder wallet (EVM address). Unset = no builder fee.",
    )
    hl_builder_fee_tenths_bps: int = Field(
        default=10,
        description=(
            "Builder fee attached to each perp order, in tenths of a basis point "
            "(10 = 1 bp = 0.01%). Must not exceed hl_builder_max_fee_rate."
        ),
    )
    hl_builder_max_fee_rate: str = Field(
        default="0.1%",
        description="Max builder fee rate users approve (percent string, e.g. '0.1%').",
    )

    lisk_rpc_url: str = Field(default="https://rpc.api.lisk.com", description="Lisk RPC")
    sei_rpc_url: str = Field(default="https://evm-rpc.sei-apis.com", description="Sei RPC")
    soneium_rpc_url: str = Field(default="https://rpc.soneium.org", description="Soneium RPC")
    swellchain_rpc_url: str = Field(
        default="https://swell-mainnet.alt.technology", description="Swellchain RPC"
    )
    abstract_rpc_url: str = Field(default="https://api.mainnet.abs.xyz", description="Abstract RPC")
    kaia_rpc_url: str = Field(default="https://public-en.node.kaia.io", description="Kaia RPC")
    apechain_rpc_url: str = Field(
        default="https://rpc.apechain.com/http", description="Apechain RPC"
    )
    mode_rpc_url: str = Field(default="https://mainnet.mode.network", description="Mode RPC")
    hemi_rpc_url: str = Field(default="https://rpc.hemi.network/rpc", description="Hemi RPC")
    bob_rpc_url: str = Field(default="https://rpc.gobob.xyz", description="BOB RPC")
    berachain_rpc_url: str = Field(default="https://rpc.berachain.com", description="Berachain RPC")
    taiko_rpc_url: str = Field(default="https://rpc.mainnet.taiko.xyz", description="Taiko RPC")
    unichain_rpc_url: str = Field(
        default="https://mainnet.unichain.org", description="Unichain RPC"
    )
    flare_rpc_url: str = Field(
        default="https://flare-api.flare.network/ext/C/rpc", description="Flare RPC"
    )

    # Solana RPC
    solana_rpc_url: str = Field(
        default="https://api.mainnet-beta.solana.com,https://solana-mainnet.rpc.extrnode.com",
        description="Solana mainnet RPC URL(s)",
    )

    # TRON RPC
    tron_rpc_url: str = Field(
        default="https://api.trongrid.io", description="TRON mainnet RPC URL(s)"
    )

    # Starknet RPC (Alchemy primary, Lava fallback — see starknet plan doc)
    starknet_rpc_url: Optional[str] = Field(
        default=None,
        description=(
            "Starknet mainnet RPC URL (e.g. Alchemy "
            "https://starknet-mainnet.g.alchemy.com/v2/$KEY). Falls back to "
            "starknet_rpc_fallback_url when unset or unhealthy."
        ),
    )
    starknet_rpc_fallback_url: str = Field(
        default="https://rpc.starknet.lava.build",
        description="Starknet fallback RPC (Lava, keyless, verified live)",
    )
    starknet_chain_id: str = Field(
        default="mainnet",
        description="Starknet chain: 'mainnet' (SN_MAIN) or 'sepolia' (SN_SEPOLIA)",
    )

    # AVNU (Starknet swap aggregator)
    avnu_integrator_fee_bps: int = Field(
        default=100,
        description=(
            "FALLBACK AVNU integrator fee in basis points, used ONLY if avnu_api "
            "is called without a resolved fee. The live swap path always passes "
            "the tier-based fee from fee_service.get_fee_bps(tier) (the single "
            "source of truth), so this default is not hit in practice. Aligned to "
            "100 bps (1%) = the canonical no-tier default (fee_service."
            "DEFAULT_FEE_RATE) so a stray direct call can't charge a different rate."
        ),
    )
    avnu_fee_recipient: Optional[str] = Field(
        default=None,
        description="Starknet address that receives the AVNU integrator fee",
    )
    avnu_paymaster_api_key: Optional[str] = Field(
        default=None,
        description=(
            "AVNU paymaster API key — when set, paymaster requests use sponsored "
            "fee mode (we pay gas); when unset, default mode (user pays gas in an "
            "accepted token)"
        ),
    )
    starknet_paymaster_url: str = Field(
        default="https://starknet.paymaster.avnu.fi",
        description=(
            "AVNU SNIP-29 paymaster JSON-RPC endpoint (override with "
            "https://sepolia.paymaster.avnu.fi for testing)"
        ),
    )
    starknet_paymaster_enabled: bool = Field(
        default=True,
        description=(
            "Route Starknet account deploys/invokes through the AVNU paymaster "
            "when possible (always falls back to self-paid STRK gas on failure)"
        ),
    )

    # Atomiq BTC bridge (Lightning/BTC ↔ Starknet — Phase 3)
    atomiq_api_url: str = Field(
        default="https://mainnet.swaps-api.atomiq.exchange",
        description=(
            "Atomiq REST execution API base URL (no auth; testnet4 variant " "exists for testing)"
        ),
    )
    starknet_btc_bridge_enabled: bool = Field(
        default=True,
        description=(
            "Enable the Atomiq BTC bridge background poller (Lightning→Starknet "
            "deposits and Starknet→BTC/Lightning withdrawals)"
        ),
    )
    atomiq_escrow_contracts: str = Field(
        default="",
        description=(
            "Comma-separated allowlist of Atomiq escrow contract addresses "
            "(Starknet) that SignSmartChainTransaction INVOKEs may target"
        ),
    )
    btc_deposit_default_token: str = Field(
        default="STARKNET-WBTC",
        description="Default Starknet token received from BTC/Lightning deposits",
    )

    # Morpho Blue on Base (cbBTC-collateralized USDC borrowing + USDC earn vaults)
    morpho_enabled: bool = Field(
        default=True,
        description="Enable the Morpho borrow product and its health-factor monitor",
    )
    morpho_vault_default: str = Field(
        default="0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        description="Default MetaMorpho USDC earn vault on Base (Steakhouse USDC)",
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

        Returns None for chains not supported by Alchemy (e.g. BSC).
        """
        # Default Alchemy network mappings
        alchemy_networks = {
            "ethereum": "eth-mainnet",
            "polygon": "polygon-mainnet",
            "arbitrum": "arb-mainnet",
            "optimism": "opt-mainnet",
            "base": "base-mainnet",
            "solana": "solana-mainnet",
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

    # TronGrid API Key (optional for higher rate limits)
    trongrid_api_key: Optional[str] = Field(
        default=None, description="TronGrid API key for higher rate limits"
    )

    # API Keys (optional for higher rate limits)
    lifi_api_key: Optional[str] = Field(default=None, description="Li.Fi API key")
    lifi_integrator_id: str = Field(
        default="SuwappuProduction", description="Li.Fi integrator ID for fee collection"
    )
    jupiter_api_key: Optional[str] = Field(default=None, description="Jupiter API key")
    socket_api_key: Optional[str] = Field(
        default=None, description="Socket/Bungee API key for super-aggregation"
    )

    # OKX DEX Aggregator
    okx_dex_api_key: Optional[str] = Field(default=None, description="OKX DEX API key")
    okx_dex_secret_key: Optional[str] = Field(
        default=None, description="OKX DEX secret key for HMAC signing"
    )
    okx_dex_passphrase: Optional[str] = Field(default=None, description="OKX DEX API passphrase")
    okx_dex_project_id: Optional[str] = Field(default=None, description="OKX DEX project ID")

    # 1inch Aggregation Protocol (EVM-only, v6)
    oneinch_api_key: Optional[str] = Field(
        default=None, description="1inch Developer Portal API key (Bearer auth)"
    )

    # 0x Swap API v2 (allowance-holder, EVM-only)
    zerox_api_key: Optional[str] = Field(
        default=None, description="0x Dashboard API key (0x-api-key header)"
    )

    # KyberSwap Aggregator (EVM-only, no API key). Gated behind an explicit
    # enable flag (not a key) so it ships dark and has a no-redeploy kill switch
    # — execution is verified for quote+build but not yet run on-chain.
    kyberswap_enabled: bool = Field(
        default=False, description="Enable KyberSwap in the best-price race (no API key needed)"
    )
    kyberswap_client_id: str = Field(
        default="suwappu-bot",
        description="KyberSwap x-client-id header (free identifier, avoids anon 429s)",
    )

    # WhatsApp Business API (Optional)
    whatsapp_phone_number_id: Optional[str] = Field(
        default=None, description="WhatsApp Business Phone Number ID"
    )
    whatsapp_access_token: Optional[str] = Field(
        default=None, description="WhatsApp Cloud API Access Token"
    )
    whatsapp_verify_token: Optional[str] = Field(
        default=None, description="Webhook verification token — must be set explicitly"
    )
    whatsapp_app_secret: Optional[str] = Field(
        default=None,
        description="Meta App Secret — used to verify X-Hub-Signature-256 on inbound webhooks. "
        "When set, unsigned/forged requests are rejected (fail-closed).",
    )
    whatsapp_business_phone: Optional[str] = Field(
        default=None,
        description="E.164 business number digits (no '+') for wa.me referral links — distinct "
        "from whatsapp_phone_number_id (Meta's numeric API id)",
    )

    # Discord Bot
    discord_bot_token: Optional[str] = Field(default=None, description="Discord bot token")
    discord_guild_ids: Optional[str] = Field(
        default=None, description="Comma-separated guild IDs for slash command sync"
    )
    discord_whale_channel_id: Optional[str] = Field(
        default=None, description="Channel ID for whale alerts"
    )
    discord_trending_channel_id: Optional[str] = Field(
        default=None, description="Channel ID for trending tokens"
    )
    discord_leaderboard_channel_id: Optional[str] = Field(
        default=None, description="Channel ID for leaderboard posts"
    )
    discord_alerts_channel_id: Optional[str] = Field(
        default=None, description="Channel ID for general alerts"
    )
    discord_forum_channel_id: Optional[str] = Field(
        default=None, description="Forum channel ID for token analysis"
    )
    discord_admin_role_id: Optional[str] = Field(default=None, description="Admin role ID")
    discord_vip_role_ids: Optional[str] = Field(
        default=None, description="Comma-separated VIP role IDs"
    )

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
        default="https://app.suwappu.bot", description="URL for the Telegram Mini App dashboard"
    )

    # Agent Interoperability
    agent_api_key: Optional[str] = Field(
        default=None, description="Secret key for other AI agents to access the API"
    )

    # Admin API (for dashboard / ops tooling)
    admin_api_key: Optional[str] = Field(
        default=None, description="Secret key for admin dashboard access"
    )
    admin_telegram_ids: str = Field(
        default="", description="Comma-separated Telegram user IDs for admin access"
    )

    # Application Settings
    log_level: str = Field(default="INFO", description="Logging level")
    max_swap_amount: float = Field(default=100000, description="Maximum swap amount in USD")
    default_slippage: float = Field(default=0.5, description="Default slippage tolerance in %")
    default_output_token: str = Field(
        default="USDC",
        description="Global default output token for sell-to operations (e.g. USDC, ETH)",
    )
    default_tx_speed: str = Field(
        default="normal",
        description="Global default transaction speed preset: slow | normal | fast",
    )
    approval_mode: str = Field(
        default="unlimited",
        description=(
            "ERC-20 approval policy for swap routers: 'unlimited' (max uint256, fewer txs) "
            "or 'exact' (approve only the swap amount each time, safer)"
        ),
    )

    # Polymarket API (optional — for pre-configured CLOB credentials)
    polymarket_clob_api_key: Optional[str] = Field(
        default=None, description="Polymarket CLOB API key (optional)"
    )
    polymarket_clob_secret: Optional[str] = Field(
        default=None, description="Polymarket CLOB API secret (optional)"
    )
    polymarket_clob_passphrase: Optional[str] = Field(
        default=None, description="Polymarket CLOB API passphrase (optional)"
    )

    # Fee Configuration (competitive pricing)
    # NOTE: this is a LEGACY flat-fee setting. It is NOT used to charge swaps —
    # the charged fee is tier-based via fee_service.TIER_FEE_RATES (the single
    # source of truth: FREE 1% / PRO 0.5% / PREMIUM 0.3% / ENTERPRISE 0.1%). This
    # value is only surfaced in the admin /fee panel. Aligned to 1.0 so the admin
    # display matches the canonical FREE-tier default rather than a stale 0.8%.
    swap_fee_percentage: float = Field(
        default=1.0,
        description=(
            "LEGACY flat swap fee % — display-only (admin /fee panel). Real fee is "
            "tier-based in fee_service.TIER_FEE_RATES. Default 1.0% = FREE tier."
        ),
    )
    referral_reward_percentage: float = Field(
        default=30, description="Referral reward percentage (30% of fees)"
    )
    fee_collector_address: Optional[str] = Field(
        default=None, description="EVM address for fee collection"
    )
    fee_collector_solana: Optional[str] = Field(
        default=None, description="Solana address for fee collection"
    )
    jupiter_referral_account: Optional[str] = Field(
        default=None,
        description=(
            "Jupiter Referral Program token account (ATA) used as feeAccount on swaps. "
            "MUST be a referral token account created via the Jupiter Referral Program "
            "(program 45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp) for the fee mint — "
            "a plain wallet will cause /swap to fail. Leave unset to disable Solana fee "
            "collection (swaps still work, no platform fee taken)."
        ),
    )
    jupiter_referral_fee_mint: Optional[str] = Field(
        default=None,
        description=(
            "The token mint that jupiter_referral_account holds (e.g. wSOL "
            "So11111111111111111111111111111111111111112 or USDC). Jupiter requires "
            "the feeAccount's mint to be the input OR output mint of the swap, so the "
            "platform fee is only applied when this mint is one side of the pair — "
            "otherwise the swap proceeds with no fee (rather than failing). Set together "
            "with jupiter_referral_account."
        ),
    )
    jupiter_referral_accounts: Optional[str] = Field(
        default=None,
        description=(
            "JSON map of {mint: referralTokenAccount} for collecting Solana fees on "
            "MULTIPLE mints, e.g. "
            '{"So11111111111111111111111111111111111111112":"<wSOL acct>",'
            '"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v":"<USDC acct>"}. '
            "Each must be a Jupiter Referral Program token account for that exact mint. "
            "Merged with the legacy single jupiter_referral_account pair. wSOL covers "
            "the SOL-paired trades that are most of Solana volume."
        ),
    )

    # Treasury Vault (Aave v3 on Base)
    aave_enabled: bool = Field(
        default=False,
        description="Enable actual on-chain Aave v3 interactions (false = mock/safe mode)",
    )
    vault_type: str = Field(default="aave", description="Vault backend: 'aave' or 'morpho'")
    morpho_vault_address: Optional[str] = Field(
        default=None, description="Morpho MetaMorpho vault address (ERC-4626)"
    )
    treasury_vault_hot_wallet_name: str = Field(
        default="treasury_vault",
        description="Name of the HotWallet DB record used to sign vault transactions",
    )
    vault_min_deposit_usdc: float = Field(
        default=50.0, description="Minimum USDC to trigger an automatic vault deposit"
    )
    distribution_wallet_address: Optional[str] = Field(
        default=None, description="Address to receive yield withdrawals for distribution"
    )
    staking_contract_address: Optional[str] = Field(
        default=None,
        description="Deployed SuwppuStaking contract address on Base (used by fundStream / distributeSuwpBonus)",
    )
    bonds_contract_address: Optional[str] = Field(
        default=None,
        description="Deployed SuwppuBonds contract address on Base (protocol-owned liquidity bonding)",
    )

    model_config = ConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance.

    Validates that KMS is properly configured when a production KMS provider
    is selected.  A silent fallback to legacy Fernet encryption would mean
    wallets are encrypted with a weaker scheme without any warning.
    """
    s = Settings()
    if s.kms_provider in ("aws", "gcp"):
        if not s.kms_key_id:
            raise ValueError(
                f"KMS_KEY_ID (or KMS_KEY_ARN) is required when KMS_PROVIDER={s.kms_provider!r}. "
                "Set it in your environment or switch to KMS_PROVIDER=dev for local development."
            )
        if s.kms_provider == "aws" and not s.kms_region:
            raise ValueError(
                "KMS_REGION is required when KMS_PROVIDER='aws' (e.g. KMS_REGION=us-east-1)."
            )
        if s.kms_provider == "gcp" and not s.gcp_project_id:
            raise ValueError("GCP_PROJECT_ID is required when KMS_PROVIDER='gcp'.")
    return s


settings = get_settings()
