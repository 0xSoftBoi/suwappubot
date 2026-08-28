#!/usr/bin/env python3
import json, urllib.request
TOKEN='0x26d58ce71ace3a79346c43ede802ff8f4fe55ba3'

def get(url):
 r=urllib.request.Request(url,headers={'User-Agent':'suwappu-launch-lookup/1.0','Accept':'application/json'})
 with urllib.request.urlopen(r,timeout=20) as x: return json.loads(x.read().decode())

def main():
 for url in ['https://api.bankr.bot/token-launches',f'https://api.bankr.bot/token-launches/{TOKEN}']:
  try:
   d=get(url)
   if isinstance(d,list): hits=[x for x in d if str(x.get('tokenAddress','')).lower()==TOKEN]
   elif isinstance(d,dict):
    items=d.get('launches') or d.get('tokens') or d.get('data') or []
    hits=[x for x in items if isinstance(x,dict) and str(x.get('tokenAddress','')).lower()==TOKEN] if isinstance(items,list) else [d]
   else: hits=[]
   print('BANKR_LAUNCH_LOOKUP '+url+' '+json.dumps(hits or d,separators=(',',':'))[:20000],flush=True)
  except Exception as e: print('BANKR_LAUNCH_LOOKUP_ERROR '+url+' '+repr(e),flush=True)
if __name__=='__main__': main()
