"""Sample Relay's public /requests/v2 firehose and aggregate market intel."""
import json, sys, time, urllib.request, collections, statistics, os

N = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
OUT = "/home/user/suwappubot/docs/research/relay/"
API = "https://api.relay.link/requests/v2?limit=50"
CHAINS = {c["id"]: c["name"] for c in json.load(open(os.path.join(OUT, "probe/chains-slim.json")))}

rows, cont = [], None
while len(rows) < N:
    url = API + (f"&continuation={cont}" if cont else "")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "suwappu-research"}), timeout=30) as r:
                d = json.load(r)
            break
        except Exception as e:
            time.sleep(2 * (attempt + 1)); d = None
    if not d: break
    for q in d.get("requests", []):
        md = (q.get("data") or {}).get("metadata") or {}
        cin, cout = md.get("currencyIn") or {}, md.get("currencyOut") or {}
        dep = ((q.get("protocol") or {}).get("deposit") or {}).get("origin") or {}
        outtx = ((q.get("data") or {}).get("outTxs") or [{}])
        intx = ((q.get("data") or {}).get("inTxs") or [{}])
        rows.append({
            "id": q.get("id"), "status": q.get("status"), "created": q.get("createdAt"), "updated": q.get("updatedAt"),
            "referrer": q.get("referrer") or "", "origin": dep.get("chainId") or (intx[0] or {}).get("chainId"),
            "dest": (outtx[0] or {}).get("chainId") or (cout.get("currency") or {}).get("chainId"),
            "in_sym": (cin.get("currency") or {}).get("symbol"), "out_sym": (cout.get("currency") or {}).get("symbol"),
            "usd": float(cin.get("amountUsd") or 0), "time_est": (q.get("data") or {}).get("timeEstimate"),
            "app_bps": sum(float(a.get("bps") or 0) for a in ((q.get("data") or {}).get("appFees") or [])),
            "app_fee_usd": sum(float(a.get("amountUsd") or 0) for a in ((q.get("data") or {}).get("appFees") or [])),
            "solver": ((q.get("protocol") or {}).get("solver") or {}).get("address"),
            "fail": (q.get("data") or {}).get("failReason"), "ext_liq": (q.get("data") or {}).get("usesExternalLiquidity"),
            "in_ts": (intx[0] or {}).get("timestamp"), "out_ts": (outtx[0] or {}).get("timestamp"),
        })
    cont = d.get("continuation")
    if not cont: break
    time.sleep(0.25)

rows = rows[:N]
with open(os.path.join(OUT, "probe/firehose-sample.jsonl"), "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")

def name(cid): return CHAINS.get(cid, str(cid))
def top(counter, n=15, total=None):
    total = total or sum(counter.values())
    return "\n".join(f"| {k} | {v} | {100*v/total:.1f}% |" for k, v in counter.most_common(n))

status = collections.Counter(r["status"] for r in rows)
ref = collections.Counter(r["referrer"] or "(none)" for r in rows)
ref_usd = collections.Counter(); [ref_usd.update({r["referrer"] or "(none)": r["usd"]}) for r in rows]
orig = collections.Counter(name(r["origin"]) for r in rows); dest = collections.Counter(name(r["dest"]) for r in rows)
pair = collections.Counter(f"{name(r['origin'])} → {name(r['dest'])}" for r in rows)
pair_usd = collections.Counter(); [pair_usd.update({f"{name(r['origin'])} → {name(r['dest'])}": r["usd"]}) for r in rows]
tok = collections.Counter(f"{r['in_sym']} → {r['out_sym']}" for r in rows)
usd = sorted(r["usd"] for r in rows if r["usd"] > 0)
bps = collections.Counter(r["app_bps"] for r in rows)
solver = collections.Counter(r["solver"] for r in rows)
fills = [r["out_ts"] - r["in_ts"] for r in rows if r["in_ts"] and r["out_ts"] and r["status"] == "success" and 0 <= r["out_ts"] - r["in_ts"] < 3600]
fails = collections.Counter(r["fail"] for r in rows if r["status"] not in ("success", "pending"))
same_chain = sum(1 for r in rows if r["origin"] == r["dest"])
span = (rows[0]["created"], rows[-1]["created"]) if rows else ("?", "?")
total_usd = sum(usd)
def pct(p): return usd[min(len(usd)-1, int(len(usd)*p))] if usd else 0
app_fee_total = sum(r["app_fee_usd"] for r in rows)

md = f"""# Relay firehose intel (sampled {len(rows)} most recent requests, {span[1]} → {span[0]} UTC)

Source: `GET https://api.relay.link/requests/v2` (public, no auth). Raw sample: `probe/firehose-sample.jsonl`. Script: `scripts/research/relay_firehose.py`.

## Headline numbers
| Metric | Value |
|---|---|
| Requests sampled | {len(rows)} |
| Time span | {span[1]} → {span[0]} |
| Total notional (USD) | ${total_usd:,.0f} |
| Median / p90 / p99 ticket | ${pct(0.5):,.2f} / ${pct(0.9):,.2f} / ${pct(0.99):,.2f} |
| Same-chain swaps | {same_chain} ({100*same_chain/max(1,len(rows)):.1f}%) |
| Median fill (deposit→fill, success only, n={len(fills)}) | {statistics.median(fills) if fills else 'n/a'} s (p90 {sorted(fills)[int(len(fills)*0.9)] if fills else 'n/a'} s) |
| Integrator app fees collected in sample | ${app_fee_total:,.2f} ({100*app_fee_total/max(1,total_usd):.3f}% of notional) |
| Distinct solvers | {len(solver)} |

## Status mix
| Status | Count | Share |
|---|---|---|
{top(status)}

## Failure reasons (non-success, non-pending)
| Reason | Count | Share |
|---|---|---|
{top(fails) or '| (none) | 0 | 0% |'}

## Who sends the volume (referrer = integrator id)
By request count:
| Referrer | Count | Share |
|---|---|---|
{top(ref, 20)}

By USD notional:
| Referrer | USD | Share |
|---|---|---|
{chr(10).join(f"| {k} | ${v:,.0f} | {100*v/max(1,total_usd):.1f}% |" for k, v in ref_usd.most_common(20))}

## App-fee bps integrators charge
| bps | Count | Share |
|---|---|---|
{top(bps, 12)}

## Origin chains
| Chain | Count | Share |
|---|---|---|
{top(orig)}

## Destination chains
| Chain | Count | Share |
|---|---|---|
{top(dest)}

## Top routes by count
| Route | Count | Share |
|---|---|---|
{top(pair, 20)}

## Top routes by USD
| Route | USD | Share |
|---|---|---|
{chr(10).join(f"| {k} | ${v:,.0f} | {100*v/max(1,total_usd):.1f}% |" for k, v in pair_usd.most_common(15))}

## Token pairs
| Pair | Count | Share |
|---|---|---|
{top(tok, 20)}

## Solver concentration
| Solver | Count | Share |
|---|---|---|
{top(solver, 10)}
"""
open(os.path.join(OUT, "06-firehose-intel.md"), "w").write(md)
print(md[:3000])
