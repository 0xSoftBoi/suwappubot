# pragma version 0.4.3
"""
@title MockRevertPool
@notice Implements the StableSwap dialect but always reverts -- a paused pool.
@dev Distinct from MockStablePool's empty-data case on purpose: REVERTED and
     WRONG_ABI must not be conflated.
"""


@external
@view
def get_dy(i: int128, j: int128, dx: uint256) -> uint256:
    raise "pool is killed"
