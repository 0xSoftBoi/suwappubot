# pragma version 0.4.3
"""
@title MockStablePool
@notice `get_dy(int128,int128,uint256)` -- the StableSwap dialect.
@dev The `__default__` is the point of this mock, not an afterthought.  It makes
     any *other* signature return empty data instead of reverting, which is
     exactly how real Curve pools behave and is the trap that makes
     "which dialect answered?" an invalid discriminator: the crypto spelling
     comes back successful-but-empty, and decoding that as a uint gives 0.
"""

rate: public(uint256)  # out per in, 1e18


@deploy
def __init__(rate: uint256):
    self.rate = rate


@external
@view
def get_dy(i: int128, j: int128, dx: uint256) -> uint256:
    assert i != j, "same coin"
    return dx * self.rate // 10**18


@external
def __default__():
    pass
