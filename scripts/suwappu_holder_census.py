#!/usr/bin/env python3
"""One-shot onchain census for the community-launched SUWAPPU token on Base.

Holder balances are reconstructed directly from ERC-20 Transfer logs over Base
JSON-RPC so the result does not depend on a token indexer's freshness. Public
Blockscout address metadata is used only as optional enrichment.
"""

import base64
import concurrent.futures
import gzip
import json
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from decimal import Decimal, getcontext

getcontext().prec = 60

TOKEN = "0x26d58ce71ace3a79346c43ede802ff8f4fe55ba3"
BASE_EXPLORER = "https://base.blockscout.com"
RPCS = [
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base.llamarpc.com",
]
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZERO = "0x0000000000000000000000000000000000000000"
DECIMALS = 18
SCAN_BLOCKS = 100_000  # ~55h on Base; token launched today
CHUNK = 2_000
TIMEOUT = 25
UA = "suwappu-holder-census/2.0"


def get_json(url, retries=3):
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            err = e
            time.sleep(min(4, 0.4 * (2 ** attempt)))
    raise RuntimeError(f"GET failed: {url}: {err}")


def rpc(method, params, retries=4):
    payload = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode()
    last = None
    for attempt in range(retries):
        for endpoint in RPCS:
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=payload,
                    headers={"User-Agent": UA, "Accept":"application/json", "Content-Type":"application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    body = json.loads(r.read().decode("utf-8"))
                if body.get("error"):
                    last = RuntimeError(str(body["error"]))
                    continue
                return body.get("result")
            except Exception as e:
                last = e
        time.sleep(min(4, 0.4 * (2 ** attempt)))
    raise RuntimeError(f"RPC {method} failed: {last}")


def addr_from_topic(topic):
    return "0x" + topic[-40:].lower()


def event_record(log, direction, counterparty, amount):
    return {
        "block": int(log["blockNumber"], 16),
        "log_index": int(log.get("logIndex", "0x0"), 16),
        "tx_hash": log.get("transactionHash"),
        "direction": direction,
        "counterparty": counterparty,
        "amount_raw": str(amount),
        "amount": str((Decimal(amount) / (Decimal(10) ** DECIMALS)).normalize()),
    }


def reconstruct_holders():
    latest = int(rpc("eth_blockNumber", []), 16)
    start = max(0, latest - SCAN_BLOCKS)
    balances = defaultdict(int)
    first = {}
    last = {}
    counts = Counter()
    all_logs = []

    for frm in range(start, latest + 1, CHUNK):
        to = min(latest, frm + CHUNK - 1)
        logs = rpc("eth_getLogs", [{
            "fromBlock": hex(frm),
            "toBlock": hex(to),
            "address": TOKEN,
            "topics": [TRANSFER_TOPIC],
        }]) or []
        if logs:
            all_logs.extend(logs)
            print("SCAN " + json.dumps({"from":frm,"to":to,"logs":len(logs)}, separators=(",",":")), flush=True)

    all_logs.sort(key=lambda x: (int(x["blockNumber"],16), int(x.get("transactionIndex","0x0"),16), int(x.get("logIndex","0x0"),16)))

    for log in all_logs:
        topics = log.get("topics") or []
        if len(topics) < 3:
            continue
        src = addr_from_topic(topics[1])
        dst = addr_from_topic(topics[2])
        amount = int(log.get("data") or "0x0", 16)
        if src != ZERO:
            balances[src] -= amount
            counts[src] += 1
            ev = event_record(log, "out", dst, amount)
            first.setdefault(src, ev)
            last[src] = ev
        if dst != ZERO:
            balances[dst] += amount
            counts[dst] += 1
            ev = event_record(log, "in", src, amount)
            first.setdefault(dst, ev)
            last[dst] = ev

    holders = []
    for address, raw in balances.items():
        if raw > 0 and address != ZERO:
            holders.append({
                "address": address,
                "raw_balance": raw,
                "first_suwappu_transfer": first.get(address),
                "latest_suwappu_transfer": last.get(address),
                "suwappu_transfer_count": counts[address],
            })
    holders.sort(key=lambda x: x["raw_balance"], reverse=True)
    return latest, start, len(all_logs), holders


def legacy(params):
    return get_json(f"{BASE_EXPLORER}/api?" + urllib.parse.urlencode(params), retries=2)


def first_normal_tx(addr):
    try:
        d = legacy({"module":"account","action":"txlist","address":addr,"startblock":0,"endblock":99999999,"page":1,"offset":1,"sort":"asc"})
        rows = d.get("result") if isinstance(d, dict) else None
        if isinstance(rows, list) and rows:
            x = rows[0]
            return {
                "hash": x.get("hash"), "time": x.get("timeStamp"), "from": x.get("from"),
                "to": x.get("to"), "value_wei": x.get("value"), "method_id": x.get("methodId"),
                "block": x.get("blockNumber"),
            }
    except Exception as e:
        return {"error": str(e)[:180]}
    return None


def address_detail(addr):
    try:
        d = get_json(f"{BASE_EXPLORER}/api/v2/addresses/{addr}", retries=2)
        keys = [
            "hash", "name", "ens_domain_name", "is_contract", "is_verified", "proxy_type",
            "implementation_name", "creation_tx_hash", "creator_address_hash", "coin_balance",
            "exchange_rate", "has_decompiled_code"
        ]
        out = {k:d.get(k) for k in keys if d.get(k) is not None}
        for k in ("public_tags", "watchlist_names", "metadata"):
            if d.get(k):
                out[k] = d.get(k)
        return out
    except Exception as e:
        # Direct RPC fallback still distinguishes contracts from EOAs.
        try:
            code = rpc("eth_getCode", [addr, "latest"], retries=2)
            return {"is_contract": bool(code and code != "0x"), "enrichment_error": str(e)[:160]}
        except Exception as e2:
            return {"error": str(e2)[:180]}


def enrich(holder, total_supply):
    addr = holder["address"]
    raw = holder["raw_balance"]
    bal = Decimal(raw) / (Decimal(10) ** DECIMALS)
    pct = (Decimal(raw) / Decimal(total_supply)) * 100 if total_supply else Decimal(0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f_detail = ex.submit(address_detail, addr)
        f_first = ex.submit(first_normal_tx, addr)
        detail = f_detail.result()
        first_tx = f_first.result()
    return {
        "address": addr,
        "balance": str(bal.normalize()),
        "raw_balance": str(raw),
        "pct_total_supply": float(pct),
        "is_contract": detail.get("is_contract"),
        "name": detail.get("name"),
        "ens": detail.get("ens_domain_name"),
        "public_tags": detail.get("public_tags") or [],
        "address_detail": detail,
        "first_normal_tx": first_tx,
        "first_suwappu_transfer": holder.get("first_suwappu_transfer"),
        "latest_suwappu_transfer": holder.get("latest_suwappu_transfer"),
        "suwappu_transfer_count": holder.get("suwappu_transfer_count", 0),
    }


def emit_bundle(payload):
    raw = json.dumps(payload, separators=(",",":"), sort_keys=True).encode("utf-8")
    blob = base64.b64encode(gzip.compress(raw, compresslevel=9)).decode("ascii")
    chunk_size = 3500
    total = (len(blob) + chunk_size - 1) // chunk_size
    for i in range(total):
        print(f"DATA {i+1}/{total} {blob[i*chunk_size:(i+1)*chunk_size]}", flush=True)


def main():
    latest, scan_start, transfer_logs, holders = reconstruct_holders()
    try:
        supply_hex = rpc("eth_call", [{"to":TOKEN,"data":"0x18160ddd"}, "latest"])
        total_supply = int(supply_hex, 16)
    except Exception:
        total_supply = 100_000_000_000 * (10 ** DECIMALS)

    meta = {
        "token": TOKEN,
        "source": "Base eth_getLogs + public Blockscout enrichment",
        "latest_block": latest,
        "scan_start_block": scan_start,
        "transfer_log_count": transfer_logs,
        "holder_count": len(holders),
        "total_supply_raw": str(total_supply),
        "snapshot_unix": int(time.time()),
    }
    print("META " + json.dumps(meta, separators=(",",":")), flush=True)

    profiles = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(enrich, h, total_supply) for h in holders]
        for i, f in enumerate(concurrent.futures.as_completed(futs), 1):
            try:
                p = f.result()
                profiles.append(p)
                print("CENSUS " + json.dumps(p, separators=(",",":"), sort_keys=True), flush=True)
            except Exception as e:
                print("ERROR " + json.dumps({"error":str(e)[:300]}), flush=True)
            if i % 50 == 0:
                print("PROGRESS " + json.dumps({"done":i,"total":len(holders)}), flush=True)

    profiles.sort(key=lambda x: int(x.get("raw_balance") or "0"), reverse=True)
    first_funders = Counter()
    first_sources = Counter()
    entry_blocks = Counter()
    contracts = 0
    for p in profiles:
        if p.get("is_contract"):
            contracts += 1
        ft = p.get("first_normal_tx") or {}
        if isinstance(ft, dict):
            fr = (ft.get("from") or "").lower()
            if fr and fr != p["address"]:
                first_funders[fr] += 1
        ev = p.get("first_suwappu_transfer") or {}
        cp = (ev.get("counterparty") or "").lower() if isinstance(ev, dict) else ""
        if cp:
            first_sources[cp] += 1
        if isinstance(ev, dict) and ev.get("block") is not None:
            entry_blocks[ev["block"]] += 1

    summary = {
        "profiles": len(profiles),
        "contracts": contracts,
        "eoa_or_unknown": len(profiles)-contracts,
        "top_common_first_funders": first_funders.most_common(25),
        "top_initial_token_counterparties": first_sources.most_common(15),
        "busiest_entry_blocks": entry_blocks.most_common(15),
        "top25": [{
            "address":p["address"], "balance":p["balance"], "pct":p["pct_total_supply"],
            "name":p.get("name"), "ens":p.get("ens"), "is_contract":p.get("is_contract"),
            "first_transfer":p.get("first_suwappu_transfer"), "first_normal_tx":p.get("first_normal_tx")
        } for p in profiles[:25]],
    }
    print("SUMMARY " + json.dumps(summary, separators=(",",":"), sort_keys=True), flush=True)
    emit_bundle({"meta":meta,"summary":summary,"profiles":profiles})


if __name__ == "__main__":
    main()
