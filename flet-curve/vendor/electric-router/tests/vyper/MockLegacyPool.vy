# pragma version 0.4.3
"""
@title MockLegacyPool
@notice The oldest spelling: `coins(int128)`, and no LP getter of any kind.
@dev Two things are being tested through it.  `coins(uint256)` misses, so the
     router has to fall back; and nothing on it answers `lp_token()`, `token()`
     or `totalSupply()`, which is the shape of the fourteen mainnet pools whose
     LP token lives somewhere else entirely and has to be named.
"""

N: constant(uint256) = 2

held: address[N]
rate: public(uint256[N * N])


@deploy
def __init__(coins: address[N], rate: uint256[N * N]):
    self.held = coins
    self.rate = rate


@external
@view
def coins(i: int128) -> address:
    return self.held[convert(i, uint256)]


@external
def exchange(i: int128, j: int128, dx: uint256, min_dy: uint256) -> uint256:
    a: uint256 = convert(i, uint256)
    b: uint256 = convert(j, uint256)
    assert a != b and a < N and b < N, "bad coin"
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        self.held[a],
        concat(method_id("transferFrom(address,address,uint256)"),
               abi_encode(msg.sender, self, dx)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "pull failed"
    dy: uint256 = dx * self.rate[a * N + b] // 10**18
    assert dy >= min_dy, "slippage"
    ok, out = raw_call(
        self.held[b],
        concat(method_id("transfer(address,uint256)"), abi_encode(msg.sender, dy)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "push failed"
    return dy
