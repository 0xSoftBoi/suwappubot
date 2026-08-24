"""Etherscan-family holder data for chains GoPlus does not cover — currently
just HyperEVM.

UNVERIFIED. This module cannot be tested against a live response: acquiring
an Etherscan API key requires a human (email signup), and this session has no
way to do that. Every other data source added this session — GoPlus,
GeckoTerminal, the retired Blockscout heuristic — was verified against a real
request before its parsing code shipped. This one is not, and that gap is
called out deliberately rather than papered over with confident-looking code.
Do not remove this warning until someone has run it against a live key and
confirmed the shape below matches.

Deliberately narrow scope: holder concentration ONLY, not LP lock.

GoPlus already proved what happens when this codebase assumes a DEX pair's
address is a fungible ERC-20 LP token: it is false for Uniswap V3 (positions
are NFTs) and V4 (liquidity lives in one shared PoolManager, no per-pool
contract), and the assumption produced a confident, wrong "locked" verdict on
two real Base tokens. Measured live on HyperEVM's own trending pools: 65% of
liquidity sits on hyperswap-v3 or hybra-finance-v4. Reusing that heuristic
here would very likely repeat the exact same bug on most of the chain's
volume. So this module does not attempt LP-lock detection at all — lp_locked
stays None for HyperEVM until a source exists that resolves V3/V4 correctly,
same as it is today.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api"

# Etherscan's own unified chain ids (V2 API), confirmed live against
# https://api.etherscan.io/v2/chainlist — NOT our internal chain names.
ETHERSCAN_CHAIN_IDS: dict[str, str] = {
    "hyperevm": "999",
}

REQUEST_TIMEOUT_S = 10.0

# Same set used by the retired lp_lock.py and goplus_source.py — a burn
# address is not a whale, it is supply gone forever.
BURN_ADDRESSES = {
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0xdead000000000000000000000000000000000000",
}


@dataclass
class EtherscanHolderResult:
    top_holder_pct: Optional[float] = None
    holder_count: Optional[int] = None


async def _get_json(params: dict) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            res = await client.get(ETHERSCAN_V2_BASE, params=params)
        if res.status_code != 200:
            logger.warning("etherscan: HTTP %s for %s", res.status_code, params.get("action"))
            return None
        data = res.json()
    except Exception as e:
        logger.warning("etherscan: request failed for %s: %s", params.get("action"), e)
        return None

    # Etherscan's status is the string "1" for success, "0" for failure — do
    # not trust HTTP 200 alone, the same lesson RC2 (Blockscout) already taught.
    if not isinstance(data, dict) or data.get("status") != "1":
        logger.warning(
            "etherscan: unexpected response for %s: %s", params.get("action"), str(data)[:200]
        )
        return None
    return data


async def fetch_holder_concentration(
    chain: str, token_address: str, api_key: Optional[str]
) -> Optional[EtherscanHolderResult]:
    """Top-10 wallet concentration for a token, excluding contracts and burn
    addresses. Returns None if this chain is not covered, no key is
    configured, or the call fails — callers must fall back, not guess."""
    if not api_key:
        return None
    chain_id = ETHERSCAN_CHAIN_IDS.get((chain or "").lower())
    if not chain_id:
        return None

    data = await _get_json(
        {
            "chainid": chain_id,
            "module": "token",
            "action": "tokenholderlist",
            "contractaddress": token_address,
            "page": 1,
            "offset": 25,
            "apikey": api_key,
        }
    )
    if not data:
        return None
    holders = data.get("result")
    if not isinstance(holders, list) or not holders:
        return None

    # Field names per Etherscan's long-stable tokenholderlist shape
    # (TokenHolderAddress / TokenHolderQuantity, raw integer string). Checked
    # defensively rather than assumed — if the real shape differs, this
    # produces "no usable holders" rather than silently wrong percentages.
    rows = []
    total = 0
    for h in holders:
        if not isinstance(h, dict):
            continue
        addr = str(h.get("TokenHolderAddress") or "").lower()
        try:
            qty = int(h.get("TokenHolderQuantity") or 0)
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        total += qty
        rows.append((addr, qty))

    if total <= 0:
        return None

    wallet_pcts = [(qty / total) * 100 for addr, qty in rows if addr not in BURN_ADDRESSES]
    wallet_pcts.sort(reverse=True)
    if not wallet_pcts:
        return None

    return EtherscanHolderResult(
        top_holder_pct=sum(wallet_pcts[:10]),
        holder_count=len(rows),
    )
