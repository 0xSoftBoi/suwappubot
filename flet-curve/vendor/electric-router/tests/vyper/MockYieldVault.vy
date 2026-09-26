# pragma version 0.4.3
"""
@title MockYieldVault
@notice A linear ERC4626 that really holds its asset and really mints shares.
"""

asset: public(address)
pps: public(uint256)  # assets per share, 1e18

decimals: public(uint8)
totalSupply: public(uint256)
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])


@deploy
def __init__(asset: address, pps: uint256):
    self.asset = asset
    self.pps = pps
    self.decimals = 18


@internal
def _move(token: address, frm: address, to: address, amount: uint256):
    ok: bool = False
    out: Bytes[32] = b""
    if frm == self:
        ok, out = raw_call(
            token, concat(method_id("transfer(address,uint256)"), abi_encode(to, amount)),
            max_outsize=32, revert_on_failure=False)
    else:
        ok, out = raw_call(
            token,
            concat(method_id("transferFrom(address,address,uint256)"),
                   abi_encode(frm, to, amount)),
            max_outsize=32, revert_on_failure=False)
    assert ok, "asset move failed"


@external
def deposit(assets: uint256, receiver: address) -> uint256:
    self._move(self.asset, msg.sender, self, assets)
    shares: uint256 = assets * 10**18 // self.pps
    self.balanceOf[receiver] += shares
    self.totalSupply += shares
    return shares


@external
def redeem(shares: uint256, receiver: address, owner: address) -> uint256:
    assert owner == msg.sender, "only self-redeem here"
    assert self.balanceOf[owner] >= shares, "insufficient shares"
    self.balanceOf[owner] -= shares
    self.totalSupply -= shares
    assets: uint256 = shares * self.pps // 10**18
    self._move(self.asset, self, receiver, assets)
    return assets


@external
@view
def previewDeposit(assets: uint256) -> uint256:
    return assets * 10**18 // self.pps


@external
@view
def previewRedeem(shares: uint256) -> uint256:
    return shares * self.pps // 10**18


@external
def transfer(to: address, amount: uint256) -> bool:
    assert self.balanceOf[msg.sender] >= amount, "insufficient shares"
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount
    return True


@external
def approve(spender: address, amount: uint256) -> bool:
    self.allowance[msg.sender][spender] = amount
    return True
