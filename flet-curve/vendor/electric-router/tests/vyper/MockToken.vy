# pragma version 0.4.3
"""
@title MockToken
@notice A plain ERC20, with the two mainnet quirks a router has to survive.
@dev `strict` refuses a non-zero to non-zero allowance change, which is USDT's
     and what breaks a router that approves without resetting first.  `fee_bp`
     burns a share of every transfer, which is what makes a leg's own balance
     delta the only honest measure of what it produced.
"""

decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])

strict: public(bool)
fee_bp: public(uint256)


@deploy
def __init__(decimals: uint8, strict: bool, fee_bp: uint256):
    self.decimals = decimals
    self.strict = strict
    self.fee_bp = fee_bp


@external
def mint(to: address, amount: uint256):
    self.balanceOf[to] += amount
    self.totalSupply += amount


@internal
def _move(frm: address, to: address, amount: uint256):
    assert self.balanceOf[frm] >= amount, "insufficient balance"
    self.balanceOf[frm] -= amount
    kept: uint256 = amount - amount * self.fee_bp // 10_000
    self.balanceOf[to] += kept
    self.totalSupply -= amount - kept


@external
def transfer(to: address, amount: uint256) -> bool:
    self._move(msg.sender, to, amount)
    return True


@external
def transferFrom(frm: address, to: address, amount: uint256) -> bool:
    allowed: uint256 = self.allowance[frm][msg.sender]
    assert allowed >= amount, "insufficient allowance"
    if allowed != max_value(uint256):
        self.allowance[frm][msg.sender] = allowed - amount
    self._move(frm, to, amount)
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    if self.strict:
        assert amount == 0 or self.allowance[msg.sender][spender] == 0, "unsafe approve"
    self.allowance[msg.sender][spender] = amount
    return True
