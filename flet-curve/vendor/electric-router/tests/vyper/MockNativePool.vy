# pragma version 0.4.3
"""
@title MockNativePool
@notice A two-coin pool holding raw ETH as coin 0, the way Curve's stETH pools do.
@dev It is paid in `msg.value`, not in a transfer, and it says so: an exchange
     out of coin 0 that arrives without the value reverts with nothing to
     decode.  `get_dy` on the real thing answers identically either way, which
     is why a route through one quotes and then fails.
"""

NATIVE: constant(address) = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
N: constant(uint256) = 2

coins: public(address[N])
rate: public(uint256[N * N])


@deploy
def __init__(other: address, rate: uint256[N * N]):
    self.coins = [NATIVE, other]
    self.rate = rate


@external
@view
def get_dy(i: int128, j: int128, dx: uint256) -> uint256:
    return dx * self.rate[convert(i, uint256) * N + convert(j, uint256)] // 10**18


@external
@payable
def exchange(i: int128, j: int128, dx: uint256, min_dy: uint256) -> uint256:
    a: uint256 = convert(i, uint256)
    b: uint256 = convert(j, uint256)
    assert a != b and a < N and b < N, "bad coin"
    if a == 0:
        assert msg.value == dx, "native input needs value"
    else:
        assert msg.value == 0, "no value for a token input"
        ok: bool = False
        out: Bytes[32] = b""
        ok, out = raw_call(
            self.coins[a],
            concat(method_id("transferFrom(address,address,uint256)"),
                   abi_encode(msg.sender, self, dx)),
            max_outsize=32, revert_on_failure=False)
        assert ok, "pull failed"
    dy: uint256 = dx * self.rate[a * N + b] // 10**18
    assert dy >= min_dy, "slippage"
    if b == 0:
        send(msg.sender, dy)
    else:
        ok2: bool = False
        out2: Bytes[32] = b""
        ok2, out2 = raw_call(
            self.coins[b],
            concat(method_id("transfer(address,uint256)"), abi_encode(msg.sender, dy)),
            max_outsize=32, revert_on_failure=False)
        assert ok2, "push failed"
    return dy


@external
@payable
def __default__():
    pass
