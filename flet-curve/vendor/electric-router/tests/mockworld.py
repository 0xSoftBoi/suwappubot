"""A small self-contained market for the router tests: tokens, pools, a vault.

Shaped around what makes a router hard rather than what is easy to fake -- a
token that returns nothing, one that refuses a second approval, one that takes
a cut of every transfer, and a pool that answers an unknown selector with
success and does nothing at all.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

import boa

VYPER = pathlib.Path(__file__).parent / "vyper"
CONTRACT = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "ElectricRouter.vy"

#: 3 bp, kept out of every mock rate so the arithmetic looks like a pool's.
FEE = 3 * 10**14
KEEP = 10**18 - FEE

#: A and C carry 18 decimals, B carries 6, so B's rates carry the twelve orders
#: of magnitude and nothing else in the system has to know about them.
UP = 10**6
DOWN = 10**30


def load(name: str, *args):
    return boa.loads((VYPER / f"{name}.vy").read_text(), *args, name=name)


@dataclass
class World:
    router: object
    a: object
    b: object
    c: object
    weth: object
    stable: object
    crypto: object
    legacy: object
    vault: object

    def is_empty(self) -> bool:
        """Nothing left behind: the router's balance is never anyone's answer."""
        held = self.router.address
        return (all(t.balanceOf(held) == 0
                    for t in (self.a, self.b, self.c, self.weth))
                and boa.env.get_balance(held) == 0)


def build(router=None) -> World:
    a = load("MockToken", 18, False, 0)
    b = load("MockToken", 6, True, 0)          # refuses a second approval
    c = load("MockSilentToken", 18)            # returns no data
    weth = load("MockWrapper")

    rates = [0, UP * KEEP // 10**18, KEEP,
             DOWN * KEEP // 10**18, 0, DOWN * KEEP // 10**18,
             KEEP, UP * KEEP // 10**18, 0]
    stable = load("MockStableExec", [a.address, b.address, c.address], rates,
                  [10**18, 10**30, 10**18])
    crypto = load("MockCryptoExec", [a.address, b.address],
                  [0, UP * KEEP // 10**18, DOWN * KEEP // 10**18, 0])
    legacy = load("MockLegacyPool", [a.address, c.address], [0, KEEP, KEEP, 0])
    vault = load("MockYieldVault", a.address, 2 * 10**18)

    for pool in (stable, crypto, legacy):
        a.mint(pool.address, 10**24)
        b.mint(pool.address, 10**18)
        c.mint(pool.address, 10**24)
    a.mint(vault.address, 10**24)
    boa.env.set_balance(weth.address, 10**21)

    return World(router=router or boa.loads(CONTRACT.read_text(), name="ElectricRouter"),
                 a=a, b=b, c=c, weth=weth, stable=stable, crypto=crypto,
                 legacy=legacy, vault=vault)


def funded(world: World, native: int = 10**21, amount: int = 10**22):
    """A trader holding every token and having approved the router for them."""
    who = boa.env.generate_address()
    boa.env.set_balance(who, native)
    world.a.mint(who, amount)
    world.c.mint(who, amount)
    with boa.env.prank(who):
        for token in (world.a, world.b, world.c, world.weth):
            token.approve(world.router.address, 2**256 - 1)
    return who


def send(world: World, trader, steps, amount, *, tokens=(), approvals=True,
         receiver=None, min_out=0, value=0):
    with boa.env.prank(trader):
        return world.router.execute(
            amount,
            [s.pool for s in steps],
            [s.pack() for s in steps],
            approvals,
            list(tokens),
            receiver or trader,
            min_out,
            value=value,
        )
