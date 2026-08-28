#!/usr/bin/env python3
import json, urllib.request
import suwappu_holder_census as c
TOKEN=c.TOKEN
TX='0x110cbe9ea4efb305b53b8ab0b1db499e4c4bf4c24faa927b3865a470401f685f'

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'suwappu-launch-probe/1.0','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as r: return json.loads(r.read().decode())

def main():
    try:
        fees=get(f'https://api.bankr.bot/public/doppler/token-fees/{TOKEN}?days=1')
        print('BANKR_FEES '+json.dumps(fees,separators=(',',':')),flush=True)
    except Exception as e: print('BANKR_FEES_ERROR '+repr(e),flush=True)
    try:
        receipt=c.rpc('eth_getTransactionReceipt',[TX])
        tx=c.rpc('eth_getTransactionByHash',[TX])
        compact={'tx':{k:tx.get(k) for k in ('from','to','blockNumber','input','value')},'receipt':{'contractAddress':receipt.get('contractAddress'),'status':receipt.get('status'),'logs':[{'address':x.get('address'),'topics':x.get('topics'),'data':x.get('data')} for x in receipt.get('logs',[])]}}
        print('LAUNCH_RECEIPT '+json.dumps(compact,separators=(',',':')),flush=True)
    except Exception as e: print('LAUNCH_RECEIPT_ERROR '+repr(e),flush=True)
if __name__=='__main__': main()
