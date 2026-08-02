"""Solana data source for Token Intel — plain JSON-RPC only (free, keyless).

Uses rpc_manager's health-tracked Solana endpoint (falls back to SOLANA_RPC_URL
via settings, same as the rest of the codebase). Every call is wrapped so a
single RPC failure only degrades one field, never the whole report.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bot.services.rpc_manager import rpc_manager
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

SNIPE_WINDOW_SECONDS = 60
# Bounded: we approximate "earliest activity" from the oldest page(s) we can
# reach rather than paginating a possibly-huge history back to genesis.
MAX_SIGNATURE_PAGES = 3
SIGNATURES_PER_PAGE = 1000
# Cluster hints touch far more wallets than top10 — keep this tight to bound
# RPC usage on a free/shared endpoint.
CLUSTER_HOLDER_LIMIT = 5


async def _rpc_call(method: str, params: list, note: str, report) -> Optional[Any]:
    try:
        await api_limiter.wait_and_acquire("solana_rpc")
        session = await get_session()
        url = rpc_manager.get_rpc_url("solana")
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        async with session.post(url, json=payload) as resp:
            if resp.status != 200:
                report.notes.append(f"{note}_http_{resp.status}")
                return None
            data = await resp.json()
        if "error" in data:
            report.notes.append(note)
            return None
        return data.get("result")
    except Exception as e:
        logger.warning("token_intel solana %s failed: %s", method, e)
        report.notes.append(note)
        return None


async def enrich_report(report) -> None:
    """Populate a Solana TokenIntelReport in place. Never raises."""
    mint = report.token_address

    await _enrich_supply_and_holders(report, mint)
    await _enrich_mint_authority_and_deployer(report, mint)
    await _enrich_bundle_and_snipe(report, mint)
    if report.top_holders:
        await _enrich_cluster_hints(report)


async def _enrich_supply_and_holders(report, mint: str) -> None:
    supply_result = await _rpc_call("getTokenSupply", [mint], "solana_supply_error", report)
    supply = None
    if supply_result:
        try:
            supply = float(supply_result["value"]["amount"])
        except (KeyError, TypeError, ValueError):
            supply = None
    report.total_supply = supply

    largest = await _rpc_call(
        "getTokenLargestAccounts", [mint], "solana_largest_accounts_error", report
    )
    if not largest:
        return

    accounts = largest.get("value", [])[:10]
    token_account_pubkeys = [a.get("address") for a in accounts if a.get("address")]

    # Resolve token-account -> owner wallet in a single batched call rather
    # than one RPC round trip per holder.
    owners: Dict[str, str] = {}
    if token_account_pubkeys:
        multi = await _rpc_call(
            "getMultipleAccounts",
            [token_account_pubkeys, {"encoding": "jsonParsed"}],
            "solana_owner_resolve_error",
            report,
        )
        if multi:
            for pubkey, acct in zip(token_account_pubkeys, multi.get("value", [])):
                try:
                    owner = acct["data"]["parsed"]["info"]["owner"]
                    owners[pubkey] = owner
                except (KeyError, TypeError):
                    continue

    holders = []
    for a in accounts:
        pubkey = a.get("address")
        try:
            balance = float(a.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        pct = (balance / supply * 100) if supply else None
        holders.append({"address": owners.get(pubkey, pubkey), "balance": balance, "pct": pct})

    report.set_top_holders(holders)


async def _enrich_mint_authority_and_deployer(report, mint: str) -> None:
    account_info = await _rpc_call(
        "getAccountInfo", [mint, {"encoding": "jsonParsed"}], "solana_account_info_error", report
    )
    if account_info and account_info.get("value"):
        try:
            info = account_info["value"]["data"]["parsed"]["info"]
            report.mint_authority = info.get("mintAuthority")
        except (KeyError, TypeError):
            pass

    # Deployer heuristic: fee payer of the earliest reachable signature for the mint.
    sigs = await _rpc_call(
        "getSignaturesForAddress",
        [mint, {"limit": SIGNATURES_PER_PAGE}],
        "solana_signatures_error",
        report,
    )
    if not sigs:
        return

    earliest_sig = sigs[-1] if sigs else None
    if not earliest_sig:
        return

    tx = await _rpc_call(
        "getTransaction",
        [
            earliest_sig["signature"],
            {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
        ],
        "solana_earliest_tx_error",
        report,
    )
    if tx:
        try:
            report.deployer = tx["transaction"]["message"]["accountKeys"][0]["pubkey"]
        except (KeyError, TypeError, IndexError):
            try:
                # Legacy (non-parsed) shape fallback: plain pubkey strings.
                report.deployer = tx["transaction"]["message"]["accountKeys"][0]
            except (KeyError, TypeError, IndexError):
                pass


async def _enrich_bundle_and_snipe(report, mint: str) -> None:
    """Approximate bundle/snipe detection from the oldest reachable page(s) of
    signatures for the mint: distinct signatures sharing the earliest slot are
    treated as a "bundle"; distinct signatures within the snipe window of the
    earliest blockTime are treated as "sniped in".
    """
    all_sigs: List[dict] = []
    before = None
    try:
        for _ in range(MAX_SIGNATURE_PAGES):
            params: Dict[str, Any] = {"limit": SIGNATURES_PER_PAGE}
            if before:
                params["before"] = before
            page = await _rpc_call(
                "getSignaturesForAddress", [mint, params], "solana_signatures_error", report
            )
            if not page:
                break
            all_sigs.extend(page)
            if len(page) < SIGNATURES_PER_PAGE:
                break
            before = page[-1]["signature"]
    except Exception as e:
        logger.warning("token_intel solana signature pagination failed: %s", e)
        report.notes.append("solana_signature_pagination_error")

    if not all_sigs:
        return

    oldest = sorted(all_sigs, key=lambda s: s.get("blockTime") or 0)
    earliest_slot = oldest[0].get("slot")
    earliest_ts = oldest[0].get("blockTime")

    bundle_sigs = {s["signature"] for s in oldest if s.get("slot") == earliest_slot}
    snipe_sigs = set()
    if earliest_ts:
        for s in oldest:
            bt = s.get("blockTime")
            if bt is not None and (bt - earliest_ts) <= SNIPE_WINDOW_SECONDS:
                snipe_sigs.add(s["signature"])

    report.bundle_buyer_count = len(bundle_sigs)
    report.snipe_buyer_count = len(snipe_sigs)


async def _enrich_cluster_hints(report) -> None:
    """For a bounded set of top holders, find the earliest reachable incoming
    SOL transfer's source and group holders sharing a funder wallet.
    """
    funders: Dict[str, str] = {}

    for holder in report.top_holders[:CLUSTER_HOLDER_LIMIT]:
        owner = holder.address
        if not owner:
            continue
        try:
            sigs = await _rpc_call(
                "getSignaturesForAddress",
                [owner, {"limit": SIGNATURES_PER_PAGE}],
                "solana_cluster_signatures_error",
                report,
            )
            if not sigs:
                continue
            oldest_sig = sigs[-1]
            tx = await _rpc_call(
                "getTransaction",
                [
                    oldest_sig["signature"],
                    {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
                ],
                "solana_cluster_tx_error",
                report,
            )
            if not tx:
                continue
            account_keys = tx.get("transaction", {}).get("message", {}).get("accountKeys", [])
            for key in account_keys:
                pubkey = key.get("pubkey") if isinstance(key, dict) else key
                if pubkey and pubkey != owner:
                    funders[owner] = pubkey
                    break
        except Exception as e:
            logger.debug("token_intel solana cluster hint skipped for %s: %s", owner, e)
            continue

    groups: Dict[str, List[str]] = {}
    for holder_addr, funder in funders.items():
        groups.setdefault(funder, []).append(holder_addr)

    report.cluster_groups = [members for members in groups.values() if len(members) >= 2]
