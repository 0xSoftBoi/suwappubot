# pragma version 0.4.3
"""
@title MockCryptoExec
@notice A two-coin pool with only the five-argument `exchange`, and a
        `__default__` that swallows everything else.
@dev The combination is the trap.  A router that tries
     `exchange(uint256,uint256,uint256,uint256)` first gets a *successful* call
     that does nothing at all, so "did the call succeed" is not the question --
     "did anything move" is.
"""

N: constant(uint256) = 2

coins: public(address[N])
rate: public(uint256[N * N])


@deploy
def __init__(coins: address[N], rate: uint256[N * N]):
    self.coins = coins
    self.rate = rate


@external
def exchange(i: uint256, j: uint256, dx: uint256, min_dy: uint256, use_eth: bool) -> uint256:
    assert i != j and i < N and j < N, "bad coin"
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        self.coins[i],
        concat(method_id("transferFrom(address,address,uint256)"),
               abi_encode(msg.sender, self, dx)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "pull failed"
    dy: uint256 = dx * self.rate[i * N + j] // 10**18
    assert dy >= min_dy, "slippage"
    ok, out = raw_call(
        self.coins[j],
        concat(method_id("transfer(address,uint256)"), abi_encode(msg.sender, dy)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "push failed"
    return dy


@external
@payable
def __default__():
    pass
