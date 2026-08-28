#!/usr/bin/env python3
"""Direct onchain census for the community-launched SUWAPPU token on Base."""
import base64, concurrent.futures, gzip, json, time, urllib.request
from collections import Counter, defaultdict
from decimal import Decimal, getcontext

getcontext().prec = 60
TOKEN = "0x26d58ce71ace3a79346c43ede802ff8f4fe55ba3"
EXPLORER = "https://base.blockscout.com"
RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.llamarpc.com", "https://1rpc.io/base"]
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZERO = "0x0000000000000000000000000000000000000000"
START_BLOCK = 50538371  # first non-empty 2k range established by previous full backwards scan
DECIMALS = 18
UA = "suwappu-holder-census/3.0"


def post_rpc(endpoint, payload, timeout=20):
    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={"User-Agent":UA,"Content-Type":"application/json","Accept":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def rpc(method, params, attempts=5):
    last = None
    payload = {"jsonrpc":"2.0","id":1,"method":method,"params":params}
    for a in range(attempts):
        for ep in RPCS:
            try:
                body = post_rpc(ep, payload)
                if body.get("error"):
                    last = RuntimeError(str(body["error"])); continue
                return body.get("result")
            except Exception as e:
                last = e
        time.sleep(min(5, 0.5 * 2**a))
    raise RuntimeError(f"RPC {method} failed: {last}")


def get_logs(frm, to):
    """No gaps: recursively split ranges when providers reject/timeout a response."""
    try:
        return rpc("eth_getLogs", [{"fromBlock":hex(frm),"toBlock":hex(to),"address":TOKEN,"topics":[TRANSFER]}], attempts=3) or []
    except Exception:
        if frm >= to:
            return rpc("eth_getLogs", [{"fromBlock":hex(frm),"toBlock":hex(to),"address":TOKEN,"topics":[TRANSFER]}], attempts=8) or []
        mid = (frm + to)//2
        return get_logs(frm, mid) + get_logs(mid+1, to)


def topic_addr(x): return "0x" + x[-40:].lower()


def event(log, direction, counterparty, amount):
    return {"block":int(log["blockNumber"],16),"log_index":int(log.get("logIndex","0x0"),16),"tx_hash":log.get("transactionHash"),"direction":direction,"counterparty":counterparty,"amount_raw":str(amount),"amount":str((Decimal(amount)/(Decimal(10)**DECIMALS)).normalize())}


def reconstruct():
    latest = int(rpc("eth_blockNumber", []),16)
    logs = []
    # Small top-level chunks prevent oversized provider responses; recursive splitting guarantees coverage.
    for frm in range(START_BLOCK, latest+1, 250):
        to = min(latest, frm+249)
        xs = get_logs(frm,to)
        if xs:
            logs.extend(xs)
            print("SCAN "+json.dumps({"from":frm,"to":to,"logs":len(xs)},separators=(",",":")),flush=True)
    logs.sort(key=lambda x:(int(x["blockNumber"],16),int(x.get("transactionIndex","0x0"),16),int(x.get("logIndex","0x0"),16)))
    bal=defaultdict(int); first={}; last={}; count=Counter()
    for l in logs:
        t=l.get("topics") or []
        if len(t)<3: continue
        s,d=topic_addr(t[1]),topic_addr(t[2]); n=int(l.get("data") or "0x0",16)
        if s!=ZERO:
            bal[s]-=n; count[s]+=1; e=event(l,"out",d,n); first.setdefault(s,e); last[s]=e
        if d!=ZERO:
            bal[d]+=n; count[d]+=1; e=event(l,"in",s,n); first.setdefault(d,e); last[d]=e
    holders=[{"address":a,"raw_balance":n,"first_suwappu_transfer":first.get(a),"latest_suwappu_transfer":last.get(a),"suwappu_transfer_count":count[a]} for a,n in bal.items() if n>0 and a!=ZERO]
    holders.sort(key=lambda x:x["raw_balance"],reverse=True)
    return latest, logs, holders


def explorer_detail(addr):
    try:
        req=urllib.request.Request(f"{EXPLORER}/api/v2/addresses/{addr}",headers={"User-Agent":UA,"Accept":"application/json"})
        with urllib.request.urlopen(req,timeout=15) as r: d=json.loads(r.read().decode())
        keep=("hash","name","ens_domain_name","is_contract","is_verified","proxy_type","implementation_name","creation_tx_hash","creator_address_hash","coin_balance","public_tags","metadata")
        return {k:d.get(k) for k in keep if d.get(k) not in (None,[],{})}
    except Exception as e:
        return {"enrichment_error":str(e)[:140]}


def rpc_wallet_stats(addr):
    out={}
    for key,method in (("native_balance_wei","eth_getBalance"),("nonce","eth_getTransactionCount"),("code","eth_getCode")):
        try: out[key]=rpc(method,[addr,"latest"],attempts=2)
        except Exception: out[key]=None
    if out.get("native_balance_wei"): out["native_balance_wei"]=str(int(out["native_balance_wei"],16))
    if out.get("nonce"): out["nonce"]=int(out["nonce"],16)
    out["is_contract_rpc"]=bool(out.get("code") and out["code"]!="0x")
    out.pop("code",None)
    return out


def enrich(h,total_supply,rank):
    a=h["address"]; raw=h["raw_balance"]
    detail=explorer_detail(a)
    # RPC wallet stats are most useful for the top 100; everyone still gets explorer metadata + transfer behavior.
    stats=rpc_wallet_stats(a) if rank<=100 else {}
    return {"rank":rank,"address":a,"balance":str((Decimal(raw)/(Decimal(10)**DECIMALS)).normalize()),"raw_balance":str(raw),"pct_total_supply":float(Decimal(raw)*100/Decimal(total_supply)),"is_contract":detail.get("is_contract",stats.get("is_contract_rpc")),"name":detail.get("name"),"ens":detail.get("ens_domain_name"),"public_tags":detail.get("public_tags") or [],"address_detail":detail,"wallet_stats":stats,"first_suwappu_transfer":h.get("first_suwappu_transfer"),"latest_suwappu_transfer":h.get("latest_suwappu_transfer"),"suwappu_transfer_count":h.get("suwappu_transfer_count",0)}


def bundle(payload):
    b=base64.b64encode(gzip.compress(json.dumps(payload,separators=(",",":"),sort_keys=True).encode(),9)).decode(); size=3500; total=(len(b)+size-1)//size
    for i in range(total): print(f"DATA {i+1}/{total} {b[i*size:(i+1)*size]}",flush=True)


def main():
    latest,logs,holders=reconstruct()
    try: supply=int(rpc("eth_call",[{"to":TOKEN,"data":"0x18160ddd"},"latest"]),16)
    except Exception: supply=100_000_000_000*(10**DECIMALS)
    meta={"token":TOKEN,"source":"Base eth_getLogs","latest_block":latest,"scan_start_block":START_BLOCK,"transfer_log_count":len(logs),"holder_count":len(holders),"total_supply_raw":str(supply),"snapshot_unix":int(time.time())}
    print("META "+json.dumps(meta,separators=(",",":")),flush=True)
    profiles=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        fs=[ex.submit(enrich,h,supply,i+1) for i,h in enumerate(holders)]
        for i,f in enumerate(concurrent.futures.as_completed(fs),1):
            try:
                p=f.result(); profiles.append(p); print("CENSUS "+json.dumps(p,separators=(",",":"),sort_keys=True),flush=True)
            except Exception as e: print("ERROR "+json.dumps({"error":str(e)[:240]}),flush=True)
            if i%50==0: print("PROGRESS "+json.dumps({"done":i,"total":len(holders)}),flush=True)
    profiles.sort(key=lambda p:p["rank"])
    contracts=sum(1 for p in profiles if p.get("is_contract")); sources=Counter(); entry_blocks=Counter(); freshish=0
    for p in profiles:
        e=p.get("first_suwappu_transfer") or {}; cp=(e.get("counterparty") or "").lower() if isinstance(e,dict) else ""
        if cp: sources[cp]+=1
        if isinstance(e,dict) and e.get("block") is not None: entry_blocks[e["block"]]+=1
        n=(p.get("wallet_stats") or {}).get("nonce")
        if isinstance(n,int) and n<=5: freshish+=1
    summary={"profiles":len(profiles),"contracts":contracts,"eoa_or_unknown":len(profiles)-contracts,"top_initial_token_counterparties":sources.most_common(15),"busiest_entry_blocks":entry_blocks.most_common(20),"top100_low_nonce_wallets":freshish,"top25":[{k:p.get(k) for k in ("rank","address","balance","pct_total_supply","name","ens","is_contract","wallet_stats","first_suwappu_transfer","suwappu_transfer_count")} for p in profiles[:25]]}
    print("SUMMARY "+json.dumps(summary,separators=(",",":"),sort_keys=True),flush=True)
    bundle({"meta":meta,"summary":summary,"profiles":profiles})

if __name__=="__main__": main()
