#!/usr/bin/env python3
import base64, gzip, json
from decimal import Decimal
import suwappu_holder_census as c


def main():
    latest, logs, holders = c.reconstruct()
    try:
        supply = int(c.rpc("eth_call", [{"to": c.TOKEN, "data":"0x18160ddd"}, "latest"]), 16)
    except Exception:
        supply = 100_000_000_000 * 10**c.DECIMALS
    rows=[]
    for rank,h in enumerate(holders,1):
        raw=h["raw_balance"]
        first=h.get("first_suwappu_transfer") or {}
        last=h.get("latest_suwappu_transfer") or {}
        rows.append({
          "rank":rank,"address":h["address"],
          "balance":str((Decimal(raw)/(Decimal(10)**c.DECIMALS)).normalize()),
          "pct":float(Decimal(raw)*100/Decimal(supply)),
          "transfers":h.get("suwappu_transfer_count",0),
          "first_block":first.get("block"),"first_source":first.get("counterparty"),"first_tx":first.get("tx_hash"),
          "last_block":last.get("block"),"last_counterparty":last.get("counterparty"),"last_direction":last.get("direction")
        })
    payload={"meta":{"token":c.TOKEN,"block":latest,"transfer_logs":len(logs),"holders":len(rows)},"rows":rows}
    raw=json.dumps(payload,separators=(",",":"),sort_keys=True).encode()
    blob=base64.b64encode(gzip.compress(raw,9)).decode()
    size=5000; n=(len(blob)+size-1)//size
    print("COMPACT_META "+json.dumps({"chunks":n,"encoded_bytes":len(blob),"holders":len(rows),"block":latest}),flush=True)
    for i in range(n): print(f"COMPACT {i+1}/{n} {blob[i*size:(i+1)*size]}",flush=True)

if __name__=="__main__": main()
