#!/usr/bin/env python3
"""One-off recovery: rebuild the full ENA vector without re-scanning everything.

The prior successful collection (ena_recipients_prev) covered the claim window
(19,560,000-19,810,000) for all four Ethena-seeded channels PLUS the extension
(19,810,001-21,600,000) for the largest channel. A crashed follow-up run had
completed the remaining coverage — the extension window for the other three
channels — but died before writing. This script scans exactly that delta,
merges it with the prior vector, applies the funder-sweepback and
channel-address exclusions, re-reads residuals, and writes the same output
`collect_airdrops.py ena` (as now fixed) produces from a cold start. The union
of coverages is identical and non-overlapping, so the result is equivalent.
"""
import json
import os

from collect_airdrops import OUTDIR, collect_transfers_out, rpc

TOKEN = "0x57e114b691db790c35207b2e685d4a43181e6061"
CHANNELS = [
    "0x424ed30cce37d8c60e80ae0c4eb898cf85a88440",
    "0xe062995ddec38745bc145e9cc2ff981f6bd08201",
    "0x43cbe9dfe84e2f7451cf2b5caa28f02040e942f5",
    "0x4736808151268507a40eb6ac92d67345e8301a74",
]
DELTA_CHANNELS = [c for c in CHANNELS if c != "0x43cbe9dfe84e2f7451cf2b5caa28f02040e942f5"]
FUNDER = "0xdedc15fa923d4e147875c63c0a97f85f178dfe96"
FROM_BLOCK, TO_BLOCK = 19_560_000, 21_600_000
DELTA_LO, DELTA_HI = 19_810_001, 21_600_000

prev_path = os.path.join(OUTDIR, "ena_prev_backup.json.bak")
prev = json.load(open(prev_path))
# prev recipients are token units; rebuild raw-int space for the merge
rec = {a: int(v * 1e18) for a, v in prev["recipients"].items()}
# prev already popped channel addresses but NOT the funder; keep as-is and
# re-apply all exclusions after the merge.

delta, n_delta = collect_transfers_out(TOKEN, DELTA_CHANNELS, DELTA_LO, DELTA_HI,
                                       chunk=50_000, tag="ena_delta2")
for a, v in delta.items():
    rec[a] = rec.get(a, 0) + v

swept_back = rec.pop(FUNDER, 0) / 1e18
for c in CHANNELS:
    rec.pop(c, None)

residuals = {}
for c in CHANNELS:
    r = rpc("eth_call", [{"to": TOKEN, "data": "0x70a08231" + "0" * 24 + c[2:]},
                         hex(TO_BLOCK)])
    residuals[c] = int(r, 16) / 1e18

rec18 = {a: v / 1e18 for a, v in rec.items()}
out = {
    "program": "ENA Season 1",
    "kind": "claimed",
    "note": ("All four Ethena-seeded claim channels merged over "
             "19,560,000-21,600,000; seeds verified on-chain and summing to the "
             "announced 750M (+2,514 of dust). The funder's sweep-back of "
             "unclaimed funds is excluded from recipients and reported "
             "separately; residual balances at the scan horizon quantify what "
             "remained undistributed. Recipients of record are claim "
             "executors; custodial recipients cannot be separated at wallet "
             "level, as with any claims dataset."),
    "sources": CHANNELS,
    "seeds_verified": prev.get("seeds_verified"),
    "scan_range": [FROM_BLOCK, TO_BLOCK],
    "residual_balances_at_ext_end": residuals,
    "funder_sweepback_excluded": swept_back,
    "n_transfer_logs": prev.get("n_transfer_logs", 0) + n_delta,
    "n_recipients": len(rec18),
    "pool_total": sum(rec18.values()),
    "recipients": rec18,
}
path = os.path.join(OUTDIR, "ena_recipients.json")
json.dump(out, open(path, "w"))
ck = os.path.join(OUTDIR, "ena_delta_checkpoint.json")
if os.path.exists(ck):
    os.remove(ck)
print(f"ENA merged: {len(rec18):,} recipients, {sum(rec18.values())/1e6:,.1f}M claimed; "
      f"funder sweep-back excluded {swept_back/1e6:,.1f}M; wrote {path}")
