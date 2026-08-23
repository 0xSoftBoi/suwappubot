"""Core data types.

`ArcKind` values are wire format: they must match the constants in
`contracts/RouteQuoter.vy` exactly.  `tests/test_quoter_client.py` reads them
back off the deployed contract and asserts equality, so the two cannot drift.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import IntEnum, StrEnum


class ArcKind(IntEnum):
    SWAP_STABLE = 0  # get_dy(int128,int128,uint256)
    SWAP_CRYPTO = 1  # get_dy(uint256,uint256,uint256)
    DEPOSIT_FIXED = 2  # calc_token_amount(uint256[N],bool)
    DEPOSIT_DYN = 3  # calc_token_amount(uint256[],bool)
    DEPOSIT_FIXED_NOFLAG = 4  # calc_token_amount(uint256[N])
    WITHDRAW_STABLE = 5  # calc_withdraw_one_coin(uint256,int128)
    WITHDRAW_CRYPTO = 6  # calc_withdraw_one_coin(uint256,uint256)
    ERC4626_DEPOSIT = 7  # previewDeposit(uint256)
    ERC4626_REDEEM = 8  # previewRedeem(uint256)
    WRAP_NATIVE = 9  # 1:1, no call
    UNWRAP_NATIVE = 10  # 1:1, no call
    WSTETH_UNWRAP = 11  # getStETHByWstETH(uint256)
    WSTETH_WRAP = 12  # getWstETHByStETH(uint256)
    STAKE_NATIVE = 13  # native -> LST at 1:1 (Lido submit, frxETHMinter)
    # 14 is deliberately absent.  It was `SWAP_UNDERLYING` on an abandoned
    # branch, and `data/facts` still records that survey under it.
    LEND_MINT = 15  # underlying -> cToken, at `exchangeRateStored`
    LEND_REDEEM = 16  # cToken -> underlying, at `exchangeRateStored`

    @property
    def is_lending(self) -> bool:
        """A lending wrapper leg, which is not a swap and not a merge.

        Not a merge because the two directions differ: Compound V2 answers
        "mint is paused" and redeems fine, Aave V2 freezes reserves the same
        way.  A node merge is symmetric and could not say that, so these are
        arcs -- per direction, and only where `data/facts` saw it working.
        """
        return self in (ArcKind.LEND_MINT, ArcKind.LEND_REDEEM)

    @property
    def is_swap(self) -> bool:
        return self in (ArcKind.SWAP_STABLE, ArcKind.SWAP_CRYPTO)

    @property
    def is_deposit(self) -> bool:
        return self in (
            ArcKind.DEPOSIT_FIXED,
            ArcKind.DEPOSIT_DYN,
            ArcKind.DEPOSIT_FIXED_NOFLAG,
        )

    @property
    def is_withdraw(self) -> bool:
        return self in (ArcKind.WITHDRAW_STABLE, ArcKind.WITHDRAW_CRYPTO)

    @property
    def touches_pool_state(self) -> bool:
        """Wrap/ERC4626 legs are linear and stateless from the router's view."""
        return self.is_swap or self.is_deposit or self.is_withdraw


class Dialect(StrEnum):
    """Which index type a pool's swap ABI uses.  Never inferred from one probe."""

    STABLE = "int128"
    CRYPTO = "uint256"


class FlagReason(StrEnum):
    NONE = "NONE"
    DIVIDED_DIFF = "DIVIDED_DIFF"
    STRUCTURAL = "STRUCTURAL"
    CLAMPED = "CLAMPED"
    BOTH = "BOTH"


def _check_indices(kind: ArcKind, i: int, j: int) -> None:
    """A swap with i == j reverts on every real pool.

    Enforced at construction because the failure is otherwise invisible: the
    quoter returns 0, the route is dropped as "unroutable", and nothing says
    why.  Same reasoning as rejecting empty returndata.
    """
    if kind.is_swap and i == j:
        raise ValueError(f"{kind.name} needs i != j (got i=j={i})")


