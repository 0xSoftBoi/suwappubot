from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict, field_validator
from typing import ClassVar, Dict, Optional, List
from functools import lru_cache
import os
import random


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Telegram
    telegram_bot_token: str = Field(..., description="Telegram bot token from BotFather")
    telegram_bot_username: str = Field(
        default="suwappubot",
        description="Telegram bot @username (without @), used for referral deep-links",
    )
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
        default=256,
        description=(
            "Max concurrent Telegram updates (per-user serialized). "
            "Defaults to 256; set 0 to use sequential PTB processing."
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
        description=(
            "Allowed post-login redirect origins. MAY be a comma-separated LIST — "
            "_is_allowed_redirect() splits it. Use oauth_callback_base (below) "
            "wherever a SINGLE URL is needed; using this value raw builds a "
            "malformed URI when it holds a list."
        ),
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

    # Helius (Solana RPC/DAS/Enhanced Transactions). SERVER-ONLY — proxied via
    # /webapp/solana/* so the key never reaches the client bundle.
    helius_api_key: str = Field(
        default="", description="Helius API key for the server-side Solana data proxy"
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
    # eth.llamarpc.com removed: it answers HTTP 403 for unauthenticated callers
    # (measured), so it only burned a failover slot and intermittently made
    # Ethereum reads fail — a USDT0 quoteSend on ethereum returned no route
    # because of it. See the matching note in rpc_manager.TRUSTED_RPC_DOMAINS.
    ethereum_rpc_url: str = Field(
        default="https://ethereum-rpc.publicnode.com,https://1rpc.io/eth,https://eth.drpc.org",
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
    base_sepolia_rpc_url: str = Field(
        default="https://sepolia.base.org,https://base-sepolia-rpc.publicnode.com",
        description="Base Sepolia testnet RPC URL(s) — used for native P2P escrow testing",
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
    tempo_fee_sponsor_enabled: bool = Field(
        default=False,
        description=(
            "Enable gasless (fee-payer) Tempo swaps. When True AND a sponsor "
            "wallet is configured, the bot counter-signs Tempo type-0x76 swaps "
            "as fee payer so new users pay no gas. Default off → users pay."
        ),
    )
    tempo_fee_sponsor_wallet_name: str = Field(
        default="tempo_fee_sponsor",
        description=(
            "Name of the HotWallet DB record whose key counter-signs Tempo "
            "sponsored swaps as fee payer (pays gas in pathUSD)."
        ),
    )
    mpp_enabled: bool = Field(
        default=False,
        description=(
            "Enable the MPP (Machine Payments Protocol) surface — the /mpp "
            "command and the browse_mpp_directory MCP tool. Default OFF: as of "
            "2026-07-26 api.mpp.dev and directory.mpp.dev do not resolve "
            "(NXDOMAIN), so every MPP call fails. Only turn this on once the "
            "hosts in mpp_api_base / mpp_directory_url are confirmed live."
        ),
    )
    mpp_api_base: str = Field(
        default="https://api.mpp.dev/v1",
        description="MPP API base URL. Override if the protocol ships on a different host.",
    )
    mpp_directory_url: str = Field(
        default="https://directory.mpp.dev/v1",
        description="MPP service-directory base URL.",
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
    # Plasma had NO endpoint from any source: chainlist discovery never offered
    # one and there was no configured default, so rpc_manager raised
    # "No RPC endpoints for plasma". That silently made the arbitrum<->plasma
    # USDT0 corridor unquotable — the corridor USDT0 exists for on Plasma, which
    # has no native USDT deployment. rpc.plasma.to verified serving chainId
    # 0x2611 (9745), matching chains.py.
    plasma_rpc_url: str = Field(
        default="https://rpc.plasma.to", description="Plasma mainnet RPC URL(s)"
    )
    robinhood_rpc_url: str = Field(
        default="https://rpc.mainnet.chain.robinhood.com",
        description="Robinhood Chain mainnet (Arbitrum Orbit, chain id 4663) RPC URL(s)",
    )

    # HyperLiquid builder codes — Suwappu earns a builder fee on perp orders routed
    # through it. The builder wallet must accrue $1k of trading volume before
    # HyperLiquid permits fee collection (see check_builder_eligibility).
    hl_builder_address: Optional[str] = Field(
        default=None,
        description="Suwappu's HyperLiquid builder wallet (EVM address). Unset = no builder fee.",
    )
    hl_builder_private_key: Optional[str] = Field(
        default=None,
        description=(
            "Private key of the builder wallet — required only to claim accrued "
            "builder fees (claimRewards). Keep secret; not needed to charge fees."
        ),
    )
    hl_referral_code: Optional[str] = Field(
        default=None,
        description=(
            "Suwappu's HyperLiquid referral code, auto-attached to users on their "
            "first perp trade so Suwappu earns referral rewards. Unset = disabled."
        ),
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

    # HyperLiquid funding — one-click cross-chain deposits into a user's
    # HyperCore account. USDC routes via the Across Swap API (chain 1337);
    # native BTC/ETH/SOL route via HyperUnit. See bot/services/hyperliquid_funding.py.
    across_integrator_id: Optional[str] = Field(
        default=None,
        description="Across integrator id for the Swap API (attribution). Unset = omitted.",
    )
    # NEAR Intents 1-Click API (https://1click.chaindefuser.com) — deposit-address/
    # solver-filled bridge. Unset = provider disabled (enabled property returns False).
    near_intents_api_key: Optional[str] = Field(
        default=None,
        description="NEAR Intents 1-Click API key. Unset = provider disabled.",
    )
    near_intents_fee_recipient: Optional[str] = Field(
        default=None,
        description="Address that receives NEAR Intents appFee referral cut, if configured.",
    )
    near_intents_fee_bps: int = Field(
        default=0,
        description="NEAR Intents appFee cut in basis points (0-100). Must be a NEAR-side "
        "recipient account; appFees are skipped if near_intents_fee_recipient is not a "
        "plausible NEAR account id.",
    )
    # Allbridge Core public REST API — no API key required. Still gated OFF by
    # default until a live small-amount transfer has been verified end-to-end.
    allbridge_bridge_enabled: bool = Field(
        default=False,
        description="Enable the Allbridge Core bridge provider. Default OFF until a live "
        "small-amount transfer is verified.",
    )
    symbiosis_bridge_enabled: bool = Field(
        default=False,
        description="Enable the Symbiosis Finance bridge provider. Default OFF until a live "
        "small-amount transfer is verified.",
    )
    arbitrum_native_bridge_enabled: bool = Field(
        default=False,
        description="Enable the Arbitrum native canonical deposit bridge. Default OFF: "
        "get_quote refuses to emit a quote until live L2 gas params (maxSubmissionCost/"
        "maxGas/gasPriceBid via NodeInterface.estimateRetryableTicket) are wired in.",
    )
    # USDT0 (LayerZero OFT canonical USDT). Addresses/EIDs are verified on-chain
    # (scripts/verify_onchain_constants.py) and both the quote path and the
    # executor are wired, so flipping this is all that stands between here and a
    # live transfer -- hence still OFF until one small transfer per direction has
    # been run, including one through the Ethereum lockbox leg (the only leg with
    # an ERC20 approve step).
    usdt0_bridge_enabled: bool = Field(
        default=False,
        description="Enable the USDT0 (LayerZero OFT) bridge provider. Default OFF until a "
        "live small-amount transfer is verified in both directions.",
    )
    allbridge_api_url: str = Field(
        default="https://core.api.allbridgecoreapi.net",
        description="Allbridge Core API base URL (public, no key required).",
    )
    across_api_key: Optional[str] = Field(
        default=None,
        description=(
            "Across Swap API key (sent as Bearer). Required for production "
            "rate limits; quotes work without it in dev/testnet."
        ),
    )

    # CCTP V2 native-USDC deposit relayer (completes burns on HyperEVM). The
    # relayer wallet pays HYPE gas for the destination mint + a small gas-drop so
    # the user's custodial wallet can credit HyperCore. DISABLED by default —
    # only enable once the relayer wallet is funded with HYPE and tested.
    cctp_relayer_enabled: bool = Field(
        default=False,
        description="Enable the CCTP->HyperCore deposit relayer + the CCTP funding option.",
    )
    cctp_relayer_private_key: Optional[str] = Field(
        default=None,
        description="Private key of the HYPE-funded relayer wallet on HyperEVM (hex).",
    )
    cctp_relayer_gas_drop_hype: float = Field(
        default=0.02,
        description="HYPE gas-dropped to a user's HyperEVM address to fund their Core-credit tx.",
    )
    cctp_relayer_min_hype_alert: float = Field(
        default=0.5,
        description="Alert admins once when the relayer wallet's HYPE drops below this.",
    )

    # Regions (ISO-3166 alpha-2, comma-separated) where HyperUnit native deposits
    # are NOT offered — HyperUnit geo-blocks these. Users with an unknown region
    # are treated as restricted (feature hidden). Across/CCTP remain available.
    hyperunit_restricted_regions: str = Field(
        default="US",
        description="Comma-separated regions blocked from HyperUnit native deposits.",
    )
    # Non-US egress for HyperUnit (it geo-blocks the US). EITHER a reverse-proxy
    # base URL that forwards to api.hyperunit.xyz, OR a forward HTTP proxy. Must
    # be provisioned in a non-US region and only ever serves region-allowed users
    # (the fund handler gates that). Unset = call HyperUnit directly.
    hyperunit_egress_url: Optional[str] = Field(
        default=None,
        description="Non-US reverse-proxy base URL for HyperUnit (forwards to api.hyperunit.xyz).",
    )
    hyperunit_proxy_url: Optional[str] = Field(
        default=None,
        description="Non-US forward HTTP proxy for HyperUnit requests (e.g. http://host:port).",
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
        default="https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com",
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

    # Compliance screening for EVM swaps (UBS × Nethermind PoC model).
    # Screens every swap's recipient / router / token addresses before signing
    # at the SwapEngine.execute_swap choke point. OFF by default so existing
    # flows are unchanged. See docs/architecture/compliance-screening.md.
    compliance_mode: str = Field(
        default="disabled",
        description=(
            "Compliance gate behaviour: 'disabled' (no screening), 'monitor' "
            "(screen + log violations but allow), or 'enforce' (block "
            "non-compliant swaps)."
        ),
    )
    compliance_policy: str = Field(
        default="blocklist_only",
        description=(
            "Which lists apply: 'blocklist_only' (deny sanctioned/blocked "
            "addresses), 'allowlist_only' (deny anything not pre-approved), or "
            "'allowlist_and_blocklist' (both; blocklist wins)."
        ),
    )
    compliance_blocklist: str = Field(
        default="",
        description=(
            "Comma-separated EVM addresses to block, in addition to the bundled "
            "OFAC seed list (recipient/router/token interactions are refused)."
        ),
    )
    compliance_allowlist: str = Field(
        default="",
        description=(
            "Comma-separated EVM addresses that are pre-approved. Only consulted "
            "when compliance_policy includes an allowlist."
        ),
    )
    compliance_ofac_list_path: str = Field(
        default="",
        description=(
            "Optional path to a newline-delimited file of OFAC-sanctioned "
            "addresses, merged with the bundled seed list at load time."
        ),
    )

    # Compliant transaction routing (UBS × Nethermind PoC, stage 2): route
    # screened same-chain EVM swaps privately to block builders via the
    # Flashbots relay instead of the public mempool. Falls back to public RPC
    # on any error, so it can never break a swap. OFF by default.
    compliance_routing_enabled: bool = Field(
        default=False,
        description=(
            "Route screened same-chain EVM swap transactions privately via the "
            "Flashbots relay (eth_sendPrivateTransaction) instead of the public "
            "mempool. Falls back to public RPC on any relay error."
        ),
    )
    flashbots_relay_url: str = Field(
        default="https://relay.flashbots.net",
        description="Flashbots-compatible relay endpoint for private tx submission.",
    )
    flashbots_signer_key: str = Field(
        default="",
        description=(
            "Hex private key used ONLY to sign the Flashbots auth header "
            "(identity/reputation; never holds funds). Ephemeral if empty."
        ),
    )
    compliance_routing_chain_ids: str = Field(
        default="1",
        description=(
            "Comma-separated EVM chain IDs whose swaps route through the relay "
            "(default '1' = Ethereum mainnet)."
        ),
    )
    flashbots_max_block_offset: int = Field(
        default=25,
        description=(
            "How many future blocks a privately-routed tx stays valid for "
            "(maxBlockNumber = current + offset)."
        ),
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

    # HyperLiquid real-time WebSocket alert feed (fills / liquidations / funding / whales).
    # Connects to wss://api.hyperliquid.xyz/ws and pushes Telegram alerts. OFF by default.
    hl_ws_alerts_enabled: bool = Field(
        default=True,
        description="Enable the HyperLiquid WebSocket alert feed (per-user fills/liquidations/funding).",
    )
    hl_whale_alerts_enabled: bool = Field(
        default=True,
        description="Enable HyperLiquid whale-trade alerts (large single trades on major coins).",
    )
    hl_whale_alert_threshold_usd: float = Field(
        default=1_000_000.0,
        description="Minimum single-trade notional (USD) to emit a HyperLiquid whale alert.",
    )
    hl_whale_alert_coins: str = Field(
        default="BTC,ETH,SOL,HYPE",
        description="Comma-separated coins to watch for HyperLiquid whale trades.",
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
            # Confirmed live on Alchemy (alchemy.com/rpc/robinhood, 2026-08-04) —
            # not a guess. Robinhood Chain's 2-validator set (Offchain Labs +
            # Alchemy) makes a managed fallback worth having.
            "robinhood": "robinhood-mainnet",
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

    @property
    def oauth_callback_base(self) -> str:
        """The ONE origin OAuth providers redirect back to.

        ``oauth_redirect_base`` may hold a comma-separated allowlist of
        post-login destinations. The provider callback, by contrast, is a
        single URL that must match what is registered with the provider.

        Interpolating the raw list produced exactly this, which Google rejects
        with redirect_uri_mismatch and no usable error on our side:

            redirect_uri=https://a.example,https://b.example/auth/callback/google

        The first entry is canonical.
        """
        first = (self.oauth_redirect_base or "").split(",")[0].strip()
        return first.rstrip("/")

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
        default=True, description="Enable KyberSwap in the best-price race (no API key needed)"
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

    # Linear (support ticket sync — bot/services/support_notifier.py)
    linear_api_key: Optional[str] = Field(
        default=None, description="Linear API key used to create issues from support tickets"
    )
    linear_team_id: Optional[str] = Field(
        default=None, description="Linear team ID (UUID) that support-ticket issues are filed under"
    )

    # Resend (transactional email — bot/services/waitlist_email.py)
    resend_api_key: str = Field(
        default="", description="Resend API key used to send waitlist confirmation emails"
    )
    waitlist_email_from: str = Field(
        default="Suwappu <waitlist@suwappu.bot>",
        description="From address used for mobile waitlist confirmation emails",
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

    # Terminal (non-custodial trading web app, served on its own subdomain)
    terminal_url: str = Field(
        default="https://terminal.suwappu.bot",
        description="Base URL for the Suwappu terminal web app (client-side signing surface)",
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

    # Natural-language trade intent parsing (Anthropic). OFF by default — NL
    # parsing only ever produces a structured TradeIntent; it never quotes or
    # executes a swap itself (see bot/services/nl_intent_service.py and
    # bot/handlers/nl_trade.py, which hand off into the existing
    # CONFIRM_SWAP -> ENTER_2FA_CODE flow).
    ANTHROPIC_API_KEY: str = Field(
        default="", description="Anthropic API key for NL trade intent parsing"
    )
    NL_TRADING_ENABLED: bool = Field(
        default=False, description="Master switch for natural-language trade intent parsing"
    )
    AEGIS_ENABLED: bool = Field(
        default=True,
        description=(
            "AEGIS inbound threat scanner (observe mode — logs only, never blocks). "
            "See bot/services/aegis_service.py and docs/plans/aegis-fork-extend.md"
        ),
    )
    NL_TRADING_MODEL: str = Field(
        default="claude-haiku-4-5-20251001",
        description="Anthropic model used to parse natural-language trade intents",
    )
    NL_TRADING_PROVIDER: str = Field(
        default="anthropic",
        description="LLM provider for NL trade intent parsing: anthropic|openai|deepseek|groq|custom",
    )
    OPENAI_API_KEY: str = Field(
        default="", description="OpenAI API key for NL trade intent parsing"
    )
    DEEPSEEK_API_KEY: str = Field(
        default="", description="DeepSeek API key for NL trade intent parsing"
    )
    GROQ_API_KEY: str = Field(default="", description="Groq API key for NL trade intent parsing")
    NL_TRADING_BASE_URL: str = Field(
        default="",
        description="Optional override base_url for OpenAI-compatible NL trading providers",
    )
    NL_LLM_FALLBACK_PER_USER_DAILY: int = Field(
        default=30,
        description="Max LLM fallback calls (deterministic-parse misses) per user per day",
    )
    NL_LLM_FALLBACK_GLOBAL_DAILY: int = Field(
        default=5000,
        description="Max LLM fallback calls (deterministic-parse misses) globally per day",
    )

    # Multi-provider LLM (direct provider keys, no aggregator) + credit
    # metering. OFF by default: with the flag off, NL parsing keeps today's
    # single env-provider behavior and no credits are debited. See
    # bot/config/llm_providers.py, bot/config/llm_models.py,
    # bot/services/llm_credit_service.py.
    LLM_MULTI_PROVIDER_ENABLED: bool = Field(
        default=False,
        description="Route LLM calls per-user via the model catalog and meter paid models",
    )
    LLM_CREDIT_MARKUP: float = Field(
        default=1.5,
        description="Multiplier on provider list price when debiting api_credits for LLM usage",
    )
    LLM_BUDGET_PER_USER_DAILY_USD: float = Field(
        default=0.25,
        description=(
            "Rolling 24h per-user ceiling on RAW provider spend in USD (cost-weighted, "
            "Redis-backed, excludes LLM_CREDIT_MARKUP). This is the FREE-tier figure — "
            "PRO gets 5x, PREMIUM 20x, ENTERPRISE 100x. At FREE it buys roughly 850 "
            "deepseek-flash calls, 27 claude-sonnet, or 15 gpt-flagship. 0 disables."
        ),
    )
    LLM_BUDGET_GLOBAL_DAILY_USD: float = Field(
        default=25.0,
        description=(
            "Rolling 24h platform-wide ceiling on RAW provider spend in USD. Backstop "
            "against a coordinated drain; 0 disables the limit."
        ),
    )
    LLM_ALLOW_UNVERIFIED_PROVIDERS: bool = Field(
        default=False,
        description=(
            "Allow LLM providers whose forced-tool-call support is unverified "
            "(gemini/xai/qwen/kimi). Off by default: an unsupported tool_choice "
            "makes every parse silently degrade. Enable only after a live smoke test."
        ),
    )
    XAI_API_KEY: str = Field(default="", description="xAI (Grok) API key for LLM calls")
    GEMINI_API_KEY: str = Field(default="", description="Google Gemini API key for LLM calls")
    QWEN_API_KEY: str = Field(
        default="", description="Alibaba DashScope (Qwen) API key for LLM calls"
    )
    KIMI_API_KEY: str = Field(default="", description="Moonshot (Kimi) API key for LLM calls")

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

    # === Tempo native features (chain id 4217) ===
    # Tempo is first-class native: same-chain stablecoin swaps route through the
    # protocol-level enshrined DEX, NOT any external aggregator (none support 4217).
    tempo_swap_slippage_pct: float = Field(
        default=0.1,
        description=(
            "Slippage tolerance (%) applied to the enshrined-DEX min-out. Stablecoin "
            "pairs barely move, so a tight default avoids needless reverts."
        ),
    )
    tempo_use_permit: bool = Field(
        default=True,
        description=(
            "Use EIP-2612 permit (TIP-1004) for gasless token approval on Tempo swaps "
            "instead of a separate approve() tx. Local wallets only; falls back to "
            "approve() for Turnkey wallets or on any permit error."
        ),
    )
    # NOTE: there is deliberately NO `tempo_fee_sponsorship_enabled` /
    # `tempo_sponsor_address` here. Those two fields existed but had ZERO
    # consumers, while the real gate is `tempo_fee_sponsor_enabled` (above) and
    # the fee payer is resolved from a HotWallet DB row named by
    # `tempo_fee_sponsor_wallet_name` (see bot/services/tempo_keychain.py), NOT
    # from an env address. Keeping near-identical dead twins on a gasless money
    # path meant setting the wrong one looked like activation but changed
    # nothing. Removed 2026-07-26 — `extra="ignore"` makes any stale env var inert.
    # To actually enable sponsorship: create + fund the HotWallet row, then set
    # TEMPO_FEE_SPONSOR_ENABLED=true.
    tempo_sponsor_max_txs: int = Field(
        default=3, description="Max sponsored Tempo transactions per user."
    )
    tempo_sponsor_daily_budget_usd: float = Field(
        default=100.0, description="Daily Tempo fee-sponsorship budget in USD."
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
    polymarket_restricted_regions: Optional[str] = Field(
        default=None,
        description=(
            "Comma-separated ISO2 regions where Polymarket on-chain redemption is "
            "geo-blocked. Falls back to hyperunit_restricted_regions (default 'US') "
            "when unset."
        ),
    )

    # ── Gift Card marketplace (Bitrefill) ────────────────────────────────────
    # SCAFFOLD — blocked on a live Bitrefill merchant account.
    # Set BITREFILL_API_KEY to enable; leave unset to keep the feature dark.
    # See bot/services/giftcard_api.py and bot/handlers/giftcard.py.
    bitrefill_api_key: Optional[str] = Field(
        default=None,
        description=(
            "Bitrefill v4 API key — enables the /gift command. "
            "Obtain from https://www.bitrefill.com/api/. "
            "Unset = feature disabled (shows 'coming soon')."
        ),
    )
    bitrefill_api_secret: Optional[str] = Field(
        default=None,
        description=(
            "Bitrefill v4 API secret — used as the Basic-auth password alongside "
            "bitrefill_api_key. Some read-only endpoints work with key-only; "
            "order creation requires both key + secret."
        ),
    )

    # ── P2P marketplace ──────────────────────────────────────────────────────
    # Suwappu aggregates P2P fiat<>crypto liquidity across its own native
    # on-chain escrow book plus external providers. Each provider is gated on its
    # credentials being present; the native book always works.
    p2p_enabled: bool = Field(default=True, description="Master switch for P2P features")

    # Rewards marketplace (async gift-card/travel/merch/donation/experience fulfillment).
    # Ships DISABLED: with no provider configured, async redemptions are recorded and
    # immediately refunded (points never lost). Flip to True only once a real provider
    # (Tremendous/Bitrefill/Duffel) + compliance sign-off is wired. See
    # bot/services/reward_providers.py and docs/economics/REWARDS_MARKETPLACE.md.
    rewards_marketplace_enabled: bool = Field(
        default=False, description="Master switch for async rewards-marketplace fulfillment"
    )
    # NoOnes (dev.noones.com) — OAuth2 client-credentials API key/secret.
    noones_api_key: Optional[str] = Field(
        default=None, description="NoOnes API client id (dev.noones.com)"
    )
    noones_api_secret: Optional[str] = Field(default=None, description="NoOnes API client secret")
    noones_api_base: str = Field(
        default="https://api.noones.com", description="NoOnes API base URL"
    )
    # P2P.me — no public API yet; we deeplink/handoff and (later) call their API.
    p2p_me_api_key: Optional[str] = Field(
        default=None, description="P2P.me API key (when their API ships)"
    )
    p2p_me_api_base: str = Field(default="https://api.p2p.me", description="P2P.me API base URL")
    # Native escrow: USDC token + chain used to lock the crypto leg.
    p2p_escrow_chain: str = Field(default="base", description="Chain for native P2P USDC escrow")
    p2p_escrow_token: str = Field(
        default="USDC", description="Settlement asset for native P2P escrow"
    )
    p2p_escrow_hot_wallet_id: Optional[str] = Field(
        default=None,
        description=(
            "HotWallet id holding native P2P escrow funds (custodial-during-trade). "
            "Falls back to the primary EVM deposit hot wallet when unset."
        ),
    )
    # Comma-separated allowlist of chains on which native escrow may move funds.
    # Defaults to testnet only so an armed executor cannot touch mainnet funds
    # until native P2P is validated end-to-end. Set to "" to allow all chains,
    # or e.g. "base,base-sepolia" to enable mainnet.
    p2p_escrow_allowed_chains: str = Field(
        default="base-sepolia",
        description="Comma-separated chains native P2P escrow may settle on (empty = all)",
    )
    # Comma-separated ISO2 regions blocked from P2P (regulatory).
    p2p_restricted_regions: Optional[str] = Field(
        default=None, description="Comma-separated ISO2 regions blocked from P2P"
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

    # Battle treasury — sentinel user id for the house/treasury CustodialBalance account.
    # Must be a negative integer to guarantee no collision with real auto-increment user ids.
    # Override via BATTLE_TREASURY_USER_ID env var (must remain negative).
    battle_treasury_user_id: int = Field(
        default=-1,
        description=(
            "Sentinel user_id for the battle house/treasury CustodialBalance row. "
            "Must be negative (never collides with real user rows). "
            "Prediction battle stakes flow: user -> treasury at open; "
            "treasury -> user on WIN/VOID at settlement."
        ),
    )

    @field_validator("battle_treasury_user_id")
    @classmethod
    def _validate_battle_treasury_user_id(cls, v: int) -> int:
        """Enforce the negative-sentinel invariant documented above.

        A misconfigured non-negative BATTLE_TREASURY_USER_ID could collide with
        a real auto-increment users.id row, letting battle treasury debits/
        credits silently corrupt an actual user's CustodialBalance. Fail fast
        at settings load rather than at first battle open.
        """
        if v >= 0:
            raise ValueError(
                f"BATTLE_TREASURY_USER_ID must be negative (got {v}). "
                "A non-negative value can collide with a real users.id row."
            )
        return v

    # Sentry error tracking (optional — no-op unless SENTRY_DSN is set)
    sentry_dsn: Optional[str] = Field(
        default=None,
        description=(
            "Sentry DSN for error tracking. If unset, Sentry is never initialized "
            "(no-op, zero overhead) — safe for local dev, tests, and CI."
        ),
    )
    sentry_environment: str = Field(
        default_factory=lambda: os.environ.get("RAILWAY_ENVIRONMENT_NAME", "development"),
        description=(
            "Sentry environment tag (e.g. 'production', 'development'). "
            "Defaults from RAILWAY_ENVIRONMENT_NAME when running on Railway."
        ),
    )
    sentry_release: Optional[str] = Field(
        default=None,
        description="Sentry release identifier (e.g. git commit SHA). Optional.",
    )

    # Dead-man's switch — uptime probe heartbeats (env: MONITOR_HEARTBEAT_SECRET / _MAX_AGE_MINUTES)
    monitor_heartbeat_secret: Optional[str] = Field(
        default=None,
        description=(
            "Shared secret for POST /internal/monitor-heartbeat (?token=). "
            "If unset, the endpoint fails closed and rejects all requests."
        ),
    )
    monitor_heartbeat_max_age_minutes: int = Field(
        default=45,
        description=(
            "Alert admins if no monitor heartbeat has been seen in this many minutes. "
            "Must stay well above the ~10-minute probe interval to avoid flapping."
        ),
    )
    monitor_expected_sources: str = Field(
        default="github-actions,railway-cron",
        description=(
            "Comma-separated list of uptime-probe source names the dead-man's switch "
            "tracks individually, and the allow-list POST /internal/monitor-heartbeat "
            "coerces unrecognized `source` values into 'unknown' against. Keeps one "
            "healthy scheduler from masking another's failure, and bounds the set of "
            "Redis keys a token holder can mint."
        ),
    )

    def monitor_expected_sources_list(self) -> List[str]:
        """Parse `monitor_expected_sources` into a clean list of source names."""
        return [s.strip() for s in (self.monitor_expected_sources or "").split(",") if s.strip()]

    # CCTP V2 (Circle's canonical version — V1 is deprecated). Controls the
    # generic cctp_api.py client used by router/swap_engine. Fast Transfer is a
    # PAID tier (a live Circle fee, capped by maxFee) that trades cost for speed
    # via soft finality; Standard is free/gas-only hard finality. Default to
    # Standard so we never silently start paying Fast fees.
    cctp_v2_enabled: bool = Field(
        default=True,
        description=(
            "Use CCTP V2 (TokenMessengerV2.depositForBurn, 7-arg signature) as the "
            "default cctp_api.py code path. When False, falls back to the legacy V1 "
            "4-arg depositForBurn call (kept intact for rollback only)."
        ),
    )
    cctp_v2_default_mode: str = Field(
        default="standard",
        description=(
            "Default CCTP V2 transfer mode: 'standard' (minFinalityThreshold=2000, "
            "hard finality, gas-only) or 'fast' (minFinalityThreshold<=1000, soft "
            "finality in ~8-20s, but charges a live Circle fee capped by maxFee). "
            "Conservative default is 'standard'."
        ),
    )
    cctp_v2_max_fast_fee_bps: int = Field(
        default=0,
        description=(
            "Maximum acceptable Fast Transfer fee, in basis points of the burn amount. "
            "Used to compute the bounded maxFee passed to depositForBurn. Must be set "
            "to a positive value before Fast mode can be used — cctp_api.py refuses "
            "(returns None / raises) any Fast-mode build with an unset or zero cap."
        ),
    )
    cctp_generic_rail_enabled: bool = Field(
        default=False,
        description=(
            "FAIL-CLOSED KILL SWITCH. The generic CCTP rail (bot/services/cctp_api.py + "
            "swap_engine._execute_cctp_swap) now has a completion relayer wired "
            "(bot/services/cctp_generic_relayer.py, unit-tested with mocked RPC/attestation "
            "in tests/test_cctp_relayer_generic.py) that polls the v2 attestation and "
            "submits receiveMessage on the destination chain. It is CODE-COMPLETE but NOT "
            "yet LIVE-verified. Before flipping this to True: (1) run one real small-amount "
            "burn -> attestation -> receiveMessage end-to-end on a single corridor (e.g. "
            "Base -> Arbitrum testnet or a $1 mainnet transfer) and confirm the recipient "
            "actually receives minted USDC; (2) fund settings.cctp_relayer_private_key's "
            "wallet with native gas on EVERY destination chain in cctp_api.CCTP_DOMAINS "
            "(ethereum/avalanche/optimism/arbitrum/base/polygon) -- the relayer surfaces and "
            "alerts on a per-chain shortfall (does not silently drop the deposit) but cannot "
            "complete a mint without gas; (3) set "
            "settings.cctp_generic_relayer_enabled=True so the relayer loop actually runs. "
            "Do NOT flip this flag as part of the relayer build/test work alone -- it "
            "requires the live corridor test above. Does NOT affect the HyperCore CCTP path "
            "(cctp_hypercore/cctp_relayer), which completes correctly and is unconditionally "
            "available."
        ),
    )

    # Generic-rail CCTP completion relayer (bot/services/cctp_generic_relayer.py).
    # Separate switch from cctp_relayer_enabled (the HyperCore-only relayer) so
    # enabling one never silently activates the other. Builds/tests this relayer
    # do NOT themselves flip cctp_generic_rail_enabled -- see that field's
    # docstring for the exact live-test bar that must be cleared first.
    cctp_generic_relayer_enabled: bool = Field(
        default=False,
        description=(
            "Enable the generic-rail CCTP completion relayer background loop. Requires "
            "cctp_relayer_private_key (same relayer EOA reused across chains) to be "
            "funded with native gas on EVERY destination chain a generic CCTP burn can "
            "target (see cctp_api.CCTP_DOMAINS). Independent of cctp_generic_rail_enabled "
            "(the swap-execution kill switch) -- this only controls whether the relayer "
            "processes already-recorded deposits."
        ),
    )
    cctp_generic_relayer_min_native_alert: float = Field(
        default=0.01,
        description=(
            "Alert admins once per chain when the relayer wallet's native-gas balance on "
            "that destination chain drops below this (in the chain's native unit, e.g. "
            "ETH/MATIC/AVAX). Deliberately conservative/uniform across chains -- top up "
            "generously rather than tuning per-chain thresholds."
        ),
    )

    # Agent control-plane approvals: DM the owning Telegram user an
    # Approve/Deny prompt for pending api-ts approval_requests rows. Defaults
    # off so this is a no-op until intentionally enabled; the notifier and
    # handlers are defensive either way (tolerate the table not existing).
    agent_approvals_enabled: bool = Field(
        default=False,
        description="Enable the agent-approval Telegram notifier + /approvals command",
    )

    # Mirrors api-ts's APPROVAL_STEP_UP_REQUIRED (api-ts/src/config/EnvService.ts).
    # When true, the web POST /approvals/:id/approve demands a server-issued
    # step-up nonce before honoring an approve decision. The Telegram inline
    # Approve button must enforce an equivalent re-confirmation (a first tap
    # only re-prompts with a fresh confirm callback; a second tap within a
    # short TTL actually decides) so turning this flag on is a real guarantee
    # across both surfaces, not just the web one. Deny never needs step-up.
    approval_step_up_required: bool = Field(
        default=False,
        description="Require re-confirmation before Telegram/web approve decisions are honored",
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
