# pragma version 0.4.3
"""
@title MockSilentToken
@notice An ERC20 whose `transfer` and `approve` return no data at all.
@dev USDT's spelling.  Its own file because the return type is part of the
     signature: a contract cannot answer both ways behind one flag.
"""

decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])


@deploy
def __init__(decimals: uint8):
    self.decimals = decimals


@external
def mint(to: address, amount: uint256):
    self.balanceOf[to] += amount
    self.totalSupply += amount


@external
def transfer(to: address, amount: uint256):
    assert self.balanceOf[msg.sender] >= amount, "insufficient balance"
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount


@external
def transferFrom(frm: address, to: address, amount: uint256):
    allowed: uint256 = self.allowance[frm][msg.sender]
    assert allowed >= amount, "insufficient allowance"
    if allowed != max_value(uint256):
        self.allowance[frm][msg.sender] = allowed - amount
    assert self.balanceOf[frm] >= amount, "insufficient balance"
    self.balanceOf[frm] -= amount
    self.balanceOf[to] += amount


@external
def approve(spender: address, amount: uint256):
    assert amount == 0 or self.allowance[msg.sender][spender] == 0, "unsafe approve"
    self.allowance[msg.sender][spender] = amount
