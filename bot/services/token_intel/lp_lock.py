"""LP-lock detection for EVM pairs.

Answers one question: can the deployer pull the liquidity?

The honest answer has three states, and conflating the last two is how a
safety gate becomes theatre:

  True   — a decisive majority of the LP supply is burned or held by a known
           locker contract. The rug is materially harder.
  False  — the LP supply is liquid and held by ordinary addresses. Pullable.
  None   — we could not tell. Not a verdict.

`None` is returned far more often than is comfortable, and that is correct.
A Uniswap V3 pool has no fungible LP token at all — positions are NFTs held by
the position manager — so asking "who holds the LP token" is meaningless there.
Reporting that as `False` would flag every V3 pool on Base as rug-prone, which
is both wrong and the kind of plausible-looking lie this codebase keeps
producing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from .evm_source import BLOCKSCOUT_BASE_URLS, _get_json

logger = logging.getLogger(__name__)

# Anything sent here is unrecoverable.
BURN_ADDRESSES = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0xdead000000000000000000000000000000000000",
}

# Locker contracts, lowercased. A lock is time-bound and can expire, so this is
# evidence of intent rather than a guarantee — but an LP sitting in one of these
# cannot be pulled on a whim.
KNOWN_LOCKERS = {
    # Team Finance
    "0xe2fe530c047f2d85298b07d9333c05737f1435fb": "team_finance",
    "0x7f5c649856f900d15c83741f45ae46f5c6858234": "team_finance",
    # UNCX / Unicrypt
    "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "uncx",
    "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0": "uncx",
    # PinkLock
    "0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe": "pinklock",
    "0x71b5759d73262fbb223956913ecf4ecc51057641": "pinklock",
}

# Share of LP supply that must be burned or locked before we call it locked.
LOCKED_THRESHOLD_PCT = 50.0


@dataclass
class LpLockResult:
    """`locked` is None when undetermined — never coerce it to a boolean."""

    locked: Optional[bool]
    burned_pct: float = 0.0
    locked_pct: float = 0.0
    locker: Optional[str] = None
    reason: str = ""


async def check_lp_lock(chain: str, pair_address: str) -> LpLockResult:
    """Inspect who holds the LP token for one pair."""
    if not pair_address:
        return LpLockResult(locked=None, reason="no pair address")

    base = BLOCKSCOUT_BASE_URLS.get((chain or "").lower())
    if not base:
        return LpLockResult(locked=None, reason=f"no explorer for {chain}")

    addr = pair_address.lower()

    # A V3 pool is not an ERC-20, so this call fails and we must not read that
    # failure as "the LP is unlocked".
    token = await _get_json(f"{base}/api/v2/tokens/{addr}")
    if not isinstance(token, dict):
        return LpLockResult(
            locked=None, reason="pair is not a fungible LP token (likely a V3 pool)"
        )

    try:
        total_supply = float(token.get("total_supply") or 0)
        decimals = int(token.get("decimals") or 18)
    except (TypeError, ValueError):
        return LpLockResult(locked=None, reason="unreadable LP supply")
    if total_supply <= 0:
        return LpLockResult(locked=None, reason="LP supply is zero or unknown")

    # NOTE: Blockscout v2 paginates by cursor and IGNORES ?limit. Passing one
    # returns an empty items array, which reads exactly like "nobody holds this".
    holders = await _get_json(f"{base}/api/v2/tokens/{addr}/holders")
    if not isinstance(holders, dict) or not isinstance(holders.get("items"), list):
        return LpLockResult(locked=None, reason="LP holder list unavailable")

    items = holders["items"]
    if not items:
        return LpLockResult(locked=None, reason="LP holder list empty")

    burned = 0.0
    locked = 0.0
    locker_name: Optional[str] = None
    scale = 10**decimals

    for row in items:
        address = ((row.get("address") or {}).get("hash") or "").lower()
        try:
            value = float(row.get("value") or 0) / scale
        except (TypeError, ValueError):
            continue
        if address in BURN_ADDRESSES:
            burned += value
        elif address in KNOWN_LOCKERS:
            locked += value
            locker_name = locker_name or KNOWN_LOCKERS[address]

    supply = total_supply / scale
    if supply <= 0:
        return LpLockResult(locked=None, reason="LP supply is zero after scaling")

    burned_pct = burned / supply * 100
    locked_pct = locked / supply * 100
    secured = burned_pct + locked_pct

    if secured >= LOCKED_THRESHOLD_PCT:
        return LpLockResult(
            locked=True,
            burned_pct=burned_pct,
            locked_pct=locked_pct,
            locker=locker_name,
            reason=f"{secured:.1f}% of LP burned or locked",
        )
    return LpLockResult(
        locked=False,
        burned_pct=burned_pct,
        locked_pct=locked_pct,
        locker=locker_name,
        reason=f"only {secured:.1f}% of LP burned or locked",
    )
