"""Chain metadata and a small curated token list."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Token:
    symbol: str
    address: str  # "" means the chain's native asset
    decimals: int

    @property
    def is_native(self) -> bool:
        return not self.address


@dataclass(frozen=True)
class Chain:
    chain_id: int
    name: str
    native_symbol: str
    explorer: str
    tokens: tuple[Token, ...] = field(default_factory=tuple)

    def tx_url(self, tx_hash: str) -> str:
        return f"{self.explorer}/tx/{tx_hash}"

    def address_url(self, address: str) -> str:
        return f"{self.explorer}/address/{address}"


CHAINS: dict[int, Chain] = {
    1: Chain(
        1, "Ethereum", "ETH", "https://etherscan.io",
        (
            Token("USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
            Token("USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
            Token("DAI", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
            Token("WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
            Token("crvUSD", "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", 18),
        ),
    ),
    10: Chain(
        10, "Optimism", "ETH", "https://optimistic.etherscan.io",
        (
            Token("USDC", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6),
            Token("USDT", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6),
            Token("DAI", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
            Token("WETH", "0x4200000000000000000000000000000000000006", 18),
        ),
    ),
    137: Chain(
        137, "Polygon", "POL", "https://polygonscan.com",
        (
            Token("USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
            Token("USDT", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
            Token("DAI", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18),
        ),
    ),
    8453: Chain(
        8453, "Base", "ETH", "https://basescan.org",
        (
            Token("USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
            Token("WETH", "0x4200000000000000000000000000000000000006", 18),
        ),
    ),
    42161: Chain(
        42161, "Arbitrum", "ETH", "https://arbiscan.io",
        (
            Token("USDC", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
            Token("USDT", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
            Token("DAI", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
        ),
    ),
}


def get_chain(chain_id: int) -> Chain:
    """Known chain, or a usable placeholder so the UI never breaks."""
    return CHAINS.get(
        chain_id,
        Chain(chain_id, f"Chain {chain_id}", "ETH", "https://blockscan.com"),
    )


def native_token(chain: Chain) -> Token:
    return Token(chain.native_symbol, "", 18)
