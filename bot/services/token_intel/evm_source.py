"""EVM data source for Token Intel — free, keyless Blockscout public REST v2 APIs.

Every function here is defensive: on any network/parsing failure it appends a
short note to the report and returns without raising, so a single flaky
endpoint never takes down the whole /intel report.
"""

import logging
from typing import Dict, List, Optional

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Public, keyless Blockscout instance base URLs per chain. Best-effort mapping —
# if an instance is unreachable, the affected report fields degrade to None/[]
# with a note rather than raising.
BLOCKSCOUT_BASE_URLS: Dict[str, str] = {
    "ethereum": "https://eth.blockscout.com",
    "base": "https://base.blockscout.com",
    "bsc": "https://bsc.blockscout.com",
    "polygon": "https://polygon.blockscout.com",
    "arbitrum": "https://arbitrum.blockscout.com",
    "optimism": "https://optimism.blockscout.com",
    # Robinhood runs its own Blockscout. Verified live: /api/v2/tokens/{addr}
    # and /holders both serve, and holders correctly flags the UniswapV3Pool as
    # a contract, which _holder_row already excludes from the float.
    # NOTE: Blockscout v2 paginates by cursor and ignores ?limit — passing one
    # silently returns an empty items array, which reads as "no holders".
    "robinhood": "https://robinhoodchain.blockscout.com",
}

# Chains we can discover and trade but cannot measure holder concentration on.
# HyperEVM has no Blockscout instance (hyperevm.blockscout.com is 404 and
# hyperscan.com redirects off-chain), so the holder gate can never pass there.
# Listed explicitly so a permanently-refused chain is a known fact rather than a
# silent stream of "holder distribution unknown" rejections.
CHAINS_WITHOUT_HOLDER_DATA = frozenset({"hyperevm"})

# Snipe-detection window: buys within this many seconds of the earliest known
# transfer are treated as "sniped in".
SNIPE_WINDOW_SECONDS = 60
# Cap on how many pages of the transfers/transactions endpoints we'll walk —
# these are free, shared, rate-limited instances; don't hammer them.
MAX_PAGES = 5
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _base_url(chain: str) -> Optional[str]:
    return BLOCKSCOUT_BASE_URLS.get(chain)


