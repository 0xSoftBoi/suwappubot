# pragma version 0.4.3
"""
@title MockHostilePool
@notice A "pool" that does whatever the test tells it to when called.
@dev Three attacks in one contract: call back into the router mid-route, try to
     spend an allowance the router granted for a different leg, and try to pull
     from a third party who has approved the router.
"""

MODE_SWAP: constant(uint8) = 0
MODE_REENTER: constant(uint8) = 1
MODE_SPEND_ALLOWANCE: constant(uint8) = 2

coins: public(address[2])
mode: public(uint8)
router: public(address)
#: Whatever the reentrant attempt should carry.
payload: public(Bytes[1024])
victim: public(address)
#: Set when a callback came back cleanly, which is the thing that must not happen.
reentered: public(bool)


@deploy
def __init__(coins: address[2], router: address):
    self.coins = coins
    self.router = router


@external
def arm(mode: uint8, payload: Bytes[1024], victim: address):
    self.mode = mode
    self.payload = payload
    self.victim = victim
    self.reentered = False


@external
def exchange(i: int128, j: int128, dx: uint256, min_dy: uint256) -> uint256:
    if self.mode == MODE_REENTER:
        ok: bool = False
        out: Bytes[32] = b""
        ok, out = raw_call(self.router, self.payload, max_outsize=32,
                           revert_on_failure=False)
        self.reentered = ok
        assert not ok, "the router let a pool call back in"

    if self.mode == MODE_SPEND_ALLOWANCE:
        # The router approved this address for coin `i` as part of the route.
        # Take the caller's whole balance with it, not just `dx`.
        held: Bytes[32] = b""
        _ok: bool = False
        _ok, held = raw_call(
            self.coins[convert(i, uint256)],
            concat(method_id("balanceOf(address)"), abi_encode(msg.sender)),
            max_outsize=32, is_static_call=True, revert_on_failure=False)
        self._pull(self.coins[convert(i, uint256)], msg.sender,
                   abi_decode(held, uint256))
        # And from anyone else who ever approved the router.
        if self.victim != empty(address):
            self._pull(self.coins[convert(i, uint256)], self.victim, 1)
        return 0

    self._pull(self.coins[convert(i, uint256)], msg.sender, dx)
    self._push(self.coins[convert(j, uint256)], msg.sender, dx)
    return dx


@internal
def _pull(token: address, frm: address, amount: uint256):
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token,
        concat(method_id("transferFrom(address,address,uint256)"),
               abi_encode(frm, self, amount)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "pull failed"


@internal
def _push(token: address, to: address, amount: uint256):
    ok: bool = False
    out: Bytes[32] = b""
    ok, out = raw_call(
        token, concat(method_id("transfer(address,uint256)"), abi_encode(to, amount)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "push failed"
