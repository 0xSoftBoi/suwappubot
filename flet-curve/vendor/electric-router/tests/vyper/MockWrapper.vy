# pragma version 0.4.3
"""
@title MockWrapper
@notice WETH: payable `deposit()`, `withdraw(uint256)`, and a bare-call payout.
"""

decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])


@deploy
def __init__():
    self.decimals = 18


@external
@payable
def deposit():
    self.balanceOf[msg.sender] += msg.value
    self.totalSupply += msg.value


@external
def withdraw(amount: uint256):
    assert self.balanceOf[msg.sender] >= amount, "insufficient balance"
    self.balanceOf[msg.sender] -= amount
    self.totalSupply -= amount
    raw_call(msg.sender, b"", value=amount)


@external
def transfer(to: address, amount: uint256) -> bool:
    assert self.balanceOf[msg.sender] >= amount, "insufficient balance"
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount
    return True


@external
def transferFrom(frm: address, to: address, amount: uint256) -> bool:
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