@dataclass(frozen=True, slots=True)
class Probe:
    """One (pool, direction, size) quote request."""

    pool: str
    kind: ArcKind
    i: int
    j: int
    n: int
    dx: int

    def __post_init__(self) -> None:
        _check_indices(self.kind, self.i, self.j)

    def as_tuple(self) -> tuple:
        return (self.pool, int(self.kind), self.i, self.j, self.n, self.dx)


@dataclass(frozen=True, slots=True)
class Leg:
    """One executable step of a route.

    `bps` is a fraction of the *current* balance at `src_slot`, snapshotted when
    the group of legs leaving that slot opens.  `bps == 0` means "take whatever
    is left", which is how the last leg out of a node avoids dust.  This is what
    the on-chain router will execute, not a quoting convenience.
    """

    target: str
    kind: ArcKind
    i: int = 0
    j: int = 1
    n: int = 2
    src_slot: int = 0
    dst_slot: int = 1
    bps: int = 0

    def __post_init__(self) -> None:
        _check_indices(self.kind, self.i, self.j)
        if self.src_slot == self.dst_slot:
            raise ValueError(f"leg must move between slots (got {self.src_slot})")
        if not 0 <= self.bps <= 10_000:
            raise ValueError(f"bps out of range: {self.bps}")

    def as_tuple(self) -> tuple:
        return (
            self.target,
            int(self.kind),
            self.i,
            self.j,
            self.n,
            self.src_slot,
            self.dst_slot,
            self.bps,
        )


@dataclass(frozen=True, slots=True)
class ProbeLadder:
    """Provenance for a calibration: every number the fit was derived from."""

    deltas: tuple[int, ...]
    quotes: tuple[int | None, ...]
    reserve_in: int
    decimals_in: int
    decimals_out: int
    block: int


@dataclass(slots=True)
class PoolArc:
    """One direction of one pool interaction (spec §15).

    Always per-direction, never per-pool: `B` differs between directions by
    three powers of the price even on a plain constant-product pool, and on
    dynamic-fee pools exactly one of the pair carries CONVEX_FLAG.
    """

    id: str
    pool: str
    kind: ArcKind
    i: int
    j: int
    n_coins: int
    token_in: str
    token_out: str
    tau: int  # canonical node index, post-merge
    sigma: int

    # calibration, in canonical (post node-merge) units
    a: float = 0.0
    B: float = 0.0
    cap: float = math.inf
    calib_delta: float = 0.0

    # §2.3 / §12.2 diagnostics
    convex_flag: bool = False
    clamped: bool = False
    flag_reason: FlagReason = FlagReason.NONE
    drift: float = 0.0
    eta: float = math.nan
    asym: float = math.nan
    gamma_live: float = math.nan

    # derived (§3.1 M3/M4), filled by graph.build
    G: float = 0.0
    eps: float = 0.0

    # node-merge rescaling, so realize() can invert it exactly
    rate_in: float = 1.0
    rate_out: float = 1.0

    reserve_in: int = 0
    decimals_in: int = 18
    decimals_out: int = 18
    tvl_usd: float = 0.0
    reverse_id: str | None = None
    ladder: ProbeLadder | None = None
    note: str = ""

    @property
    def resistance(self) -> float:
        return math.inf if self.G <= 0 else 1.0 / self.G


@dataclass(slots=True)
class Diagnostics:
    max_theta: float = 0.0
    max_drift: float = 0.0
    max_eta_dev: float = 0.0
    total_loss_frac: float = 0.0
    fee_loss_frac: float = 0.0
    impact_loss_frac: float = 0.0
    pivots: int = 0
    cg_rounds: int = 0
    pins_evaluated: int = 0
    kcl_residual: float = 0.0
    duality_gap: float = 0.0
    cond_G: float = 0.0
    arcs_universe: int = 0
    arcs_priced_out: int = 0
    pools_universe: int = 0
    wall_ms: dict[str, float] = field(default_factory=dict)
