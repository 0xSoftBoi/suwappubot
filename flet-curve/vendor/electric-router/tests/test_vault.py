"""A vault is linear, so its model is a ratio -- but which ratio is asked.

At a fixed block `previewDeposit(x)` is `x * S / A`: no curve, no ladder, and
one number describes every size.  Two things stop that being trivial, and both
were found by asking mainnet rather than by reading a standard:

* the rounding convention differs.  OpenZeppelin's vaults carry a virtual
  offset -- `(S + 1) / (A + 1)`, added so the first share cannot be bought for
  nothing -- and others use the plain ratio.  Of ten vaults reached as arcs,
  six reproduce plainly, one needs the offset.
* the direction is its own verdict.  Three of those ten quote one direction
  exactly and not the other: a vault can price a deposit as a clean ratio and
  charge, queue or round differently on the way out.

So a verdict is per `(vault, direction)`, and anything that reproduces neither
ratio keeps being probed.
"""

from __future__ import annotations

import pytest

from erouter.chain.vault_params import CHECK_SIZES, build_exact_vaults
from erouter.core.transport import Answer, Status
from erouter.core.types import ArcKind
from erouter.core.vault import Vault, VaultError

DEPOSIT, REDEEM = ArcKind.ERC4626_DEPOSIT, ArcKind.ERC4626_REDEEM
VAULT = "0x" + "5a" * 20
A, S = 3_000_000 * 10**18, 2_400_000 * 10**18   # 1.25 assets per share


def word(v: int) -> Answer:
    return Answer(Status.VALUE, int(v).to_bytes(32, "big"))


class FakeVaultChain:
    """Answers totalAssets/totalSupply and the two preview calls."""

    def __init__(self, deposit, redeem):
        self.deposit, self.redeem = deposit, redeem

    def raw(self, calls):
        out = []
        for call in calls:
            sig = bytes(call.data[:4])
            if len(call.data) == 4:                      # a no-argument getter
                out.append(word(A if not out or len(out) % 2 == 0 else S))
                continue
            x = int.from_bytes(call.data[4:36], "big")
            # `previewDeposit` and `previewRedeem` differ in their selector; the
            # order they were queued in is what distinguishes them here.
            out.append(word((self.deposit if _is_deposit(sig) else self.redeem)(x)))
        return out


_DEPOSIT_SEL = None


def _is_deposit(sig: bytes) -> bool:
    from erouter.core.codec import encode_call
    global _DEPOSIT_SEL
    if _DEPOSIT_SEL is None:
        _DEPOSIT_SEL = bytes(encode_call("previewDeposit(uint256)", 0)[:4])
    return sig == _DEPOSIT_SEL


def test_the_ratio_is_exact_at_every_size():
    v = Vault(num=S, den=A)
    for x in CHECK_SIZES:
        assert v.convert(x) == x * S // A


def test_a_vault_with_nothing_in_it_refuses():
    with pytest.raises(VaultError):
        Vault(num=S, den=0).convert(10**18)
    with pytest.raises(VaultError):
        Vault(num=0, den=A).convert(10**18)
    assert Vault(num=S, den=A).convert(0) == 0


def test_the_plain_ratio_is_admitted(tmp_path):
    chain = FakeVaultChain(lambda x: x * S // A, lambda x: x * A // S)
    out = build_exact_vaults([VAULT], chain)
    assert len(out) == 2
    assert out.get(VAULT, DEPOSIT).convert(10**18) == 10**18 * S // A
    assert out.get(VAULT, REDEEM).convert(10**18) == 10**18 * A // S


def test_the_virtual_offset_is_admitted_too():
    """OpenZeppelin's `(S+1)/(A+1)`, which the plain ratio cannot reproduce."""
    chain = FakeVaultChain(lambda x: x * (S + 1) // (A + 1),
                           lambda x: x * (A + 1) // (S + 1))
    out = build_exact_vaults([VAULT], chain)
    assert len(out) == 2


def test_a_direction_that_charges_is_refused_on_its_own():
    """The property three of ten mainnet vaults have."""
    chain = FakeVaultChain(lambda x: x * S // A,                 # clean in
                           lambda x: x * A // S * 999 // 1000)   # 10 bp out
    out = build_exact_vaults([VAULT], chain)
    assert out.get(VAULT, DEPOSIT) is not None, "the clean direction must survive"
    assert out.get(VAULT, REDEEM) is None, "an exit fee is not a ratio"
    assert any("REDEEM" in who for who, _ in out.rejected)


def test_a_vault_that_reproduces_neither_is_left_to_the_probes():
    chain = FakeVaultChain(lambda x: x * S // A + 7, lambda x: x * A // S + 7)
    out = build_exact_vaults([VAULT], chain)
    assert len(out) == 0 and out.checked == 2
