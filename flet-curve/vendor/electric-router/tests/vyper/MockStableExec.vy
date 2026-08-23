# pragma version 0.4.3
"""
@title MockStableExec
@notice A three-coin pool that really moves tokens: `exchange(int128,...)`,
        single-sided deposits and one-coin withdrawals, and its own LP token.
@dev Rates are fixed and given in raw units, so a test can predict every output
     exactly.  Tokens are moved with `raw_call` because a pool has to work with
     the ones that return nothing.
"""

N: constant(uint256) = 3

coins: public(address[N])
#: out per in, 1e18-based and in raw units, indexed `i * N + j`.
rate: public(uint256[N * N])
#: LP minted per unit of coin `i` deposited, and paid out per unit burned.
lp_rate: public(uint256[N])

totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])


@deploy
def __init__(coins: address[N], rate: uint256[N * N], lp_rate: uint256[N]):
    self.coins = coins
    self.rate = rate
    self.lp_rate = lp_rate


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
        token,
        concat(method_id("transfer(address,uint256)"), abi_encode(to, amount)),
        max_outsize=32, revert_on_failure=False)
    assert ok, "push failed"


@external
def exchange(i: int128, j: int128, dx: uint256, min_dy: uint256) -> uint256:
    a: uint256 = convert(i, uint256)
    b: uint256 = convert(j, uint256)
    assert a != b and a < N and b < N, "bad coin"
    self._pull(self.coins[a], msg.sender, dx)
    dy: uint256 = dx * self.rate[a * N + b] // 10**18
    assert dy >= min_dy, "slippage"
    self._push(self.coins[b], msg.sender, dy)
    return dy


@external
def add_liquidity(amounts: uint256[N], min_mint: uint256) -> uint256:
    minted: uint256 = 0
    for k: uint256 in range(N):
        if amounts[k] == 0:
            continue
        self._pull(self.coins[k], msg.sender, amounts[k])
        minted += amounts[k] * self.lp_rate[k] // 10**18
    assert minted >= min_mint, "slippage"
    self.balanceOf[msg.sender] += minted
    self.totalSupply += minted
    return minted


@external
def remove_liquidity_one_coin(burn: uint256, j: int128, min_dy: uint256) -> uint256:
    b: uint256 = convert(j, uint256)
    assert b < N, "bad coin"
    assert self.balanceOf[msg.sender] >= burn, "insufficient LP"
    self.balanceOf[msg.sender] -= burn
    self.totalSupply -= burn
    dy: uint256 = burn * 10**18 // self.lp_rate[b]
    assert dy >= min_dy, "slippage"
    self._push(self.coins[b], msg.sender, dy)
    return dy


@external
def transfer(to: address, amount: uint256) -> bool:
    assert self.balanceOf[msg.sender] >= amount, "insufficient LP"
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    self.allowance[msg.sender][spender] = amount
    return True
