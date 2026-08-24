"""GoPlus Security as the primary LP-lock and holder-concentration source.

Supersedes the Blockscout-based heuristic in `lp_lock.py`, which is now proven
wrong on the exact tokens used to validate it: for two Base/UniswapV4 pools
(KEYCAT, RUSSELL), it reported `locked=True, burned=99.98%/100%` — a confident,
plausible, WRONG verdict. GoPlus reports both correctly as `is_locked: 0`
(their liquidity sits in the standard V4 position manager, not a locker).

What actually happened: DexScreener's `pairAddress` for a V4 pool is not a
deployed ERC-20 contract (V4 has no per-pool contract — liquidity is tracked
inside one shared PoolManager, keyed by a poolId). The Blockscout heuristic
called `/tokens/{pairAddress}`, and — instead of 404ing — got back data for
something else that happened to look like a valid fungible token with a
sensible-looking 99.98% burn. It never threw. It never logged. It looked
exactly like a correct, safety-conscious refusal criterion holding, when in
fact it was reading the wrong address's data.

GoPlus resolves V2, V3, V4 and Solana AMMs correctly in one call, because it
walks the actual position/vault contracts rather than assuming "the pair
address is a fungible LP token" — the assumption that broke the old code.

Two request shapes, one output. EVM is `/token_security/{chain_id}`, keyed by
GoPlus's own numeric chain ids (not ours). Solana is a separate endpoint,
`/solana/token_security`, with a materially different response: no `lp_holders`
array — instead a `dex[].burn_percent` per pool.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GOPLUS_BASE = "https://api.gopluslabs.io/api/v1"

# GoPlus's own chain ids, verified live against /api/v1/supported_chains —
# NOT the same namespace as our internal chain names or LI.FI ids.
GOPLUS_EVM_CHAIN_IDS: dict[str, str] = {
    "base": "8453",
    "bsc": "56",
    "robinhood": "4663",
    # Confirmed absent from GoPlus's supported_chains list. HyperEVM has no
    # security-data source anywhere we have found; see CHAINS_WITHOUT_HOLDER_DATA.
}

LOCKED_THRESHOLD_PCT = 50.0
REQUEST_TIMEOUT_S = 10.0

# Same set the retired lp_lock.py used. A burn address holding 99% of supply
# is not a whale that can dump — it is supply permanently removed from
# circulation, which is the opposite of a concentration risk. GoPlus's own
# `holders` array does not distinguish this from an ordinary wallet: it
# marked the dead address `is_contract: 0` on every token tested. Left
# unexcluded, every heavily-burned fair-launch memecoin — a common, benign
# pattern — would fail top_holder_pct for exactly the wrong reason.
BURN_ADDRESSES = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0xdead000000000000000000000000000000000000",
}

# GoPlus documents no public rate limit and 15 rapid unauthenticated calls
# during testing returned clean 200s, but "undocumented" is not "unlimited" —
# same reasoning that made the GeckoTerminal 429 a surprise. Stay polite.
_MIN_INTERVAL_S = 0.5
_next_allowed_at = 0.0


async def _throttled_get(url: str) -> Optional[dict]:
    global _next_allowed_at
    import asyncio

    now = time.monotonic()
    wait = _next_allowed_at - now
    _next_allowed_at = max(now, _next_allowed_at) + _MIN_INTERVAL_S
    if wait > 0:
        await asyncio.sleep(wait)

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            res = await client.get(url)
        if res.status_code != 200:
            logger.warning("goplus: HTTP %s for %s", res.status_code, url)
            return None
        data = res.json()
    except Exception as e:
        logger.warning("goplus: request failed for %s: %s", url, e)
        return None

    # Validate shape, not just status — the lesson RC2 already taught this
    # codebase once. `code` is GoPlus's own success marker; 1 means OK.
    if not isinstance(data, dict) or data.get("code") != 1:
        logger.warning("goplus: unexpected response shape for %s: %s", url, str(data)[:200])
        return None
    result = data.get("result")
    if not isinstance(result, dict) or not result:
        return None
    return result


@dataclass
class GoPlusResult:
    top_holder_pct: Optional[float] = None
    contract_held_pct: Optional[float] = None
    lp_locked: Optional[bool] = None
    lp_lock_reason: str = ""
    is_honeypot: Optional[bool] = None
    buy_tax_bps: Optional[int] = None
    sell_tax_bps: Optional[int] = None
    mintable: Optional[bool] = None
    freezable: Optional[bool] = None


def _top_holder_pct(holders: list) -> tuple[Optional[float], Optional[float]]:
    """(top_holder_pct excluding contracts AND burn addresses, contract_held_pct).

    Mirrors the existing evm_source convention — a deep pool is not a whale —
    and extends it: a burn address is not a whale either. GoPlus tags burn
    addresses `is_contract: 0`, same as an ordinary wallet, so this excludes
    them by address rather than by that flag.
    """
    if not holders:
        return None, None
    contract_pct = 0.0
    wallet_pcts = []
    for h in holders:
        try:
            pct = float(h.get("percent") or 0) * 100
        except (TypeError, ValueError):
            continue
        address = (h.get("address") or "").lower()
        if address in BURN_ADDRESSES:
            continue
        if h.get("is_contract"):
            contract_pct += pct
        else:
            wallet_pcts.append(pct)
    wallet_pcts.sort(reverse=True)
    top10 = sum(wallet_pcts[:10]) if wallet_pcts else None
    return top10, contract_pct


async def _fetch_evm(chain_id: str, token_address: str) -> Optional[dict]:
    url = f"{GOPLUS_BASE}/token_security/{chain_id}?contract_addresses={token_address}"
    result = await _throttled_get(url)
    if not result:
        return None
    # Keyed by the address we sent; GoPlus has been observed to echo it back
    # verbatim (lowercase in, lowercase out) in every case tested, but take
    # whatever single entry came back rather than assume exact-key match.
    return result.get(token_address.lower()) or (next(iter(result.values()), None))


async def _fetch_solana(token_address: str) -> Optional[dict]:
    url = f"{GOPLUS_BASE}/solana/token_security?contract_addresses={token_address}"
    result = await _throttled_get(url)
    if not result:
        return None
    return result.get(token_address) or (next(iter(result.values()), None))


def _parse_evm(tok: dict) -> GoPlusResult:
    out = GoPlusResult()
    holders = tok.get("holders") or []
    out.top_holder_pct, out.contract_held_pct = _top_holder_pct(holders)

    lp_holders = tok.get("lp_holders") or []
    if not lp_holders:
        out.lp_locked = None
        out.lp_lock_reason = "no LP holder data returned"
    else:
        secured = 0.0
        for h in lp_holders:
            try:
                pct = float(h.get("percent") or 0) * 100
            except (TypeError, ValueError):
                continue
            if h.get("is_locked"):
                secured += pct
        out.lp_locked = secured >= LOCKED_THRESHOLD_PCT
        out.lp_lock_reason = f"{secured:.1f}% of LP is_locked per GoPlus"

    if tok.get("is_honeypot") is not None:
        out.is_honeypot = str(tok["is_honeypot"]) == "1"
    for key, attr in (("buy_tax", "buy_tax_bps"), ("sell_tax", "sell_tax_bps")):
        v = tok.get(key)
        if v is not None:
            try:
                setattr(out, attr, round(float(v) * 10_000))
            except (TypeError, ValueError):
                pass
    if tok.get("is_mintable") is not None:
        out.mintable = str(tok["is_mintable"]) == "1"
    return out


def _parse_solana(tok: dict) -> GoPlusResult:
    out = GoPlusResult()
    holders = tok.get("holders") or []
    out.top_holder_pct, out.contract_held_pct = _top_holder_pct(holders)

    # No lp_holders on Solana — burn_percent per pool is the direct signal.
    # Take the pool with the largest recorded volume as representative rather
    # than the max burn_percent, which would let a $50 decoy pool with 100%
    # burn override the real, liquid, unlocked pool everyone actually trades.
    pools = [p for p in (tok.get("dex") or []) if p.get("burn_percent") is not None]
    if not pools:
        out.lp_locked = None
        out.lp_lock_reason = "no LP burn data returned"
    else:

        def _vol(p: dict) -> float:
            try:
                return float((p.get("day") or {}).get("volume") or 0)
            except (TypeError, ValueError):
                return 0.0

        primary = max(pools, key=_vol)
        try:
            burn_pct = float(primary["burn_percent"])
        except (TypeError, ValueError):
            burn_pct = 0.0
        out.lp_locked = burn_pct >= LOCKED_THRESHOLD_PCT
        out.lp_lock_reason = f"{burn_pct:.1f}% of LP burned on {primary.get('dex_name', '?')}"

    mint = tok.get("mintable") or {}
    if isinstance(mint, dict) and "status" in mint:
        out.mintable = str(mint["status"]) == "1"
    freeze = tok.get("freezable") or {}
    if isinstance(freeze, dict) and "status" in freeze:
        out.freezable = str(freeze["status"]) == "1"
    return out


async def fetch(chain: str, token_address: str) -> Optional[GoPlusResult]:
    """Single entry point. Returns None when GoPlus does not cover this chain
    or the call failed — callers must fall back, not treat None as a verdict."""
    chain = (chain or "").lower()
    if chain == "solana":
        tok = await _fetch_solana(token_address)
        return _parse_solana(tok) if tok else None

    chain_id = GOPLUS_EVM_CHAIN_IDS.get(chain)
    if not chain_id:
        return None
    tok = await _fetch_evm(chain_id, token_address)
    return _parse_evm(tok) if tok else None