async def _get_json(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET JSON via the shared session/rate-limiter. Returns None on any failure."""
    try:
        await api_limiter.wait_and_acquire("blockscout")
        session = await get_session()
        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception as e:
        logger.warning("token_intel blockscout GET failed (%s): %s", url, e)
        return None


async def enrich_report(
    report, chain: str, quick: bool = False, skip_holders: bool = False
) -> None:
    """Populate an EVM TokenIntelReport in place. Never raises.

    quick=True runs only the enrichments a risk gate needs — token info and
    holder distribution — and skips deployer history, bundle/snipe detection and
    cluster hints. Those walk many pages of transfers and dominate the latency:
    the full report legitimately takes tens of seconds on a cold token, which is
    fine for an on-demand /intel command and far too slow for a trading loop
    that must decide before its quote goes stale.

    skip_holders=True when GoPlus (bot/services/token_intel/goplus_source.py)
    already answered the holder-concentration question for this chain. This
    endpoint is Base Blockscout's proven-unreliable /holders call — HTTP 200
    with the body "Internal server error" — and there is no reason to pay its
    latency and failure risk for data we are about to overwrite anyway.
    """
    base = _base_url(chain)
    if not base:
        report.notes.append(f"no_blockscout_instance_for_{chain}")
        return

    await _enrich_token_info(report, base)
    if not quick:
        await _enrich_deployer(report, base)
        if report.deployer:
            await _enrich_deployer_stats(report, base)
    if not skip_holders:
        await _enrich_holders(report, base)
    if quick:
        report.notes.append("quick_scan")
        return
    await _enrich_bundle_and_snipe(report, base)
    if report.top_holders:
        await _enrich_cluster_hints(report, base)


async def _enrich_token_info(report, base: str) -> None:
    data = await _get_json(f"{base}/api/v2/tokens/{report.token_address}")
    if not data:
        report.notes.append("evm_token_info_unavailable")
        return
    report.name = report.name or data.get("name")
    report.symbol = report.symbol or data.get("symbol")
    try:
        report.total_supply = float(data.get("total_supply") or 0)
    except (TypeError, ValueError):
        report.total_supply = None


async def _enrich_deployer(report, base: str) -> None:
    # Preferred: address endpoint exposes creator_address_hash directly.
    data = await _get_json(f"{base}/api/v2/addresses/{report.token_address}")
    creator = None
    if data:
        creator_field = data.get("creator_address_hash") or data.get("creator_address")
        if isinstance(creator_field, dict):
            creator = creator_field.get("hash")
        else:
            creator = creator_field

    if not creator:
        # Fallback: smart-contracts endpoint.
        sc_data = await _get_json(f"{base}/api/v2/smart-contracts/{report.token_address}")
        if sc_data:
            creator = sc_data.get("creator_address_hash") or sc_data.get("creator_address")

    if creator:
        report.deployer = creator
    else:
        report.notes.append("evm_deployer_unresolved")


async def _enrich_deployer_stats(report, base: str) -> None:
    """Heuristic serial-deployer check: scan the deployer's recent transactions
    for contract-creation txs, then check each created contract for near-zero
    recent transfer activity (a proxy for "dead"/rugged).
    """
    created_contracts: List[str] = []
    next_params: Optional[dict] = None

    try:
        for _ in range(MAX_PAGES):
            params = dict(next_params) if next_params else {}
            data = await _get_json(
                f"{base}/api/v2/addresses/{report.deployer}/transactions", params=params
            )
            if not data:
                break
            for item in data.get("items", []):
                # Contract-creation transactions have no `to` and carry the
                # newly created contract's hash.
                if item.get("to") is not None:
                    continue
                created = item.get("created_contract")
                created_hash = created.get("hash") if isinstance(created, dict) else created
                if created_hash and created_hash not in created_contracts:
                    created_contracts.append(created_hash)
                if len(created_contracts) >= 15:
                    break
            if len(created_contracts) >= 15:
                break
            next_params = data.get("next_page_params")
            if not next_params:
                break
    except Exception as e:
        logger.warning("token_intel deployer tx scan failed: %s", e)
        report.notes.append("evm_deployer_history_error")
        return

    report.deployer_prior_deploys = len(created_contracts)

    dead_count = 0
    checked = 0
    for contract_hash in created_contracts:
        if contract_hash.lower() == report.token_address.lower():
            continue  # don't count the token being analyzed against itself
        counters = await _get_json(f"{base}/api/v2/tokens/{contract_hash}/counters")
        checked += 1
        if counters is None:
            continue
        try:
            transfers_count = int(counters.get("transfers_count") or 0)
            holders_count = int(counters.get("token_holders_count") or 0)
        except (TypeError, ValueError):
            continue
        if transfers_count < 5 or holders_count <= 1:
            dead_count += 1

    report.deployer_dead_deploys = dead_count if checked else None


# Sum of returned balances above this multiple of the reported total supply
# means the denominator is wrong, not that holders own more than everything.
_SUPPLY_SANITY_MULTIPLE = 1.05


def _holder_row(item: dict) -> Optional[dict]:
    """Normalise one Blockscout holder item, or None if it is unreadable."""
    addr_field = item.get("address")
    is_contract = False
    label = None
    if isinstance(addr_field, dict):
        addr = addr_field.get("hash")
        is_contract = bool(addr_field.get("is_contract"))
        label = addr_field.get("name")
    else:
        addr = addr_field
    if not addr:
        return None
    try:
        balance = float(item.get("value") or 0)
    except (TypeError, ValueError):
        return None
    return {"address": addr, "balance": balance, "is_contract": is_contract, "label": label}


async def _enrich_holders(report, base: str) -> None:
    """Measure concentration across the top *wallets*.

    Two things this deliberately does not do:

    - It does not count contracts. Observed on Base: a token whose top ten
      "holders" were seven contracts — an ERC1967Proxy, a Safe, a transparent
      proxy and unnamed pools — reported 101.5% concentration and was refused.
      The real wallet concentration was 34.9%. A liquidity pool holding supply
      is the opposite of the risk this measure exists to catch.
    - It does not report a number it cannot stand behind. If the balances
      returned exceed the reported total supply, the supply figure is stale or
      wrong, and top10_pct is left as None so callers treat it as unknown.
    """
    data = await _get_json(f"{base}/api/v2/tokens/{report.token_address}/holders")
    if not data:
        report.notes.append("evm_holders_unavailable")
        return

    rows = [r for r in (_holder_row(i) for i in data.get("items", [])) if r]
    supply = report.total_supply

    if not supply:
        report.notes.append("evm_supply_unknown")
        report.set_top_holders([{**r, "pct": None} for r in rows[:10]])
        return

    returned_total = sum(r["balance"] for r in rows)
    if returned_total > supply * _SUPPLY_SANITY_MULTIPLE:
        # Holders cannot own more than the supply. Refuse to publish a ratio
        # built on a denominator this clearly wrong.
        report.notes.append("evm_supply_inconsistent")
        report.set_top_holders([{**r, "pct": None} for r in rows[:10]])
        return

    contract_balance = sum(r["balance"] for r in rows if r["is_contract"])
    report.contract_held_pct = round(contract_balance / supply * 100, 2)

    wallets = [r for r in rows if not r["is_contract"]][:10]
    report.set_top_holders([{**r, "pct": r["balance"] / supply * 100} for r in wallets])


async def _enrich_bundle_and_snipe(report, base: str) -> None:
    """Walk the token's transfer history (bounded pages) to find the earliest
    activity, then derive:
      - bundle_buyer_count: distinct recipients in the earliest known block
      - snipe_buyer_count: distinct recipients within SNIPE_WINDOW_SECONDS of
        the earliest known transfer's timestamp
    """
    transfers: List[dict] = []
    next_params: Optional[dict] = None

    try:
        for _ in range(MAX_PAGES):
            params = dict(next_params) if next_params else {}
            data = await _get_json(
                f"{base}/api/v2/tokens/{report.token_address}/transfers", params=params
            )
            if not data:
                break
            transfers.extend(data.get("items", []))
            next_params = data.get("next_page_params")
            if not next_params:
                break
    except Exception as e:
        logger.warning("token_intel transfers scan failed: %s", e)
        report.notes.append("evm_transfers_error")
        return

    if not transfers:
        report.notes.append("evm_no_transfer_history")
        return
    if next_params:
        report.notes.append("evm_transfer_history_capped")

    # Blockscout returns newest-first; the last page walked holds the oldest
    # transfers we were able to reach within MAX_PAGES.
    def _block_num(t):
        return t.get("block_number") or t.get("block") or 0

    oldest = sorted(transfers, key=_block_num)
    if not oldest:
        return

    earliest_block = _block_num(oldest[0])
    earliest_ts = oldest[0].get("timestamp")

    bundle_recipients = set()
    snipe_recipients = set()

    from datetime import datetime

    def _parse_ts(raw):
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return None

    earliest_dt = _parse_ts(earliest_ts)

    for t in oldest:
        to_field = t.get("to")
        to_addr = to_field.get("hash") if isinstance(to_field, dict) else to_field
        if not to_addr or to_addr.lower() == ZERO_ADDRESS:
            continue

        if _block_num(t) == earliest_block:
            bundle_recipients.add(to_addr)

        t_dt = _parse_ts(t.get("timestamp"))
        if earliest_dt and t_dt:
            if (t_dt - earliest_dt).total_seconds() <= SNIPE_WINDOW_SECONDS:
                snipe_recipients.add(to_addr)

    report.bundle_buyer_count = len(bundle_recipients)
    report.snipe_buyer_count = len(snipe_recipients)


async def _enrich_cluster_hints(report, base: str) -> None:
    """For each top-10 holder, find the earliest reachable incoming native
    transfer's sender ("funder") and group holders sharing a funder — a
    classic "bubble map" cluster hint. Bounded and best-effort per holder.
    """
    funders: Dict[str, str] = {}

    for holder in report.top_holders[:10]:
        addr = holder.address
        if not addr:
            continue
        try:
            oldest_from = None
            next_params: Optional[dict] = None
            for _ in range(2):  # bounded: don't fully paginate arbitrary wallets
                params = dict(next_params) if next_params else {}
                data = await _get_json(
                    f"{base}/api/v2/addresses/{addr}/transactions", params=params
                )
                if not data:
                    break
                items = data.get("items", [])
                for item in items:
                    to_field = item.get("to")
                    to_addr = to_field.get("hash") if isinstance(to_field, dict) else to_field
                    if to_addr and to_addr.lower() == addr.lower():
                        oldest_from = item.get("from")
                next_params = data.get("next_page_params")
                if not next_params:
                    break
            if oldest_from:
                from_addr = (
                    oldest_from.get("hash") if isinstance(oldest_from, dict) else oldest_from
                )
                if from_addr:
                    funders[addr] = from_addr
        except Exception as e:
            logger.debug("token_intel cluster hint skipped for %s: %s", addr, e)
            continue

    groups: Dict[str, List[str]] = {}
    for holder_addr, funder in funders.items():
        groups.setdefault(funder, []).append(holder_addr)

    report.cluster_groups = [members for members in groups.values() if len(members) >= 2]
