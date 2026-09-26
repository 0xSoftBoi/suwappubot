"""Read what an ERC4626 vault needs to be evaluated instead of probed.

Same rule as the pools: build the model, ask the vault for real, and keep it
only if the arithmetic reproduces the answer to the wei -- here at every size
checked and in each direction separately.

A vault is linear, so the check is stronger than it looks.  A curve fitted at
one size can agree there and diverge elsewhere; a ratio that reproduces four
sizes spanning eight decades is either the vault's own arithmetic or a
coincidence with no room left to hide.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import encode_call
from ..core.transport import Call
from ..core.types import ArcKind
from ..core.vault import Vault

#: Sizes to check at, in the vault's own units.  Spread over eight decades so a
#: rounding convention that only shows on small or large amounts is caught: the
#: plain ratio and the virtual-offset one differ by a wei, and only sometimes.
CHECK_SIZES = (10**15, 10**18, 5 * 10**20, 10**23)

DEPOSIT = ArcKind.ERC4626_DEPOSIT
REDEEM = ArcKind.ERC4626_REDEEM


@dataclass(slots=True)
class ExactVaults:
    """Verified vault models, by (address, direction)."""

    by_key: dict[tuple[str, ArcKind], Vault] = field(default_factory=dict)
    checked: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_key)

    def get(self, address: str, kind: ArcKind):
        return self.by_key.get((address.lower(), kind))


def build_exact_vaults(addresses, client, *, quiet: bool = True) -> ExactVaults:
    """Model every vault direction that reproduces its own preview call."""
    out = ExactVaults()
    wanted = sorted({a.lower() for a in addresses})
    if not wanted:
        return out

    meta = client.raw([c for a in wanted for c in (
        Call(a, encode_call("totalAssets()")),
        Call(a, encode_call("totalSupply()")))])

    probes: list[Call] = []
    for a in wanted:
        probes += [Call(a, encode_call("previewDeposit(uint256)", x)) for x in CHECK_SIZES]
        probes += [Call(a, encode_call("previewRedeem(uint256)", x)) for x in CHECK_SIZES]
    quotes = client.raw(probes)
    per = 2 * len(CHECK_SIZES)

    for k, address in enumerate(wanted):
        assets, supply = meta[2 * k: 2 * k + 2]
        if not (assets.ok and supply.ok):
            out.rejected.append((address, "totalAssets/totalSupply unreadable"))
            continue
        A, S = assets.uint(), supply.uint()
        if A <= 0 or S <= 0:
            out.rejected.append((address, "empty vault"))
            continue
        block = quotes[per * k: per * (k + 1)]
        seen = {DEPOSIT: block[:len(CHECK_SIZES)], REDEEM: block[len(CHECK_SIZES):]}
        # The plain ratio and OpenZeppelin's virtual offset, in that order --
        # they agree at most sizes, so whichever is tried first would "pass" on
        # a vault that is really the other.  Harmless *because* both must
        # reproduce every check point to be kept at all.
        variants = {
            DEPOSIT: (Vault(num=S, den=A), Vault(num=S + 1, den=A + 1)),
            REDEEM: (Vault(num=A, den=S), Vault(num=A + 1, den=S + 1)),
        }
        for kind, answers in seen.items():
            out.checked += 1
            points = [(x, q) for x, q in zip(CHECK_SIZES, answers, strict=True)
                      if q.ok and q.uint() > 0]
            if not points:
                out.rejected.append((f"{address}:{kind.name}", "would not quote"))
                continue
            for model in variants[kind]:
                if all(model.convert(x) == q.uint() for x, q in points):
                    out.by_key[(address, kind)] = model
                    break
            else:
                out.rejected.append((f"{address}:{kind.name}", "no ratio reproduced it"))

    if not quiet:
        print(f"  exact vaults: {len(out)} of {out.checked} directions reproduce "
              f"their own preview to the wei")
    return out
