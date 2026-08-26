"""ERC-4626 vault registry — chain-agnostic cross-protocol earn venues.

Every row below was on-chain verified (2026-08-26) by calling `asset()` and
`totalAssets()` directly against the vault address and confirming both
succeed (the two calls that define ERC-4626 conformance for our purposes).
Share decimals were read via `decimals()` and are 18 for all listed vaults.
Do NOT add a vault here without doing the same probe — a token that only
answers `symbol()`/`decimals()` (e.g. a plain yield-bearing ERC-20) is NOT
an ERC-4626 vault, even if it looks like one. Robinhood Chain (4663) has no
verified ERC-4626 vault as of this writing (see docs/DECISIONS.md) — this
registry is intentionally chain-generic so a Robinhood Chain vault, or any
other chain's vault, is a pure config addition here, with zero code changes
to VaultService or the /earn handler.

To add a new vault:
  1. Confirm on-chain: `asset()` and `totalAssets()` both return without
     reverting, and `decimals()` matches the value you record below.
  2. Add a `VaultConfig` row to `VAULTS` with a unique key.
  3. That's it — VaultService and bot/handlers/earn.py read this registry.
"""

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class VaultConfig:
    key: str
    display_name: str
    protocol: str
    chain: str
    vault_address: str
    asset_symbol: str
    asset_address: str
    asset_decimals: int
    share_decimals: int
    docs_url: str
    risk_note: str


VAULTS: Dict[str, VaultConfig] = {
    "susde": VaultConfig(
        key="susde",
        display_name="sUSDe",
        protocol="Ethena",
        chain="ethereum",
        vault_address="0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
        asset_symbol="USDe",
        asset_address="0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        asset_decimals=18,
        share_decimals=18,
        docs_url="https://docs.ethena.fi/",
        risk_note=(
            "USDe is a synthetic dollar backed by delta-hedged crypto collateral. "
            "sUSDe yield comes from funding-rate/staking income and can go negative."
        ),
    ),
    "sdai": VaultConfig(
        key="sdai",
        display_name="sDAI",
        protocol="Sky",
        chain="ethereum",
        vault_address="0x83F20F44975D03b1b09e64809B757c47f942BEeA",
        asset_symbol="DAI",
        asset_address="0x6B175474E89094C44Da98b954EedeA397C5daBE9",
        asset_decimals=18,
        share_decimals=18,
        docs_url="https://docs.sky.money/",
        risk_note="sDAI accrues the Sky Savings Rate — a governance-set rate that can change.",
    ),
    "steakusdc-eth": VaultConfig(
        key="steakusdc-eth",
        display_name="Steakhouse USDC",
        protocol="Morpho (Steakhouse)",
        chain="ethereum",
        vault_address="0xbEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
        asset_symbol="USDC",
        asset_address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        asset_decimals=6,
        share_decimals=18,
        docs_url="https://app.morpho.org/",
        risk_note="MetaMorpho vault; yield and risk depend on the underlying Morpho markets it allocates to.",
    ),
    "steakusdc-base": VaultConfig(
        key="steakusdc-base",
        display_name="Steakhouse USDC",
        protocol="Morpho (Steakhouse)",
        chain="base",
        vault_address="0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        asset_symbol="USDC",
        asset_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        asset_decimals=6,
        share_decimals=18,
        docs_url="https://app.morpho.org/",
        risk_note="MetaMorpho vault; yield and risk depend on the underlying Morpho markets it allocates to.",
    ),
    "gtusdcp-base": VaultConfig(
        key="gtusdcp-base",
        display_name="Gauntlet USDC Prime",
        protocol="Morpho (Gauntlet)",
        chain="base",
        vault_address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
        asset_symbol="USDC",
        asset_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        asset_decimals=6,
        share_decimals=18,
        docs_url="https://app.morpho.org/",
        risk_note="MetaMorpho vault; yield and risk depend on the underlying Morpho markets it allocates to.",
    ),
}


def get_vault(key: str) -> Optional[VaultConfig]:
    """Return the VaultConfig for `key`, or None if unknown."""
    return VAULTS.get(key)


def list_vaults(chain: Optional[str] = None, asset: Optional[str] = None) -> list:
    """List vaults, optionally filtered by chain and/or asset symbol (case-insensitive)."""
    out = list(VAULTS.values())
    if chain is not None:
        out = [v for v in out if v.chain == chain]
    if asset is not None:
        out = [v for v in out if v.asset_symbol.lower() == asset.lower()]
    return out
