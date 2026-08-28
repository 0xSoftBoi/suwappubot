#!/usr/bin/env python3
import csv, json, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://base.blockscout.com"
TOKEN = "0x26d58ce71ace3a79346c43ede802ff8f4fe55ba3".lower()
OUT = Path("holder-map-output")
OUT.mkdir(exist_ok=True)
UA = "suwappu-holder-map/1.0"


def get_json(url, tries=5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last = e
            time.sleep(min(8, 0.5 * (2 ** i)))
    raise last


def legacy(params):
    return get_json(BASE + "/api?" + urllib.parse.urlencode(params))


def get_token_meta():
    x = legacy({"module":"token","action":"getToken","contractaddress":TOKEN})
    r = x.get("result", {}) if isinstance(x, dict) else {}
    return r


def get_holders():
    x = legacy({"module":"token","action":"getTokenHolders","contractaddress":TOKEN,"page":1,"offset":10000})
    if isinstance(x, dict) and x.get("status") == "1" and isinstance(x.get("result"), list):
        return [{"address": r["address"].lower(), "value": int(r["value"])} for r in x["result"]]
    # v2 fallback
    out, params = [], {}
    for _ in range(100):
        url = BASE + f"/api/v2/tokens/{TOKEN}/holders"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        x = get_json(url)
        for r in x.get("items", []):
            a = r.get("address_hash") or r.get("address") or {}
            h = a.get("hash") if isinstance(a, dict) else a
            if h:
                out.append({"address": h.lower(), "value": int(r.get("value", 0))})
        params = x.get("next_page_params")
        if not params:
            break
    return out


def get_token_transfers():
    out = []
    for page in range(1, 20):
        x = legacy({"module":"account","action":"tokentx","contractaddress":TOKEN,"page":page,"offset":10000,"sort":"asc"})
        rows = x.get("result", []) if isinstance(x, dict) else []
        if not isinstance(rows, list):
            break
        out.extend(rows)
        if len(rows) < 10000:
            break
    return out


def address_meta(addr):
    try:
        return get_json(BASE + f"/api/v2/addresses/{addr}")
    except Exception as e:
        return {"_error": str(e)}


def first_normal_tx(addr):
    try:
        x = legacy({"module":"account","action":"txlist","address":addr,"startblock":0,"endblock":99999999,"page":1,"offset":1,"sort":"asc"})
        rows = x.get("result", []) if isinstance(x, dict) else []
        return rows[0] if isinstance(rows, list) and rows else {}
    except Exception as e:
        return {"_error": str(e)}


def tags(meta):
    vals = []
    if meta.get("name"):
        vals.append(meta["name"])
    if meta.get("ens_domain_name"):
        vals.append(meta["ens_domain_name"])
    md = meta.get("metadata") or {}
    for t in md.get("tags", []) if isinstance(md, dict) else []:
        if isinstance(t, dict) and t.get("name"):
            vals.append(t["name"])
    for key in ("public_tags", "watchlist_names"):
        for t in meta.get(key, []) or []:
            if isinstance(t, dict):
                vals.append(t.get("display_name") or t.get("label") or "")
    return " | ".join(dict.fromkeys(v for v in vals if v))


def iso(ts):
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except Exception:
        return ""


meta = get_token_meta()
decimals = int(meta.get("decimals") or 18)
total_supply_raw = int(meta.get("totalSupply") or 0)
holders = get_holders()
transfers = get_token_transfers()

# Token-level activity per wallet.
activity = defaultdict(lambda: {"in_raw":0,"out_raw":0,"in_n":0,"out_n":0,"first_ts":None,"first_block":None,"first_tx":"","first_cp":"","holder_xfers":0})
all_addresses = {h["address"] for h in holders}
zero = "0x0000000000000000000000000000000000000000"
for t in transfers:
    f = (t.get("from") or "").lower(); to = (t.get("to") or "").lower()
    try: val = int(t.get("value") or 0)
    except: val = 0
    ts = int(t.get("timeStamp") or 0); block = int(t.get("blockNumber") or 0)
    if to and to != zero:
        a = activity[to]; a["in_raw"] += val; a["in_n"] += 1
        if a["first_ts"] is None or ts < a["first_ts"]:
            a.update(first_ts=ts, first_block=block, first_tx=t.get("hash", ""), first_cp=f)
        if f in all_addresses: a["holder_xfers"] += 1
    if f and f != zero:
        a = activity[f]; a["out_raw"] += val; a["out_n"] += 1
        if to in all_addresses: a["holder_xfers"] += 1

# Enrich every holder from explorer metadata + first normal transaction.
metas = {}; firsts = {}
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(address_meta, h["address"]):(h["address"], "m") for h in holders}
    futs.update({ex.submit(first_normal_tx, h["address"]):(h["address"], "f") for h in holders})
    for fut in as_completed(futs):
        addr, kind = futs[fut]
        try: value = fut.result()
        except Exception as e: value = {"_error": str(e)}
        (metas if kind == "m" else firsts)[addr] = value

