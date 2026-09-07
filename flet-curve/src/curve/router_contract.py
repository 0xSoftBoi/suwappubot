"""Sending a route to `ElectricRouter`, and asking what it will cost first.

The router takes a whole route as one call: the pools, one packed word per
leg, and the tokens it cannot read for itself.  `erouter.chain.session` builds
that calldata; everything here is what a wallet has to do around it -- an
allowance for the token being sold, and the transaction itself.

The allowance is **exact**, not unlimited, the same way every other write in
this app approves.  A route spending native ETH needs none at all: it arrives
as `msg.value`.
"""

from __future__ import annotations

from wallet.base import RpcError, WalletProvider

from . import abi

#: Curve's sentinel for native ETH.  Not an ERC20: it has no allowance and no
#: `balanceOf`, and a route that spends it sends it instead.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"


class RouterError(RuntimeError):
    """A read the router needed could not be made."""


class RouterContract:
    """`ElectricRouter`, from a wallet's point of view."""

    def __init__(self, provider: WalletProvider, account: str) -> None:
        self.provider = provider
        self.account = account

    @property
    def can_send(self) -> bool:
        return bool(self.account)

    # -- reads -------------------------------------------------------------

    async def balance_of(self, token: str) -> int:
        """What this address holds.  Native ETH is its own question."""
        if token.lower() == NATIVE:
            return await self.provider.get_balance(self.account)
        from wallet.erc20 import encode_balance_of

        try:
            answer = await self.provider.call(token, encode_balance_of(self.account))
        except RpcError as exc:
            raise RouterError(f"Could not read balance: {exc.message}") from exc
        return abi.decode_uint(answer)

    async def allowance(self, token: str, spender: str) -> int:
        if token.lower() == NATIVE:
            # Nothing to allow: it rides on `msg.value`.
            return 2**256 - 1
        try:
            answer = await self.provider.call(
                token, abi.encode_allowance(self.account, spender))
        except RpcError as exc:
            raise RouterError(f"Could not read allowance: {exc.message}") from exc
        return abi.decode_uint(answer)

    async def needs_approval(self, plan) -> bool:
        """Whether the token has to be approved before this route can run.

        A wrapping never needs one, either way round: a deposit rides on
        `msg.value` and a withdraw burns the caller's own balance.  Asked as
        an allowance it would look like one that is missing -- the spender
        would be the wrapped token itself -- and the tab would offer an
        approval that does nothing.
        """
        if getattr(plan, "wrap", False):
            return False
        if plan.token_in.lower() == NATIVE or not self.can_send:
            return False
        return await self.allowance(plan.token_in, plan.to) < plan.amount_in

    # -- writes ------------------------------------------------------------
    #
    # Gas and nonce are left unset, as everywhere else here: the wallet fills
    # them in and knows the chain better than this app does.

    def build_approve(self, plan) -> tuple[str, str]:
        return plan.token_in, abi.encode_approve(plan.to, plan.amount_in)

    async def approve(self, plan) -> str:
        token, data = self.build_approve(plan)
        return await self.provider.send_transaction(
            {"from": self.account, "to": token, "value": "0x0", "data": data})

    async def execute(self, plan) -> str:
        """Send the route.  `plan.data` is already encoded and bounded."""
        return await self.provider.send_transaction({
            "from": self.account,
            "to": plan.to,
            "value": hex(int(plan.value)) if plan.value else "0x0",
            "data": "0x" + bytes(plan.data).hex(),
        })
