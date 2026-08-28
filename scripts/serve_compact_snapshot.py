#!/usr/bin/env python3
import csv, json, os
from decimal import Decimal
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import suwappu_holder_census as c

LABELS = {
  "0x498581ff718922c3f8e6a244956af099b2652b2b":"Uniswap v4 PoolManager",
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f":"Relay ERC20Router",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae":"LI.FI Diamond",
  "0xb300000b72deaeb607a12d5f54773d1c19c7028d":"Binance DEX Router",
  "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544":"Doppler Hook Initializer",
  "0x00000000009726632680fb29d3f7a9734e3010e2":"RainbowRouter",
  "0x8f10b468b06c6fd214b65f87778827f7d113f996":"Kyber/Relay execution route",
  "0x7747f8d2a76bd6345cc29622a946a929647f2359":"Unresolved execution route",
}

def main():
    latest, logs, holders = c.reconstruct()
    try: supply=int(c.rpc("eth_call",[{"to":c.TOKEN,"data":"0x18160ddd"},"latest"]),16)
    except Exception: supply=100_000_000_000*10**c.DECIMALS
    rows=[]
    for rank,h in enumerate(holders,1):
        raw=h['raw_balance']; f=h.get('first_suwappu_transfer') or {}; l=h.get('latest_suwappu_transfer') or {}
        src=(f.get('counterparty') or '').lower(); lastcp=(l.get('counterparty') or '').lower()
        rows.append({
          'rank':rank,'address':h['address'],'balance':str((Decimal(raw)/(Decimal(10)**c.DECIMALS)).normalize()),
          'pct_supply':float(Decimal(raw)*100/Decimal(supply)),'transfer_count':h.get('suwappu_transfer_count',0),
          'first_block':f.get('block'),'first_source':src,'first_source_label':LABELS.get(src,''),'first_tx':f.get('tx_hash'),
          'latest_block':l.get('block'),'latest_counterparty':lastcp,'latest_counterparty_label':LABELS.get(lastcp,''),'latest_direction':l.get('direction')
        })
    meta={'token':c.TOKEN,'chain':'Base','block':latest,'transfer_logs':len(logs),'holders':len(rows),'total_supply_raw':str(supply)}
    with open('suwappu-holder-census.json','w') as f: json.dump({'meta':meta,'rows':rows},f,indent=2)
    with open('suwappu-holder-census.csv','w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print('SNAPSHOT_READY '+json.dumps(meta),flush=True)
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),SimpleHTTPRequestHandler).serve_forever()
if __name__=='__main__': main()
