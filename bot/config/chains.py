from dataclasses import dataclass
from typing import Optional, Union
from enum import Enum


class ChainType(Enum):
    """Blockchain type."""

    EVM = "evm"
    SOLANA = "solana"
    TRON = "tron"
    STARKNET = "starknet"


@dataclass
class ChainConfig:
    """Configuration for a blockchain network."""

    chain_id: Union[int, str]  # int for EVM, str for Solana
    name: str
    display_name: str
    chain_type: ChainType
    native_token: str
    native_decimals: int
    rpc_url_env: str  # Environment variable name for RPC URL
    explorer_url: str
    logo_emoji: str
    lifi_chain_id: Optional[int] = None  # Li.Fi uses numeric chain IDs
    # Chains with no EIP-1559 support must use legacy gasPrice transactions only.
    # (Our EVM send path is already legacy-gasPrice everywhere; this flag documents
    # the constraint and guards any future EIP-1559 migration.)
    legacy_gas_only: bool = False
    # Network-enforced minimum gas price in wei (e.g. Rootstock's 0.06 gwei floor).
    # Applied via apply_min_gas_price() in the tx-build path.
    min_gas_price_wei: int = 0


# Chain configurations
CHAINS: dict[str, ChainConfig] = {
    "ethereum": ChainConfig(
        chain_id=1,
        name="ethereum",
        display_name="ETH",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="ETHEREUM_RPC_URL",
        explorer_url="https://etherscan.io",
        logo_emoji="🔷",
        lifi_chain_id=1,
    ),
    "bsc": ChainConfig(
        chain_id=56,
        name="bsc",
        display_name="BSC",
        chain_type=ChainType.EVM,
        native_token="BNB",
        native_decimals=18,
        rpc_url_env="BSC_RPC_URL",
        explorer_url="https://bscscan.com",
        logo_emoji="🟡",
        lifi_chain_id=56,
    ),
    "polygon": ChainConfig(
        chain_id=137,
        name="polygon",
        display_name="POL",
        chain_type=ChainType.EVM,
        native_token="MATIC",
        native_decimals=18,
        rpc_url_env="POLYGON_RPC_URL",
        explorer_url="https://polygonscan.com",
        logo_emoji="🟣",
        lifi_chain_id=137,
    ),
    "arbitrum": ChainConfig(
        chain_id=42161,
        name="arbitrum",
        display_name="ARB",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="ARBITRUM_RPC_URL",
        explorer_url="https://arbiscan.io",
        logo_emoji="🔵",
        lifi_chain_id=42161,
    ),
    "optimism": ChainConfig(
        chain_id=10,
        name="optimism",
        display_name="OP",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="OPTIMISM_RPC_URL",
        explorer_url="https://optimistic.etherscan.io",
        logo_emoji="🔴",
        lifi_chain_id=10,
    ),
    "base": ChainConfig(
        chain_id=8453,
        name="base",
        display_name="Base",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="BASE_RPC_URL",
        explorer_url="https://basescan.org",
        logo_emoji="🔵",
        lifi_chain_id=8453,
    ),
    "base-sepolia": ChainConfig(
        chain_id=84532,
        name="base-sepolia",
        display_name="Base Sepolia",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="BASE_SEPOLIA_RPC_URL",
        explorer_url="https://sepolia.basescan.org",
        logo_emoji="🔵",
        lifi_chain_id=None,  # Li.Fi has no testnet support — native escrow / direct transfers only
    ),
    "avalanche": ChainConfig(
        chain_id=43114,
        name="avalanche",
        display_name="AVAX",
        chain_type=ChainType.EVM,
        native_token="AVAX",
        native_decimals=18,
        rpc_url_env="AVALANCHE_RPC_URL",
        explorer_url="https://snowtrace.io",
        logo_emoji="🔺",
        lifi_chain_id=43114,
    ),
    "fantom": ChainConfig(
        chain_id=250,
        name="fantom",
        display_name="FTM",
        chain_type=ChainType.EVM,
        native_token="FTM",
        native_decimals=18,
        rpc_url_env="FANTOM_RPC_URL",
        explorer_url="https://ftmscan.com",
        logo_emoji="👻",
        lifi_chain_id=250,
    ),
    "linea": ChainConfig(
        chain_id=59144,
        name="linea",
        display_name="Linea",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="LINEA_RPC_URL",
        explorer_url="https://lineascan.build",
        logo_emoji="🟦",
        lifi_chain_id=59144,
    ),
    "mantle": ChainConfig(
        chain_id=5000,
        name="mantle",
        display_name="Mantle",
        chain_type=ChainType.EVM,
        native_token="MNT",
        native_decimals=18,
        rpc_url_env="MANTLE_RPC_URL",
        explorer_url="https://mantlescan.xyz",
        logo_emoji="🟩",
        lifi_chain_id=5000,
    ),
    "gnosis": ChainConfig(
        chain_id=100,
        name="gnosis",
        display_name="GNO",
        chain_type=ChainType.EVM,
        native_token="xDAI",
        native_decimals=18,
        rpc_url_env="GNOSIS_RPC_URL",
        explorer_url="https://gnosisscan.io",
        logo_emoji="🦉",
        lifi_chain_id=100,
    ),
    "scroll": ChainConfig(
        chain_id=534352,
        name="scroll",
        display_name="Scroll",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="SCROLL_RPC_URL",
        explorer_url="https://scrollscan.com",
        logo_emoji="📜",
        lifi_chain_id=534352,
    ),
    "solana": ChainConfig(
        chain_id="solana",
        name="solana",
        display_name="SOL",
        chain_type=ChainType.SOLANA,
        native_token="SOL",
        native_decimals=9,
        rpc_url_env="SOLANA_RPC_URL",
        explorer_url="https://solscan.io",
        logo_emoji="🟢",
        lifi_chain_id=1151111081099710,  # Li.Fi Solana chain ID
    ),
    "tron": ChainConfig(
        chain_id="tron",
        name="tron",
        display_name="TRX",
        chain_type=ChainType.TRON,
        native_token="TRX",
        native_decimals=6,
        rpc_url_env="TRON_RPC_URL",
        explorer_url="https://tronscan.org",
        logo_emoji="💎",
        lifi_chain_id=1170,
    ),
    "starknet": ChainConfig(
        chain_id="SN_MAIN",
        name="starknet",
        display_name="Starknet",
        chain_type=ChainType.STARKNET,
        native_token="STRK",
        native_decimals=18,
        rpc_url_env="STARKNET_RPC_URL",
        explorer_url="https://voyager.online",
        logo_emoji="🐺",
        lifi_chain_id=None,  # Li.Fi does not support Starknet
    ),
    "tempo": ChainConfig(
        chain_id=4217,
        name="tempo",
        display_name="Tempo",
        chain_type=ChainType.EVM,
        native_token="USD",
        native_decimals=6,
        rpc_url_env="TEMPO_RPC_URL",
        explorer_url="https://explore.tempo.xyz",
        logo_emoji="⚡",
        lifi_chain_id=4217,
    ),
    "plasma": ChainConfig(
        chain_id=9745,
        name="plasma",
        display_name="Plasma",
        chain_type=ChainType.EVM,
        native_token="XPL",
        native_decimals=18,
        rpc_url_env="PLASMA_RPC_URL",
        explorer_url="https://plasmascan.to",
        logo_emoji="🟪",
        lifi_chain_id=9745,
    ),
    "goat": ChainConfig(
        chain_id=2345,
        name="goat",
        display_name="GOAT",
        chain_type=ChainType.EVM,
        native_token="BTC",
        native_decimals=18,  # GOAT's native BTC uses 18 decimals (ETH-style), NOT 8
        rpc_url_env="GOAT_RPC_URL",
        explorer_url="https://explorer.goat.network",
        logo_emoji="🐐",
        lifi_chain_id=None,  # Li.Fi does not support GOAT — routes via GOATSwap only
    ),
    "rootstock": ChainConfig(
        chain_id=30,
        name="rootstock",
        display_name="Rootstock",
        chain_type=ChainType.EVM,
        native_token="RBTC",
        native_decimals=18,
        rpc_url_env="ROOTSTOCK_RPC_URL",
        explorer_url="https://rootstock.blockscout.com",
        logo_emoji="🟧",
        # Routing: Li.Fi ONLY (chain 30, verified live). Rootstock must NOT be added
        # to the 1inch/0x/Kyber/OKX/Across/CCTP chain dicts — absence = excluded.
        lifi_chain_id=30,
        # Rootstock has no EIP-1559 (eth_feeHistory unsupported) and uses
        # EIP-1191 chain-salted checksums — compare addresses lowercased,
        # never validate by EIP-55 checksum.
        legacy_gas_only=True,
        min_gas_price_wei=60_000_000,  # 0.06 gwei network minimum
    ),
    "citrea": ChainConfig(
        chain_id=4114,
        name="citrea",
        display_name="Citrea",
        chain_type=ChainType.EVM,
        native_token="cBTC",
        native_decimals=18,  # native cBTC uses 18 decimals (ETH-style), NOT 8
        rpc_url_env="CITREA_RPC_URL",
        explorer_url="https://explorer.mainnet.citrea.xyz",
        logo_emoji="🍊",
        # Routing: JuiceSwap (direct UniV3 fork) ONLY — Citrea (chain id 4114)
        # is absent from EVERY aggregator (LiFi/1inch/0x/Kyber/OKX/CoW/Socket).
        lifi_chain_id=None,
        # EIP-1559 OK (Type-2 zkEVM, Pectra), but the L1 (Bitcoin DA) fee
        # surcharge is NOT included in eth_estimateGas — execution adds 15%
        # headroom (see univ3_fork_api.CITREA_VENUE.gas_headroom_pct).
    ),
    # === New Li.Fi-supported chains (2025-2026) ===
    "sonic": ChainConfig(
        chain_id=146,
        name="sonic",
        display_name="Sonic",
        chain_type=ChainType.EVM,
        native_token="S",
        native_decimals=18,
        rpc_url_env="SONIC_RPC_URL",
        explorer_url="https://sonicscan.org",
        logo_emoji="🔵",
        lifi_chain_id=146,
    ),
    "opbnb": ChainConfig(
        chain_id=204,
        name="opbnb",
        display_name="opBNB",
        chain_type=ChainType.EVM,
        native_token="BNB",
        native_decimals=18,
        rpc_url_env="OPBNB_RPC_URL",
        explorer_url="https://opbnb.bscscan.com",
        logo_emoji="🟡",
        lifi_chain_id=204,
    ),
    "fraxtal": ChainConfig(
        chain_id=252,
        name="fraxtal",
        display_name="Fraxtal",
        chain_type=ChainType.EVM,
        native_token="FRAX",
        native_decimals=18,
        rpc_url_env="FRAXTAL_RPC_URL",
        explorer_url="https://fraxscan.com",
        logo_emoji="⚫",
        lifi_chain_id=252,
    ),
    "zksync": ChainConfig(
        chain_id=324,
        name="zksync",
        display_name="zkSync Era",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="ZKSYNC_RPC_URL",
        explorer_url="https://explorer.zksync.io",
        logo_emoji="🔷",
        lifi_chain_id=324,
    ),
    "worldchain": ChainConfig(
        chain_id=480,
        name="worldchain",
        display_name="World Chain",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="WORLDCHAIN_RPC_URL",
        explorer_url="https://worldscan.org",
        logo_emoji="🌍",
        lifi_chain_id=480,
    ),
    "flow": ChainConfig(
        chain_id=747,
        name="flow",
        display_name="Flow",
        chain_type=ChainType.EVM,
        native_token="FLOW",
        native_decimals=18,
        rpc_url_env="FLOW_RPC_URL",
        explorer_url="https://evm.flowscan.io",
        logo_emoji="🟢",
        lifi_chain_id=747,
    ),
    "hyperevm": ChainConfig(
        chain_id=999,
        name="hyperevm",
        display_name="HyperEVM",
        chain_type=ChainType.EVM,
        native_token="HYPE",
        native_decimals=18,
        rpc_url_env="HYPEREVM_RPC_URL",
        explorer_url="https://explorer.hyperliquid.xyz",
        logo_emoji="⚡",
        lifi_chain_id=999,
    ),
    "lisk": ChainConfig(
        chain_id=1135,
        name="lisk",
        display_name="Lisk",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="LISK_RPC_URL",
        explorer_url="https://blockscout.lisk.com",
        logo_emoji="🔵",
        lifi_chain_id=1135,
    ),
    "sei": ChainConfig(
        chain_id=1329,
        name="sei",
        display_name="Sei",
        chain_type=ChainType.EVM,
        native_token="SEI",
        native_decimals=18,
        rpc_url_env="SEI_RPC_URL",
        explorer_url="https://seitrace.com",
        logo_emoji="🔴",
        lifi_chain_id=1329,
    ),
    "soneium": ChainConfig(
        chain_id=1868,
        name="soneium",
        display_name="Soneium",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="SONEIUM_RPC_URL",
        explorer_url="https://soneium.blockscout.com",
        logo_emoji="🟦",
        lifi_chain_id=1868,
    ),
    "swellchain": ChainConfig(
        chain_id=1923,
        name="swellchain",
        display_name="Swellchain",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="SWELLCHAIN_RPC_URL",
        explorer_url="https://explorer.swellnetwork.io",
        logo_emoji="🌊",
        lifi_chain_id=1923,
    ),
    "abstract": ChainConfig(
        chain_id=2741,
        name="abstract",
        display_name="Abstract",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="ABSTRACT_RPC_URL",
        explorer_url="https://abscan.org",
        logo_emoji="🟪",
        lifi_chain_id=2741,
    ),
    "kaia": ChainConfig(
        chain_id=8217,
        name="kaia",
        display_name="Kaia",
        chain_type=ChainType.EVM,
        native_token="KAIA",
        native_decimals=18,
        rpc_url_env="KAIA_RPC_URL",
        explorer_url="https://kaiascan.io",
        logo_emoji="🟠",
        lifi_chain_id=8217,
    ),
    "apechain": ChainConfig(
        chain_id=33139,
        name="apechain",
        display_name="Apechain",
        chain_type=ChainType.EVM,
        native_token="APE",
        native_decimals=18,
        rpc_url_env="APECHAIN_RPC_URL",
        explorer_url="https://apescan.io",
        logo_emoji="🦍",
        lifi_chain_id=33139,
    ),
    "mode": ChainConfig(
        chain_id=34443,
        name="mode",
        display_name="Mode",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="MODE_RPC_URL",
        explorer_url="https://modescan.io",
        logo_emoji="🟡",
        lifi_chain_id=34443,
    ),
    "hemi": ChainConfig(
        chain_id=43111,
        name="hemi",
        display_name="Hemi",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="HEMI_RPC_URL",
        explorer_url="https://explorer.hemi.xyz",
        logo_emoji="🟠",
        lifi_chain_id=43111,
    ),
    "bob": ChainConfig(
        chain_id=60808,
        name="bob",
        display_name="BOB",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="BOB_RPC_URL",
        explorer_url="https://explorer.gobob.xyz",
        logo_emoji="🟡",
        lifi_chain_id=60808,
    ),
    "berachain": ChainConfig(
        chain_id=80094,
        name="berachain",
        display_name="Berachain",
        chain_type=ChainType.EVM,
        native_token="BERA",
        native_decimals=18,
        rpc_url_env="BERACHAIN_RPC_URL",
        explorer_url="https://berascan.com",
        logo_emoji="🐻",
        lifi_chain_id=80094,
    ),
    "taiko": ChainConfig(
        chain_id=167000,
        name="taiko",
        display_name="Taiko",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="TAIKO_RPC_URL",
        explorer_url="https://taikoscan.io",
        logo_emoji="🥁",
        lifi_chain_id=167000,
    ),
    "unichain": ChainConfig(
        chain_id=130,
        name="unichain",
        display_name="Unichain",
        chain_type=ChainType.EVM,
        native_token="ETH",
        native_decimals=18,
        rpc_url_env="UNICHAIN_RPC_URL",
        explorer_url="https://uniscan.xyz",
        logo_emoji="🦄",
        lifi_chain_id=130,
    ),
    "flare": ChainConfig(
        chain_id=14,
        name="flare",
        display_name="Flare",
        chain_type=ChainType.EVM,
        native_token="FLR",
        native_decimals=18,
        rpc_url_env="FLARE_RPC_URL",
        explorer_url="https://flarescan.com",
        logo_emoji="🔥",
        lifi_chain_id=14,
    ),
}


