from dataclasses import dataclass
from typing import Optional, Union
from enum import Enum


class ChainType(Enum):
    """Blockchain type."""
    EVM = "evm"
    SOLANA = "solana"


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
    

# Chain configurations
CHAINS: dict[str, ChainConfig] = {
    "ethereum": ChainConfig(
        chain_id=1,
        name="ethereum",
        display_name="Ethereum",
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
        display_name="BNB Chain",
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
        display_name="Polygon",
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
        display_name="Arbitrum",
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
        display_name="Optimism",
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
    "solana": ChainConfig(
        chain_id="solana",
        name="solana",
        display_name="Solana",
        chain_type=ChainType.SOLANA,
        native_token="SOL",
        native_decimals=9,
        rpc_url_env="SOLANA_RPC_URL",
        explorer_url="https://solscan.io",
        logo_emoji="🟢",
        lifi_chain_id=1151111081099710,  # Li.Fi Solana chain ID
    ),
}


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

