"""Curve's deposit-and-stake zap: both halves in one transaction."""

from __future__ import annotations

from dataclasses import dataclass

from .models import Pool

#: The nowhere address, for arguments that are "not applicable".
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

#: Chains whose zap takes the ten-argument form, with `use_underlying`.
OLD_CHAINS = frozenset({1, 10, 56, 100, 137, 250, 1284, 2222, 8453, 42161, 42220, 43114})


@dataclass(frozen=True, slots=True)
class StakeZap:
    """The deposit-and-stake contract for one chain."""

    address: str
    #: Does it take `use_underlying`? See the module docstring: this is
    #: the ten-argument form against the nine-argument one.
    use_underlying_arg: bool


#: Keyed by chain id. Aurora publishes the zero address -- no zap deployed
#: -- and is left out rather than stored as a zero somebody has to remember
#: to check.
STAKE_ZAPS: dict[int, StakeZap] = {
    1: StakeZap("0x56C526b0159a258887e0d79ec3a80dfb940d0cD7", True),  # Ethereum
    10: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Optimism
    56: StakeZap("0x4f37A9d177470499A2dD084621020b023fcffc1F", True),  # BSC
    100: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Gnosis
    137: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Polygon
    146: StakeZap("0x505d666E4DD174DcDD7FA090ed95554486d2Be44", False),  # Sonic
    196: StakeZap("0x5552b631e2aD801fAa129Aacf4B701071cC9D1f7", False),  # X Layer
    250: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Fantom
    252: StakeZap("0xF0d4c12A5768D806021F80a262B4d39d26C58b8D", False),  # Fraxtal
    324: StakeZap("0x253548e98C769aD2850da8DB3E4c2b2cE46E3839", False),  # zkSync
    999: StakeZap("0x5a8C93EE12a8Df4455BA111647AdA41f29D5CfcC", False),  # HyperEVM
    2222: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Kava
    5000: StakeZap("0xF0d4c12A5768D806021F80a262B4d39d26C58b8D", False),  # Mantle
    8453: StakeZap("0x69522fb5337663d3B4dFB0030b881c1A750Adb4f", True),  # Base
    42161: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Arbitrum
    43114: StakeZap("0x37c5ab57AF7100Bdc9B668d766e193CCbF6614FD", True),  # Avalanche
}


def stake_zap_for(pool: Pool) -> StakeZap | None:
    """The deposit-and-stake contract for this pool, if the route exists."""
    if not pool.has_gauge or not pool.lp_token:
        return None
    return STAKE_ZAPS.get(pool.chain_id)


def consistent_variants() -> bool:
    """Every entry's flag agrees with `OLD_CHAINS`."""
    return all(
        zap.use_underlying_arg == (chain_id in OLD_CHAINS)
        for chain_id, zap in STAKE_ZAPS.items()
    )