# Enrich unique inbound first counterparties/funders too.
funders = set()
for h in holders:
    a = h["address"]; tx = firsts.get(a, {})
    f = (tx.get("from") or "").lower(); to = (tx.get("to") or "").lower()
    if f and to == a and f != zero:
        funders.add(f)
funder_metas = {}
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(address_meta, f):f for f in funders}
    for fut in as_completed(futs):
        f = futs[fut]
        try: funder_metas[f] = fut.result()
        except Exception as e: funder_metas[f] = {"_error": str(e)}

funder_counts = Counter()
for h in holders:
    a = h["address"]; tx = firsts.get(a, {})
    f = (tx.get("from") or "").lower(); to = (tx.get("to") or "").lower()
    if f and to == a and f != zero:
        funder_counts[f] += 1

rows = []
for rank, h in enumerate(sorted(holders, key=lambda x: x["value"], reverse=True), 1):
    a = h["address"]; m = metas.get(a, {}); tx = firsts.get(a, {}); act = activity[a]
    is_contract = bool(m.get("is_contract"))
    first_from = (tx.get("from") or "").lower(); first_to = (tx.get("to") or "").lower()
    funder = first_from if first_from and first_to == a and first_from != zero else ""
    fmeta = funder_metas.get(funder, {}) if funder else {}
    tx_ts = tx.get("timeStamp") or ""
    holder_label = tags(m)
    funder_label = tags(fmeta)
    tx_count = m.get("transactions_count") or m.get("tx_count") or ""
    bal = h["value"] / (10 ** decimals)
    pct = (h["value"] / total_supply_raw * 100) if total_supply_raw else 0
    # Conservative classifier; no real-world identity inference.
    if a == "0x498581ff718922c3f8e6a244956af099b2652b2b": cls = "protocol: Uniswap v4 PoolManager"
    elif is_contract: cls = "contract/protocol"
    elif holder_label: cls = "publicly-labeled EOA"
    elif funder and funder_counts[funder] >= 2: cls = "shared-funder cluster"
    else: cls = "unattributed EOA"
    rows.append({
        "rank": rank, "address": a, "balance": f"{bal:.12f}", "pct_total_supply": f"{pct:.8f}",
        "is_contract": is_contract, "label": holder_label, "classification": cls,
        "token_in_count": act["in_n"], "token_out_count": act["out_n"], "holder_to_holder_transfer_events": act["holder_xfers"],
        "first_suwappu_time_utc": iso(act["first_ts"]), "first_suwappu_block": act["first_block"] or "", "first_suwappu_tx": act["first_tx"], "first_suwappu_counterparty": act["first_cp"],
        "first_wallet_tx_time_utc": iso(tx_ts), "first_wallet_tx_hash": tx.get("hash", ""),
        "first_inbound_funder": funder, "funder_label": funder_label, "shared_funder_wallet_count": funder_counts.get(funder, 0) if funder else 0,
        "explorer_transactions_count": tx_count,
    })

# Funder clusters with >=2 current holders.
clusters = []
for f, n in funder_counts.most_common():
    if n < 2: continue
    members = [r["address"] for r in rows if r["first_inbound_funder"] == f]
    clusters.append({"funder":f,"funder_label":tags(funder_metas.get(f, {})),"member_count":n,"members":";".join(members)})

with (OUT/"holders.csv").open("w", newline="") as fp:
    w = csv.DictWriter(fp, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
with (OUT/"clusters.csv").open("w", newline="") as fp:
    fields = ["funder","funder_label","member_count","members"]
    w = csv.DictWriter(fp, fieldnames=fields); w.writeheader(); w.writerows(clusters)

summary = {
    "token": TOKEN, "symbol": meta.get("symbol"), "name": meta.get("name"), "decimals": decimals,
    "snapshot_utc": datetime.now(timezone.utc).isoformat(), "holder_count": len(rows), "transfer_rows": len(transfers),
    "contract_holders": sum(bool(r["is_contract"]) for r in rows),
    "publicly_labeled_holders": sum(bool(r["label"]) for r in rows),
    "shared_funder_clusters": len(clusters),
    "top20": rows[:20], "clusters": clusters[:50]
}
(OUT/"summary.json").write_text(json.dumps(summary, indent=2))

md = [f"# SUWAPPU holder map\n", f"Snapshot: {summary['snapshot_utc']}\n", f"Holders: **{len(rows)}** · token transfers indexed: **{len(transfers)}** · contracts: **{summary['contract_holders']}** · publicly labeled: **{summary['publicly_labeled_holders']}**\n", "## Top 20\n", "|#|address|% supply|type/label|first SUWAPPU|funder|\n|---:|---|---:|---|---|---|\n"]
for r in rows[:20]:
    who = r['label'] or r['classification']; fund = r['funder_label'] or r['first_inbound_funder'] or '—'
    md.append(f"|{r['rank']}|`{r['address']}`|{r['pct_total_supply']}|{who}|{r['first_suwappu_time_utc']}|{fund}|\n")
md.append("\n## Shared-funder clusters\n")
for c in clusters[:30]: md.append(f"- `{c['funder']}` {c['funder_label']} → **{c['member_count']}** current holders\n")
(OUT/"report.md").write_text("".join(md))
print(json.dumps(summary, indent=2))
