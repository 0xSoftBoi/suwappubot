# pragma version 0.4.3
"""
@title MockLyingToken
@notice An ERC20 that reports failure by returning `False` instead of reverting.
@dev The other half of the USDT problem.  A router that ignores the reply
     entirely accepts both this and a token that answers with nothing, and the
     two mean opposite things.
"""

decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])

#: Fails every transfer out, quietly.
lying: public(bool)


@deploy
def __init__(lying: bool):
    self.decimals = 18
    self.lying = lying


@external
def mint(to: address, amount: uint256):
    self.balanceOf[to] += amount
    self.totalSupply += amount


@external
def transfer(to: address, amount: uint256) -> bool:
    if self.lying:
        return False
    assert self.balanceOf[msg.sender] >= amount, "insufficient balance"
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount
    return True


@external
def transferFrom(frm: address, to: address, amount: uint256) -> bool:
    if self.lying:
        return False
    allowed: uint256 = self.allowance[frm][msg.sender]
    assert allowed >= amount, "insufficient allowance"
    if allowed != max_value(uint256):
        self.allowance[frm][msg.sender] = allowed - amount
    assert self.balanceOf[frm] >= amount, "insufficient balance"
    self.balanceOf[frm] -= amount
    self.balanceOf[to] += amount
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    self.allowance[msg.sender][spender] = amount
    return True
