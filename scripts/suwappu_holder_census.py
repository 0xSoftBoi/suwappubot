#!/usr/bin/env python3
"""One-shot census for the community-launched SUWAPPU token on Base.

Uses Blockscout's public API only. Emits one JSON object per current holder so
Railway logs can be collected without adding application dependencies.
"""

import concurrent.futures
import json
import time
import urllib.parse
import urllib.request
from collections import Counter
from decimal import Decimal, getcontext

getcontext().prec = 60

BASE = "https://base.blockscout.com"
TOKEN = "0x26d58ce71ace3a79346c43ede802ff8f4fe55ba3"
TOTAL_SUPPLY = Decimal(100_000_000_000)
TIMEOUT = 20
UA = "suwappu-holder-census/1.0"


def get_json(url, retries=5):
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            err = e
            time.sleep(min(8, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"GET failed: {url}: {err}")


def all_holders():
    url = f"{BASE}/api/v2/tokens/{TOKEN}/holders"
    out = []
    seen = set()
    while url:
        data = get_json(url)
        items = data.get("items") or []
        for item in items:
            addr = ((item.get("address") or {}).get("hash") or "").lower()
            if not addr or addr in seen:
                continue
            seen.add(addr)
            out.append(item)
        nxt = data.get("next_page_params")
        if nxt:
            url = f"{BASE}/api/v2/tokens/{TOKEN}/holders?" + urllib.parse.urlencode(nxt)
        else:
            url = None
    return out


def legacy(params):
    return get_json(f"{BASE}/api?" + urllib.parse.urlencode(params))


def first_normal_tx(addr):
    try:
        d = legacy({"module":"account","action":"txlist","address":addr,"startblock":0,"endblock":99999999,"page":1,"offset":1,"sort":"asc"})
        rows = d.get("result") if isinstance(d, dict) else None
        if isinstance(rows, list) and rows:
            x = rows[0]
            return {
                "hash": x.get("hash"), "time": x.get("timeStamp"), "from": x.get("from"),
                "to": x.get("to"), "value_wei": x.get("value"), "method_id": x.get("methodId")
            }
    except Exception as e:
        return {"error": str(e)[:180]}
    return None


def token_edge_tx(addr, sort):
    try:
        d = legacy({"module":"account","action":"tokentx","contractaddress":TOKEN,"address":addr,"startblock":0,"endblock":99999999,"page":1,"offset":1,"sort":sort})
        rows = d.get("result") if isinstance(d, dict) else None
        if isinstance(rows, list) and rows:
            x = rows[0]
            return {
                "hash": x.get("hash"), "time": x.get("timeStamp"), "from": x.get("from"),
                "to": x.get("to"), "value": x.get("value"), "block": x.get("blockNumber")
            }
    except Exception as e:
        return {"error": str(e)[:180]}
    return None


def address_detail(addr):
    try:
        d = get_json(f"{BASE}/api/v2/addresses/{addr}")
        keys = [
            "hash", "name", "ens_domain_name", "is_contract", "is_verified", "proxy_type",
            "implementation_name", "creation_tx_hash", "creator_address_hash", "coin_balance",
            "exchange_rate", "has_beacon_chain_withdrawals", "has_decompiled_code"
        ]
        out = {k:d.get(k) for k in keys if d.get(k) is not None}
        for k in ("public_tags", "private_tags", "watchlist_names", "metadata"):
            if d.get(k): out[k] = d.get(k)
        return out
    except Exception as e:
        return {"error": str(e)[:180]}


def enrich(item):
    a = item.get("address") or {}
    addr = (a.get("hash") or "").lower()
    raw = Decimal(str(item.get("value") or 0))
    # Bankr token uses 18 decimals.
    bal = raw / (Decimal(10) ** 18)
    pct = (bal / TOTAL_SUPPLY) * 100
    profile = {
        "address": addr,
        "balance": str(bal.normalize()),
        "pct_total_supply": float(pct),
        "blockscout_holder_name": a.get("name"),
        "blockscout_ens": a.get("ens_domain_name"),
        "blockscout_is_contract": a.get("is_contract"),
        "blockscout_public_tags": a.get("public_tags") or [],
    }
    # Do the independent calls concurrently for each holder.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        f_detail = ex.submit(address_detail, addr)
        f_first = ex.submit(first_normal_tx, addr)
        f_entry = ex.submit(token_edge_tx, addr, "asc")
        f_latest = ex.submit(token_edge_tx, addr, "desc")
        profile["address_detail"] = f_detail.result()
        profile["first_normal_tx"] = f_first.result()
        profile["first_suwappu_transfer"] = f_entry.result()
        profile["latest_suwappu_transfer"] = f_latest.result()
    return profile


def main():
    holders = all_holders()
    print("META " + json.dumps({"token":TOKEN,"holder_count":len(holders),"source":"base.blockscout.com","snapshot_unix":int(time.time())}, separators=(",",":")), flush=True)

    profiles = []
    # Bound global concurrency to be polite to Blockscout while still finishing quickly.
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(enrich, h) for h in holders]
        for i, f in enumerate(concurrent.futures.as_completed(futs), 1):
            try:
                p = f.result()
                profiles.append(p)
                print("CENSUS " + json.dumps(p, separators=(",",":"), sort_keys=True), flush=True)
            except Exception as e:
                print("ERROR " + json.dumps({"error":str(e)[:300]}), flush=True)
            if i % 50 == 0:
                print("PROGRESS " + json.dumps({"done":i,"total":len(holders)}), flush=True)

    profiles.sort(key=lambda x: Decimal(x.get("balance") or "0"), reverse=True)
    funders = Counter()
    contracts = 0
    for p in profiles:
        if p.get("blockscout_is_contract") or (p.get("address_detail") or {}).get("is_contract"):
            contracts += 1
        ft = p.get("first_normal_tx") or {}
        if isinstance(ft, dict):
            fr = (ft.get("from") or "").lower()
            if fr and fr != p["address"]:
                funders[fr] += 1
    summary = {
        "profiles": len(profiles),
        "contracts": contracts,
        "eoa_or_unknown": len(profiles)-contracts,
        "top_common_first_funders": funders.most_common(20),
        "top20": [{"address":p["address"],"balance":p["balance"],"pct":p["pct_total_supply"],"name":p.get("blockscout_holder_name") or (p.get("address_detail") or {}).get("name"),"ens":p.get("blockscout_ens") or (p.get("address_detail") or {}).get("ens_domain_name"),"is_contract":p.get("blockscout_is_contract") or (p.get("address_detail") or {}).get("is_contract")} for p in profiles[:20]],
    }
    print("SUMMARY " + json.dumps(summary, separators=(",",":"), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
