# pragma version 0.4.3
"""
@title MockCryptoPool
@notice `get_dy(uint256,uint256,uint256)` -- the CryptoSwap dialect.
"""

rate: public(uint256)


@deploy
def __init__(rate: uint256):
    self.rate = rate


@external
@view
def get_dy(i: uint256, j: uint256, dx: uint256) -> uint256:
    assert i != j, "same coin"
    return dx * self.rate // 10**18


@external
def __default__():
    pass
