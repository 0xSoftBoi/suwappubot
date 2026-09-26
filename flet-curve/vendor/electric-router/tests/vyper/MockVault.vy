# pragma version 0.4.3
"""
@title MockVault
@notice Minimal linear ERC4626 preview surface (scrvUSD-shaped).
"""

pps: public(uint256)  # assets per share, 1e18


@deploy
def __init__(pps: uint256):
    self.pps = pps


@external
@view
def previewDeposit(assets: uint256) -> uint256:
    return assets * 10**18 // self.pps


@external
@view
def previewRedeem(shares: uint256) -> uint256:
    return shares * self.pps // 10**18


@external
@view
def convertToAssets(shares: uint256) -> uint256:
    return shares * self.pps // 10**18


@external
def __default__():
    pass
