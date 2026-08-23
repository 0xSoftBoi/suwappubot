"""An ERC4626 vault, evaluated exactly (§11.3).

A vault is the one element in this router with no curve at all.  At a fixed
block `previewDeposit` and `previewRedeem` are `x * S / A` and `x * A / S` for
the vault's total supply and total assets -- linear, so one ratio per direction
describes the whole range, with nothing to fit, no ladder to probe and no size
at which the model stops being right.

What is *not* uniform is the rounding.  A vault built on OpenZeppelin's
implementation carries a virtual offset -- `(S + 1) / (A + 1)`, added so the
first share cannot be bought for nothing -- where others use the plain ratio.
The two agree for most sizes and disagree by a wei exactly where it matters
least, which is why the convention is *asked* rather than assumed.

And the direction matters on its own.  Measured on mainnet: of ten vaults
reached as arcs, six reproduce both ways with the plain ratio, one needs the
offset, two reproduce one direction only, and one reproduces neither.  A vault
that quotes a deposit exactly may charge an exit fee, hold a withdrawal queue or
round the other way out -- so a verdict is per `(vault, direction)`.
"""

from __future__ import annotations

from dataclasses import dataclass


class VaultError(ArithmeticError):
    """The vault cannot serve this conversion."""


@dataclass(frozen=True, slots=True)
class Vault:
    """One direction of one vault: `out = dx * num // den`."""

    num: int
    den: int

    def convert(self, dx: int) -> int:
        if dx <= 0:
            return 0
        if self.den <= 0 or self.num <= 0:
            raise VaultError("empty vault")
        return dx * self.num // self.den

    # The router calls every model the same way, so a vault answers `get_dy`
    # too.  The coin indices carry no meaning here -- a vault has one pair.
    def get_dy(self, i: int, j: int, dx: int) -> int:
        return self.convert(dx)