# Tempo testnets — intentionally NOT in CHAINS (not user-selectable in the bot).
# For tooling / integration tests only. Verified against tempoxyz docs + ChainList.
# The enshrined DEX (0xDEc0…), TIP-20 factory (0x20Fc…), and the stablecoin
# precompiles (0x20C0…0000-0003) are system contracts identical to mainnet, so the
# same client code (bot/services/tempo_*.py) works against these RPCs unchanged.
TEMPO_TESTNETS: dict[str, dict] = {
    # Current primary testnet (chain id confirmed via tempoxyz/tempo + ChainList).
    "moderato": {
        "chain_id": 42431,
        "rpc_url": "https://rpc.moderato.tempo.xyz",
        "explorer_url": "https://explore.tempo.xyz",
    },
    # Earlier testnet; RPC reachable via thirdweb's proxy (no canonical
    # *.tempo.xyz host published, so we don't guess one).
    "andantino": {
        "chain_id": 42429,
        "rpc_url": "https://42429.rpc.thirdweb.com",
        "explorer_url": "https://explore.tempo.xyz",
    },
}


def apply_min_gas_price(chain_name: str, gas_price: int) -> int:
    """Enforce a chain's network-minimum gas price (wei) on a fetched gas price.

    Rootstock rejects txs below 60M wei (0.06 gwei); other chains pass through.
    """
    chain = CHAINS.get(chain_name.lower())
    if chain and chain.min_gas_price_wei:
        return max(int(gas_price), chain.min_gas_price_wei)
    return int(gas_price)


def get_chain_by_id(chain_id: Union[int, str]) -> Optional[ChainConfig]:
    """Get chain configuration by chain ID."""
    for chain in CHAINS.values():
        if chain.chain_id == chain_id:
            return chain
    return None


def get_chain_by_name(name: str) -> Optional[ChainConfig]:
    """Get chain configuration by name."""
    return CHAINS.get(name.lower())


def get_evm_chains() -> list[ChainConfig]:
    """Get all EVM chain configurations."""
    return [c for c in CHAINS.values() if c.chain_type == ChainType.EVM]


def get_solana_chain() -> ChainConfig:
    """Get Solana chain configuration."""
    return CHAINS["solana"]


def get_tron_chain() -> ChainConfig:
    """Get TRON chain configuration."""
    return CHAINS["tron"]


def get_starknet_chain() -> ChainConfig:
    """Get Starknet chain configuration."""
    return CHAINS["starknet"]
